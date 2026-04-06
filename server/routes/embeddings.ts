import { Router, type Request, type Response } from 'express';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import type { NexusStore } from '../db/store.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
const EMBED_CACHE_PATH = join(__dirname, '..', '..', 'nexus-embeddings.json');
const EMBED_MODEL = 'text-embedding-nomic-embed-text-v1.5';
const EMBED_URL = 'http://localhost:1234/v1/embeddings';

// ── Vector math ────────────────────────────────────────
function cosineSim(a: number[], b: number[]) {
  let dot = 0, magA = 0, magB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }
  return dot / (Math.sqrt(magA) * Math.sqrt(magB));
}

// ── Embedding cache (persist to disk) ──────────────────
let cache: Record<string, { vec: number[]; ts: number }> = {};
if (existsSync(EMBED_CACHE_PATH)) {
  try { cache = JSON.parse(readFileSync(EMBED_CACHE_PATH, 'utf-8')); } catch {}
}

function saveCache() {
  // Keep cache bounded (max 500 entries)
  const keys = Object.keys(cache);
  if (keys.length > 500) {
    const sorted = keys.sort((a, b) => (cache[a].ts || 0) - (cache[b].ts || 0));
    for (const k of sorted.slice(0, keys.length - 400)) delete cache[k];
  }
  writeFileSync(EMBED_CACHE_PATH, JSON.stringify(cache));
}

async function getEmbedding(text: string): Promise<number[] | null> {
  const key = text.slice(0, 200); // cache key
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
    const vec = data.data?.[0]?.embedding;
    if (vec) {
      cache[key] = { vec, ts: Date.now() };
      saveCache();
    }
    return vec;
  } catch {
    return null;
  }
}

// ── Build searchable corpus from store ─────────────────
function buildCorpus(store: NexusStore) {
  const items: any[] = [];

  // Sessions (highest value -- decisions, summaries)
  for (const s of store.getSessions({ limit: 100 })) {
    const text = `[${s.project}] ${s.summary} ${(s.decisions || []).join(' ')} ${(s.blockers || []).join(' ')} ${(s.tags || []).join(' ')}`;
    items.push({ type: 'session', id: s.id, text, display: `[${s.project}] ${s.summary.slice(0, 100)}`, date: s.created_at });
  }

  // Tasks
  for (const t of store.getAllTasks()) {
    items.push({ type: 'task', id: t.id, text: `${t.title} ${t.description}`, display: `[${t.status}] ${t.title}`, date: t.created_at });
  }

  // Activity (recent, most relevant)
  for (const a of store.getActivity(100)) {
    items.push({ type: 'activity', id: a.id, text: a.message, display: a.message, date: a.created_at });
  }

  // Scratchpads
  for (const p of store.getAllScratchpads()) {
    items.push({ type: 'scratchpad', id: p.id, text: `${p.name} ${p.content.slice(0, 500)}`, display: p.name, date: p.updated_at });
  }

  return items;
}

export function createEmbeddingRoutes(store: NexusStore) {
  const router = Router();

  // Semantic search
  router.get('/search', async (req: Request, res: Response) => {
    const { q, limit = 15 } = req.query;
    if (!q) return res.status(400).json({ error: 'Query q required.' });

    const queryVec = await getEmbedding(q as string);
    if (!queryVec) return res.json({ error: 'Embedding model unavailable.', results: [] });

    const corpus = buildCorpus(store);

    // Embed all corpus items (uses cache for previously seen items)
    const scored: any[] = [];
    for (const item of corpus) {
      const itemVec = await getEmbedding(item.text);
      if (!itemVec) continue;
      const score = cosineSim(queryVec, itemVec);
      scored.push({ ...item, score });
    }

    scored.sort((a, b) => b.score - a.score);
    const results = scored.slice(0, parseInt(limit as string)).map(({ text, ...rest }) => rest);

    res.json({ query: q, results });
  });

  // Reindex: pre-embed all current data
  router.post('/reindex', async (req: Request, res: Response) => {
    const corpus = buildCorpus(store);
    let embedded = 0;
    for (const item of corpus) {
      const vec = await getEmbedding(item.text);
      if (vec) embedded++;
    }
    saveCache();
    res.json({ total: corpus.length, embedded, cacheSize: Object.keys(cache).length });
  });

  // Cache stats
  router.get('/stats', (req: Request, res: Response) => {
    res.json({ cacheSize: Object.keys(cache).length, cachePath: EMBED_CACHE_PATH });
  });

  return router;
}
