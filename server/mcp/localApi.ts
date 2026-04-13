/**
 * Local API adapter — mimics the HTTP API but calls NexusStore directly.
 *
 * This lets the MCP server work self-contained (no Express needed).
 * The tool handlers in index.ts call nexusFetch(path, opts) — this module
 * provides the same interface but routes to in-process store methods.
 *
 * Used when NEXUS_STANDALONE=1 or when the Express server is unreachable.
 */

import { mkdirSync, existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

// ── Data directory ──────────────────────────────────────
const NEXUS_HOME = process.env.NEXUS_HOME || join(homedir(), '.nexus');
if (!existsSync(NEXUS_HOME)) mkdirSync(NEXUS_HOME, { recursive: true });

// Point the store at ~/.nexus/nexus.json
process.env.NEXUS_DB_PATH = process.env.NEXUS_DB_PATH || join(NEXUS_HOME, 'nexus.json');

// Must import AFTER setting env var
const { NexusStore } = await import('../db/store.ts');
const store = new NexusStore();

// Broadcast stub (no WebSocket in standalone mode)
const broadcast = () => {};

// ── AI detection (optional) ─────────────────────────────
const AI_ENDPOINTS = [
  { name: 'LM Studio', base: 'http://localhost:1234/v1', type: 'openai' },
  { name: 'Ollama', base: 'http://localhost:11434', type: 'ollama' },
];

async function detectAI(): Promise<any> {
  for (const ep of AI_ENDPOINTS) {
    try {
      const url = ep.type === 'ollama' ? `${ep.base}/api/tags` : `${ep.base}/models`;
      const res = await fetch(url, { signal: AbortSignal.timeout(2000) });
      if (!res.ok) continue;
      const data: any = await res.json();
      const models = ep.type === 'ollama'
        ? (data.models || []).map((m: any) => m.name)
        : (data.data || []).filter((m: any) => !m.id.includes('embed')).map((m: any) => m.id);
      if (models.length === 0) continue;
      return { available: true, provider: ep.name, base: ep.base, type: ep.type, model: models[0] };
    } catch {}
  }
  return { available: false };
}

// ── Route dispatcher ────────────────────────────────────
// Mimics Express API routes — same paths, same request/response shapes.

export async function localApiFetch(path: string, init: any = {}): Promise<any> {
  const method = init.method || 'GET';
  const body = init.body ? JSON.parse(init.body) : {};

  // Parse path + query
  const [pathname, qs] = path.split('?');
  const params = new URLSearchParams(qs || '');

  // ── Tasks ─────────────────────────────────────────
  if (pathname === '/api/tasks' && method === 'GET') {
    return store.getAllTasks();
  }
  if (pathname === '/api/tasks' && method === 'POST') {
    if (!body.title?.trim()) throw new Error('400: Task title required.');
    const task = store.createTask({ title: body.title.trim(), description: body.description, status: body.status, priority: body.priority, decision_ids: body.decision_ids });
    store.addActivity('task_created', `Plotted -- "${body.title}"`);
    return task;
  }
  if (pathname.match(/^\/api\/tasks\/\d+$/) && method === 'PATCH') {
    const id = parseInt(pathname.split('/').pop()!);
    const result = store.updateTask(id, body);
    if (!result) throw new Error('404: Task not found.');
    if (body.status === 'done') store.recordTaskCompletion(id);
    return { ...result.task, resolvedThoughts: result.resolvedThoughts || 0 };
  }
  if (pathname.match(/^\/api\/tasks\/\d+$/) && method === 'DELETE') {
    const id = parseInt(pathname.split('/').pop()!);
    const task = store.deleteTask(id);
    if (!task) throw new Error('404: Task not found.');
    return task;
  }

  // ── Activity ──────────────────────────────────────
  if (pathname === '/api/activity' && method === 'GET') {
    const limit = Math.min(parseInt(params.get('limit') || '50'), 200);
    return store.getActivity(limit);
  }
  if (pathname === '/api/activity' && method === 'POST') {
    return store.addActivity(body.type || 'system', body.message || '');
  }

  // ── Sessions ──────────────────────────────────────
  if (pathname === '/api/sessions' && method === 'GET') {
    const project = params.get('project') || undefined;
    const limit = Math.min(parseInt(params.get('limit') || '20'), 200);
    return store.getSessions({ project, limit });
  }
  if (pathname === '/api/sessions' && method === 'POST') {
    if (!body.project || !body.summary) throw new Error('400: Project and summary required.');
    const session = store.createSession(body);
    store.addActivity('session', `Session logged -- [${body.project}] ${body.summary.slice(0, 60)}`);
    return session;
  }

  // ── Ledger ────────────────────────────────────────
  if (pathname === '/api/ledger' && method === 'GET') {
    const project = params.get('project') || undefined;
    const limit = parseInt(params.get('limit') || '50');
    return store.getLedger({ project, limit });
  }
  if (pathname === '/api/ledger' && method === 'POST') {
    if (!body.decision?.trim()) throw new Error('400: Decision text required.');
    const entry = store.recordDecision({ decision: body.decision, context: body.context || '', project: body.project || 'general', tags: body.tags || [] });
    store.addActivity('decision', `Decision recorded -- [${entry.project}] ${body.decision.slice(0, 60)}`);
    return entry;
  }
  if (pathname.match(/^\/api\/ledger\/\d+$/) && method === 'PATCH') {
    const id = parseInt(pathname.split('/').pop()!);
    const updates: any = {};
    if (body.decision !== undefined) updates.decision = body.decision;
    if (body.context !== undefined) updates.context = body.context;
    if (body.project !== undefined) updates.project = body.project;
    if (body.tags !== undefined) updates.tags = body.tags;
    if (body.lifecycle !== undefined) updates.lifecycle = body.lifecycle;
    if (body.confidence !== undefined) updates.confidence = body.confidence;
    if (body.last_reviewed_at !== undefined) updates.last_reviewed_at = body.last_reviewed_at;
    if (body.deprecated !== undefined) {
      const d = store.getDecisionById(id);
      if (d) { d.deprecated = !!body.deprecated; store._flush(); }
    }
    if (Object.keys(updates).length > 0) store.updateDecision(id, updates);
    const result = store.getDecisionById(id);
    if (!result) throw new Error('404: Decision not found.');
    return result;
  }
  if (pathname === '/api/ledger/link' && method === 'POST') {
    return store.addEdge(body.from, body.to, body.rel || 'related', body.note || '');
  }
  if (pathname === '/api/ledger/graph/full') {
    return store.getGraph();
  }

  // ── Thoughts ──────────────────────────────────────
  if (pathname === '/api/thoughts' && method === 'GET') {
    const project = params.get('project') || undefined;
    return store.getActiveThoughts(project);
  }
  if (pathname === '/api/thoughts' && method === 'POST') {
    if (!body.text?.trim()) throw new Error('400: Thought text required.');
    const thought = store.pushThought(body);
    store.addActivity('thought', `Pushed thought: ${body.text.slice(0, 60)}`);
    return thought;
  }
  if (pathname === '/api/thoughts/pop' && method === 'POST') {
    const thought = store.popThought(body.id);
    if (!thought) throw new Error('404: No active thoughts to pop.');
    store.addActivity('thought', `Popped thought #${thought.id}: ${thought.text.slice(0, 60)}`);
    return thought;
  }
  if (pathname.match(/^\/api\/thoughts\/\d+\/abandon$/) && method === 'PATCH') {
    const id = parseInt(pathname.split('/')[3]);
    const thought = store.abandonThought(id, body.reason || '');
    if (!thought) throw new Error('404: Thought not found.');
    return thought;
  }

  // ── Usage ─────────────────────────────────────────
  if (pathname === '/api/usage' && method === 'POST') {
    // Save plan/timezone config if provided
    if (body.plan || body.timezone) {
      const updates: any = {};
      if (body.plan) updates.plan = body.plan;
      if (body.timezone) updates.timezone = body.timezone;
      const current = store.getFuelConfig() || { plan: 'pro', timezone: 'Europe/Prague', sessionWindowHours: 5, weeklyResetDay: 4, weeklyResetHour: 21 };
      store.setFuelConfig({ ...current, ...updates });
    }
    const entry = store.logUsage({ session_percent: body.session_percent, weekly_percent: body.weekly_percent, note: body.note });
    return { ...entry, timing: {} };
  }

  // ── Estimator ─────────────────────────────────────
  if (pathname === '/api/estimator') {
    const history = store.getUsage(50);
    if (history.length === 0) return { tracked: false };
    const latest = history[0];
    return {
      tracked: true,
      reported: { session: latest.session_percent, weekly: latest.weekly_percent, at: latest.created_at },
      estimated: { session: latest.session_percent, weekly: latest.weekly_percent, source: 'reported' },
    };
  }

  // ── Guard ─────────────────────────────────────────
  if (pathname === '/api/guard') {
    const title = params.get('title') || '';
    if (!title) throw new Error('400: title required.');
    return store.checkForRedundancy(title);
  }

  // ── Critique ──────────────────────────────────────
  if (pathname === '/api/critique') {
    return store.getSelfCritique();
  }

  // ── Predict ───────────────────────────────────────
  if (pathname === '/api/predict') {
    // Simplified predict — the full version needs fs access for git repos
    return { suggestions: [] };
  }

  // ── Plan (requires AI) ────────────────────────────
  if (pathname === '/api/plan') {
    return { error: 'Plan requires AI (LM Studio). Run the full Nexus server for AI features.' };
  }

  // ── Overseer risks ────────────────────────────────
  if (pathname === '/api/overseer/risks') {
    // Lightweight risk scan — no AI needed
    const tasks = store.getAllTasks();
    const usage = store.getLatestUsage();
    const risks: any[] = [];
    if (usage?.weekly_percent != null && usage.weekly_percent <= 10) {
      risks.push({ level: 'warning', message: `Weekly Claude usage at ${usage.weekly_percent}% — ration carefully` });
    }
    if (usage?.session_percent != null && usage.session_percent <= 15) {
      risks.push({ level: 'warning', message: `Session fuel low (${usage.session_percent}%) — consider wrapping up` });
    }
    return { risks };
  }

  // ── Overseer ask ──────────────────────────────────
  if (pathname === '/api/overseer/ask' && method === 'POST') {
    const ai = await detectAI();
    if (!ai.available) return { error: 'No local AI available. Install LM Studio for Overseer features.' };
    return { error: 'Overseer ask requires the full Nexus server. Use nexus_ask_overseer_start for async queries.' };
  }

  // ── Search ────────────────────────────────────────
  if (pathname === '/api/search' || pathname === '/api/smart-search') {
    const q = params.get('q') || '';
    return store.search(q);
  }

  // ── Bookmarks ─────────────────────────────────────
  if (pathname === '/api/bookmarks' && method === 'GET') return store.getAllBookmarks();
  if (pathname === '/api/bookmarks' && method === 'POST') return store.createBookmark(body);
  if (pathname.match(/^\/api\/bookmarks\/\d+$/) && method === 'DELETE') {
    const id = parseInt(pathname.split('/').pop()!);
    return store.deleteBookmark(id);
  }

  // ── Impact ────────────────────────────────────────
  if (pathname.match(/^\/api\/impact\/blast\/\d+$/)) {
    const id = parseInt(pathname.split('/').pop()!);
    const decision = store.getDecisionById(id);
    if (!decision) throw new Error('404: Decision not found.');
    const edges = store.getEdgesFor(id);
    return { decision, blastRadius: edges.length, affected: [], related: edges, warning: `${edges.length} connections.` };
  }
  if (pathname === '/api/impact/centrality') {
    const decisions = store.getAllDecisions();
    const edges = store.getAllEdges();
    const centrality = decisions.map(d => {
      const total = edges.filter(e => e.from === d.id || e.to === d.id).length;
      return { id: d.id, decision: d.decision, project: d.project, total };
    }).sort((a, b) => b.total - a.total);
    return { centrality: centrality.slice(0, 20), averageConnections: centrality.length ? Math.round(centrality.reduce((s, c) => s + c.total, 0) / centrality.length * 10) / 10 : 0 };
  }

  // ── Fleet Overview ────────────────────────────────
  if (pathname === '/api/fleet') return store.getFleetOverview();

  // ── Advice ───────────────────────────────────────
  if (pathname.match(/^\/api\/advice\/\d+\/link-decision$/) && method === 'PATCH') {
    const id = parseInt(pathname.split('/')[3]);
    if (!body.decision_id) throw new Error('400: decision_id required.');
    const result = store.linkAdviceToDecision(id, body.decision_id);
    if (!result) throw new Error('404: Advice not found.');
    return result;
  }

  // ── Init / Status ─────────────────────────────────
  if (pathname === '/api/status') return { status: 'online', mode: 'standalone' };
  if (pathname === '/api/init') return { checks: {} };

  // ── Fallback ──────────────────────────────────────
  throw new Error(`404: Unknown route ${method} ${pathname}`);
}

/** Expose the store for direct access by the MCP handler if needed. */
export { store, detectAI };
