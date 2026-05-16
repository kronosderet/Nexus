import { execSync } from 'child_process';
import type { NexusStore } from '../db/store.ts';

type BroadcastFn = (data: any) => void;

export function startGpuPoller(store: NexusStore, broadcast?: BroadcastFn, intervalMs = 60000) {
  // v4.9.0 #746 — throttled error logging. Pre-fix the catch was a bare `{}` so
  // a killed nvidia-smi shell (driver reload, Windows update) silently dropped
  // every 60s sample. Now we warn once per 5 minutes so operators can see when
  // the GPU pipeline is dead instead of guessing why VRAM warnings are silent.
  let lastWarnAt = 0;
  const WARN_INTERVAL_MS = 5 * 60 * 1000;
  function snapshot() {
    try {
      const csv = execSync(
        'nvidia-smi --query-gpu=utilization.gpu,utilization.memory,memory.used,memory.total,temperature.gpu,power.draw --format=csv,noheader,nounits',
        { encoding: 'utf-8', timeout: 5000 }
      ).trim();

      const [gpuUtil, memUtil, memUsed, memTotal, temp, power] = csv.split(', ').map(s => parseFloat(s.trim()));

      const snap = store.logGpuSnapshot({
        gpu_util: gpuUtil,
        mem_util: memUtil,
        vram_used: memUsed,
        vram_total: memTotal,
        temperature: temp,
        power: power,
      });

      // Broadcast so clients can refresh without polling
      if (broadcast) broadcast({ type: 'gpu_snapshot', payload: snap });
    } catch (err) {
      const now = Date.now();
      if (now - lastWarnAt >= WARN_INTERVAL_MS) {
        lastWarnAt = now;
        console.warn(`◈ GPU poller failed (will retry every ${intervalMs / 1000}s, warning at most every 5m): ${(err as Error).message}`);
      }
    }
  }

  // Initial snapshot
  snapshot();

  const interval = setInterval(snapshot, intervalMs);
  console.log('  ◈ GPU poller active. Sampling every 60s...');
  return interval;
}
