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
// v4.9.0 #730 — single in-memory cache, single writer to EMBED_CACHE_PATH.
// Before v4.9.0 server/routes/embeddings.ts had a DUPLICATE cache pointing at
// the same file with a different key shape (200-char raw vs sha256(1000-char))
// and no debounce/exit-flush. Two writers stomped each other; cache hits never
// crossed. The route module now imports from here exclusively.
const CACHE_MAX = 500;
const CACHE_EVICT_TO = 400;

let cache: Record<string, { vec: number[]; ts: number }> = {};
if (existsSync(EMBED_CACHE_PATH)) {
  try { cache = JSON.parse(readFileSync(EMBED_CACHE_PATH, 'utf-8')); }
  catch (err) {
    // v4.3.6 H5 — corrupt cache should not silently degrade into "no cache, re-fetch everything".
    console.warn('[embeddings] cache file corrupt, starting fresh:', (err as Error).message);
  }
}

// v4.9.0 #730 — in-memory eviction moved into the `set` path. Pre-fix eviction
// only ran inside saveCache (debounced 2s); a write-heavy run could grow the
// in-memory cache without bound between flushes.
function setCacheEntry(key: string, vec: number[]): void {
  cache[key] = { vec, ts: Date.now() };
  const keys = Object.keys(cache);
  if (keys.length > CACHE_MAX) {
    const sorted = keys.sort((a, b) => (cache[a].ts || 0) - (cache[b].ts || 0));
    for (const k of sorted.slice(0, keys.length - CACHE_EVICT_TO)) delete cache[k];
  }
}

let savePending: NodeJS.Timeout | null = null;
function saveCache() {
  // Debounce: write at most once per 2 seconds (reduced from 5s to limit crash-window data loss)
  if (savePending) return;
  savePending = setTimeout(() => {
    savePending = null;
    try { writeFileSync(EMBED_CACHE_PATH, JSON.stringify(cache)); }
    catch (err) {
      console.warn('[embeddings] failed to persist cache:', (err as Error).message);
    }
  }, 2000);
}

// Flush on exit
process.on('exit', () => {
  if (savePending) {
    clearTimeout(savePending);
    try { writeFileSync(EMBED_CACHE_PATH, JSON.stringify(cache)); }
    catch (err) {
      // Best-effort flush on exit; log but don't crash.
      console.warn('[embeddings] final flush failed:', (err as Error).message);
    }
  }
});

// v4.9.0 #730 — exported helpers for routes/embeddings.ts (which dropped its
// duplicate cache in favour of this module).
export function getCacheSize(): number { return Object.keys(cache).length; }
export function getCachePath(): string { return EMBED_CACHE_PATH; }
/** Force an immediate flush of the in-memory cache to disk (cancels any pending debounce). */
export function flushCache(): void {
  if (savePending) { clearTimeout(savePending); savePending = null; }
  try { writeFileSync(EMBED_CACHE_PATH, JSON.stringify(cache)); }
  catch (err) { console.warn('[embeddings] flush failed:', (err as Error).message); }
}

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
    const data: { data?: Array<{ embedding?: number[] }> } = await res.json();
    const vec = data?.data?.[0]?.embedding;
    if (vec) {
      setCacheEntry(key, vec);
      saveCache();
    }
    return vec || null;
  } catch (err) {
    // v4.3.6 H5 — LM Studio down, timeout, or network hiccup. Previously swallowed; now
    // surface at debug so users can distinguish "no LM Studio" from "bad key / corrupt cache".
    if (process.env.NEXUS_DEBUG) console.warn('[embeddings] getEmbedding failed:', (err as Error).message);
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
