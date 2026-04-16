/**
 * AI Inference Semaphore — ensures only one LM Studio request runs at a time.
 *
 * Problem: LM Studio can allocate multiple parallel slots, but on 8GB VRAM
 * this causes both inferences to crawl (observed: 0.29 tok/s vs normal 6.5
 * tok/s when two tasks competed for GPU). A 75k-token code audit + a 600-token
 * auto-summary running simultaneously is worse than running them sequentially.
 *
 * Solution: a simple async semaphore. When an AI call starts, it acquires the
 * lock. Any other AI call waits in a FIFO queue until the lock is released.
 * This ensures clean sequential execution without LM Studio slot contention.
 */

let locked = false;
const queue: Array<() => void> = [];

export async function acquireAiLock(): Promise<() => void> {
  if (!locked) {
    locked = true;
    return () => {
      locked = false;
      // Wake next waiter if any
      const next = queue.shift();
      if (next) {
        locked = true;
        next();
      }
    };
  }

  // Wait in queue
  return new Promise<() => void>((resolve) => {
    queue.push(() => {
      resolve(() => {
        locked = false;
        const next = queue.shift();
        if (next) {
          locked = true;
          next();
        }
      });
    });
  });
}

// v4.3.5 P2: Removed `isAiBusy()` and `aiQueueLength()` — exported but had zero
// consumers across the codebase. If status reporting needs them later, add back
// with the consumer alongside to prove the API is used.
