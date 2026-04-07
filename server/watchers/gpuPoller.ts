import { execSync } from 'child_process';
import type { NexusStore } from '../db/store.ts';

type BroadcastFn = (data: any) => void;

export function startGpuPoller(store: NexusStore, broadcast?: BroadcastFn, intervalMs = 60000) {
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
    } catch {}
  }

  // Initial snapshot
  snapshot();

  const interval = setInterval(snapshot, intervalMs);
  console.log('  ◈ GPU poller active. Sampling every 60s...');
  return interval;
}
