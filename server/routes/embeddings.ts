import { Router, type Request, type Response } from 'express';
import type { NexusStore } from '../db/store.ts';
// v4.9.0 #730 — single embedding cache lives in lib/embeddings.ts. Pre-fix this
// route had its OWN cache pointing at the same file with a different key shape
// (200-char raw vs sha256(1000-char)) and no debounce/exit-flush. Two writers
// stomped each other; cache hits never crossed. Now everything goes through the
// canonical helpers below.
import {
  getEmbedding,
  cosineSim,
  flushCache,
  getCacheSize,
  getCachePath,
} from '../lib/embeddings.ts';

// ── Build searchable corpus from store ─────────────────
interface EmbedCorpusItem {
  type: 'session' | 'task' | 'activity' | 'scratchpad';
  id: number;
  text: string;
  display: string;
  date: string;
}

function buildCorpus(store: NexusStore): EmbedCorpusItem[] {
  const items: EmbedCorpusItem[] = [];

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
    const scored: Array<EmbedCorpusItem & { score: number }> = [];
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
  router.post('/reindex', async (_req: Request, res: Response) => {
    const corpus = buildCorpus(store);
    let embedded = 0;
    for (const item of corpus) {
      const vec = await getEmbedding(item.text);
      if (vec) embedded++;
    }
    flushCache();
    res.json({ total: corpus.length, embedded, cacheSize: getCacheSize() });
  });

  // Cache stats
  router.get('/stats', (_req: Request, res: Response) => {
    res.json({ cacheSize: getCacheSize(), cachePath: getCachePath() });
  });

  return router;
}
