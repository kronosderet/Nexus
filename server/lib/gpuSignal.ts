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
 */
export function createGpuAwareSignal(
  idleThresholdMs = 60_000,
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

      // GPU is "active" if util > 30% or power > 50W
      if (util > 30 || power > 50) {
        lastActiveAt = Date.now();
      }
    } catch {
      // nvidia-smi failed — assume active (don't kill on transient errors)
      lastActiveAt = Date.now();
    }

    const idleMs = Date.now() - lastActiveAt;
    const totalMs = Date.now() - startedAt;

    // Abort if GPU idle for threshold
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
