import { Router, type Request, type Response } from 'express';
import type { NexusStore } from '../db/store.ts';

/**
 * Hybrid Smart Search
 *
 * Combines keyword matching + semantic embeddings into one ranked result set.
 * Uses Reciprocal Rank Fusion (RRF) to merge rankings from both methods.
 *
 * Research basis:
 * - Hybrid RAG: keyword (TF-IDF-like) + semantic (embeddings)
 * - RRF: rank fusion without needing score normalization
 * - Pre-normalized vectors use dot product (faster than cosine sim)
 */

const EMBED_URL = 'http://localhost:1234/v1/embeddings';
const EMBED_MODEL = 'text-embedding-nomic-embed-text-v1.5';

// RRF constant (standard value from research)
const RRF_K = 60;

export function createSmartSearchRoutes(store: NexusStore, embedCache: Record<string, any>) {
  const router = Router();

  router.get('/', async (req: Request, res: Response) => {
    const { q, limit = 20 } = req.query;
    if (!q) return res.status(400).json({ error: 'Query q required.' });

    const corpus = buildCorpus(store);

    // Run both searches in parallel
    const [keywordResults, semanticResults] = await Promise.all([
      keywordSearch(corpus, q as string),
      semanticSearch(corpus, q as string, embedCache),
    ]);

    // Merge via Reciprocal Rank Fusion
    const fused = reciprocalRankFusion(keywordResults, semanticResults);
    const results = fused.slice(0, parseInt(limit as string));

    res.json({
      query: q,
      method: semanticResults.length > 0 ? 'hybrid' : 'keyword-only',
      results,
      stats: {
        keywordHits: keywordResults.length,
        semanticHits: semanticResults.length,
        fusedTotal: fused.length,
      },
    });
  });

  return router;
}

function buildCorpus(store: NexusStore) {
  const items: any[] = [];

  // Ledger decisions (highest priority -- structured knowledge)
  for (const d of ((store as any).data.ledger || [])) {
    items.push({
      key: `decision-${d.id}`,
      type: 'decision',
      id: d.id,
      text: `${d.decision} ${d.context} ${d.alternatives.join(' ')} ${(d.tags || []).join(' ')}`,
      display: `[${d.project}] ${d.decision}`,
      project: d.project,
      date: d.created_at,
    });
  }

  // Sessions
  for (const s of store.getSessions({ limit: 50 })) {
    items.push({
      key: `session-${s.id}`,
      type: 'session',
      id: s.id,
      text: `${s.project} ${s.summary} ${(s.decisions || []).join(' ')} ${(s.tags || []).join(' ')}`,
      display: `[${s.project}] ${s.summary.slice(0, 100)}`,
      project: s.project,
      date: s.created_at,
    });
  }

  // Tasks
  for (const t of store.getAllTasks()) {
    items.push({
      key: `task-${t.id}`,
      type: 'task',
      id: t.id,
      text: `${t.title} ${t.description}`,
      display: `[${t.status}] ${t.title}`,
      date: t.created_at,
    });
  }

  // Activity (recent)
  for (const a of store.getActivity(80)) {
    items.push({
      key: `activity-${a.id}`,
      type: 'activity',
      id: a.id,
      text: a.message,
      display: a.message,
      date: a.created_at,
    });
  }

  // Scratchpads
  for (const p of store.getAllScratchpads()) {
    items.push({
      key: `scratchpad-${p.id}`,
      type: 'scratchpad',
      id: p.id,
      text: `${p.name} ${p.content.slice(0, 500)}`,
      display: p.name,
      date: p.updated_at,
    });
  }

  return items;
}

// ── Keyword search (TF-IDF-like scoring) ──────────────
function keywordSearch(corpus: any[], query: string) {
  const terms = query.toLowerCase().split(/\s+/).filter(t => t.length > 1);
  if (terms.length === 0) return [];

  const scored: any[] = [];
  for (const item of corpus) {
    const text = item.text.toLowerCase();
    let score = 0;

    for (const term of terms) {
      // Count occurrences
      const regex = new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
      const matches = text.match(regex);
      if (matches) {
        score += matches.length;
        // Bonus for match in display/title
        if (item.display.toLowerCase().includes(term)) score += 2;
      }
    }

    // Boost decisions and sessions (more structured/valuable)
    if (item.type === 'decision') score *= 1.5;
    if (item.type === 'session') score *= 1.2;

    if (score > 0) scored.push({ ...item, score });
  }

  return scored.sort((a, b) => b.score - a.score);
}

// ── Semantic search (embedding similarity) ─────────────
async function semanticSearch(corpus: any[], query: string, cache: Record<string, any>) {
  const queryVec = await getEmbedding(query, cache);
  if (!queryVec) return [];

  const scored: any[] = [];
  for (const item of corpus) {
    const itemVec = await getEmbedding(item.text.slice(0, 500), cache);
    if (!itemVec) continue;

    // Dot product (vectors are approximately normalized by nomic-embed)
    let dot = 0;
    for (let i = 0; i < queryVec.length; i++) dot += queryVec[i] * itemVec[i];

    scored.push({ ...item, score: dot });
  }

  return scored.sort((a, b) => b.score - a.score);
}

async function getEmbedding(text: string, cache: Record<string, any>): Promise<number[] | null> {
  const key = text.slice(0, 200);
  if (cache?.[key]?.vec) return cache[key].vec;

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
    if (vec && cache) cache[key] = { vec, ts: Date.now() };
    return vec;
  } catch { return null; }
}

// ── Reciprocal Rank Fusion ─────────────────────────────
function reciprocalRankFusion(keywordResults: any[], semanticResults: any[]) {
  const scores = new Map<string, { item: any; score: number; methods: string[] }>();

  // Type boost: structured knowledge > raw activity
  const typeBoost: Record<string, number> = { decision: 1.5, session: 1.3, task: 1.1, scratchpad: 1.0, activity: 0.7 };

  // Score from keyword ranking
  keywordResults.forEach((item, rank) => {
    const key = item.key;
    const prev = scores.get(key) || { item, score: 0, methods: [] };
    const boost = typeBoost[item.type] || 1;
    prev.score += (1 / (RRF_K + rank + 1)) * boost;
    prev.methods.push('keyword');
    scores.set(key, prev);
  });

  // Score from semantic ranking
  semanticResults.forEach((item, rank) => {
    const key = item.key;
    const prev = scores.get(key) || { item, score: 0, methods: [] };
    const boost = typeBoost[item.type] || 1;
    prev.score += (1 / (RRF_K + rank + 1)) * boost;
    prev.methods.push('semantic');
    scores.set(key, prev);
  });

  return [...scores.values()]
    .sort((a, b) => b.score - a.score)
    .map(({ item, score, methods }) => ({
      type: item.type,
      id: item.id,
      display: item.display,
      project: item.project,
      date: item.date,
      score: Math.round(score * 10000) / 10000,
      methods, // which search methods found this result
    }));
}
