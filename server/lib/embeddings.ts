import { existsSync, readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createHash } from 'crypto';

const __dirname = dirname(fileURLToPath(import.meta.url));
const EMBED_CACHE_PATH = join(__dirname, '..', '..', 'nexus-embeddings.json');
import { EMBED_MODEL, EMBED_URL } from './aiEndpoints.ts';

// ── Vector math ────────────────────────────────────────
export function cosineSim(a: number[], b: number[]): number {
  let dot = 0, magA = 0, magB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }
  return dot / (Math.sqrt(magA) * Math.sqrt(magB));
}

// ── Embedding cache ────────────────────────────────────
let cache: Record<string, { vec: number[]; ts: number }> = {};
if (existsSync(EMBED_CACHE_PATH)) {
  try { cache = JSON.parse(readFileSync(EMBED_CACHE_PATH, 'utf-8')); } catch {}
}

let savePending: NodeJS.Timeout | null = null;
function saveCache() {
  // Debounce: write at most once per 2 seconds (reduced from 5s to limit crash-window data loss)
  if (savePending) return;
  savePending = setTimeout(() => {
    savePending = null;
    const keys = Object.keys(cache);
    if (keys.length > 500) {
      const sorted = keys.sort((a, b) => (cache[a].ts || 0) - (cache[b].ts || 0));
      for (const k of sorted.slice(0, keys.length - 400)) delete cache[k];
    }
    try { writeFileSync(EMBED_CACHE_PATH, JSON.stringify(cache)); } catch {}
  }, 2000);
}

// Flush on exit
process.on('exit', () => {
  if (savePending) {
    clearTimeout(savePending);
    try { writeFileSync(EMBED_CACHE_PATH, JSON.stringify(cache)); } catch {}
  }
});

export async function getEmbedding(text: string): Promise<number[] | null> {
  // Hash full text to avoid collisions from truncation
  const key = createHash('sha256').update(text.slice(0, 1000)).digest('hex').slice(0, 32);
  if (cache[key]?.vec) return cache[key].vec;

  try {
    const res = await fetch(EMBED_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: EMBED_MODEL, input: text.slice(0, 1000) }),
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return null;
    const data: any = await res.json();
    const vec = data?.data?.[0]?.embedding;
    if (vec) {
      cache[key] = { vec, ts: Date.now() };
      saveCache();
    }
    return vec || null;
  } catch {
    return null;
  }
}

/**
 * Find the top-N most similar texts to `query` from a list of candidates.
 * Returns indices + similarity scores, sorted by similarity descending.
 */
export async function findSimilar(
  query: string,
  candidates: string[],
  topN = 5,
  threshold = 0.5
): Promise<Array<{ index: number; similarity: number }>> {
  const qVec = await getEmbedding(query);
  if (!qVec) return [];

  const results: Array<{ index: number; similarity: number }> = [];
  for (let i = 0; i < candidates.length; i++) {
    const cVec = await getEmbedding(candidates[i]);
    if (!cVec) continue;
    const sim = cosineSim(qVec, cVec);
    if (sim >= threshold) results.push({ index: i, similarity: sim });
  }

  return results.sort((a, b) => b.similarity - a.similarity).slice(0, topN);
}
