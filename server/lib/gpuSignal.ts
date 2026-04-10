import { execSync } from 'child_process';

/**
 * GPU-aware abort signal for local AI inference.
 *
 * Instead of a fixed timeout that kills slow-but-working inferences,
 * this monitors the GPU via nvidia-smi: as long as it's actively
 * computing (high utilization or power draw), the request stays alive.
 * Only aborts when the GPU has been idle for `idleThresholdMs`
 * (model finished or died) or `absoluteMaxMs` elapses (safety valve).
 *
 * This solves the fundamental problem with local AI: inference time
 * depends on context size × offload ratio × model size, which can
 * range from 30 seconds to 40+ minutes. No fixed timeout works for
 * all configurations. The GPU IS the signal.
 *
 * IMPORTANT: at large context sizes (>30k tokens) with low GPU offload,
 * token generation becomes extremely CPU-bound (0.3 tok/s observed at
 * 75k context / 25% offload). In this mode the GPU is mostly idle
 * BETWEEN tokens — each token takes ~3s, mostly CPU attention work.
 * Thresholds must be low enough to detect this "slow but working" state:
 *   - Power > 25W (vs ~17W true idle, ~30-40W CPU-bound generation)
 *   - Utilization > 10% (brief GPU spikes during each token)
 *   - Idle window 120s (long enough to span multiple slow tokens)
 */
export function createGpuAwareSignal(
  idleThresholdMs = 120_000,
  absoluteMaxMs = 3_600_000
): { signal: AbortSignal; cleanup: () => void } {
  const controller = new AbortController();
  let lastActiveAt = Date.now();
  const startedAt = Date.now();

  const interval = setInterval(() => {
    try {
      const csv = execSync(
        'nvidia-smi --query-gpu=utilization.gpu,power.draw --format=csv,noheader,nounits',
        { encoding: 'utf-8', timeout: 3000 }
      ).trim();
      const [utilStr, powerStr] = csv.split(', ');
      const util = parseFloat(utilStr);
      const power = parseFloat(powerStr);

      // GPU is "active" if showing ANY work above true-idle baseline.
      // True idle: ~17W, 0% util. CPU-bound generation: ~30-40W, 5-15% util.
      // Active prefill/generation: 80-120W, 50-100% util.
      // Threshold is intentionally LOW to avoid killing CPU-bound generation.
      if (util > 10 || power > 25) {
        lastActiveAt = Date.now();
      }
    } catch {
      // nvidia-smi failed — assume active (don't kill on transient errors)
      lastActiveAt = Date.now();
    }

    const idleMs = Date.now() - lastActiveAt;
    const totalMs = Date.now() - startedAt;

    // Abort if GPU truly idle for threshold (120s of consecutive low readings)
    if (idleMs > idleThresholdMs) {
      controller.abort(new Error(`GPU idle for ${Math.round(idleMs / 1000)}s — inference likely complete or failed`));
      clearInterval(interval);
      return;
    }

    // Absolute safety valve
    if (totalMs > absoluteMaxMs) {
      controller.abort(new Error(`Absolute timeout (${Math.round(absoluteMaxMs / 60_000)}min) reached`));
      clearInterval(interval);
    }
  }, 15_000);

  // Auto-cleanup if signal aborts from any source
  controller.signal.addEventListener('abort', () => clearInterval(interval), { once: true });

  return { signal: controller.signal, cleanup: () => clearInterval(interval) };
}
