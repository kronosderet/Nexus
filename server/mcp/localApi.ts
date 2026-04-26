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
import type {
  Task, ActivityEntry, Decision, FuelConfig, RiskItem,
} from '../types.ts';

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

// ── AI detection — shared from lib/aiEndpoints.ts ──────
import { detectAI } from '../lib/aiEndpoints.ts';

// v4.3.5 P1 — typed fetch-style init. Body is serialized JSON string (per fetch convention).
interface LocalApiInit {
  method?: string;
  body?: string;
}

// Lazy import typing for memory entries so we don't pull memoryIndex at module load.
interface MemoryEntryLike { type: string; [k: string]: unknown }

// ── Route dispatcher ────────────────────────────────────
// Mimics Express API routes — same paths, same request/response shapes.
// Return type is `unknown` — callers in mcp/index.ts cast to the shape they expect.
export async function localApiFetch(path: string, init: LocalApiInit = {}): Promise<unknown> {
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
    const task = store.createTask({ title: body.title.trim(), description: body.description, status: body.status, priority: body.priority, decision_ids: body.decision_ids, project: body.project });
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
    const updates: Partial<Decision> = {};
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
    // Save plan/timezone config if provided.
    // v4.5.11 — also persist sliding weekly reset (weekly_reset_in_hours OR weekly_reset_at).
    if (body.plan || body.timezone || body.weekly_reset_in_hours != null || body.weekly_reset_at) {
      const updates: Partial<FuelConfig> = {};
      if (body.plan) updates.plan = body.plan;
      if (body.timezone) updates.timezone = body.timezone;
      let resetDate: Date | null = null;
      if (body.weekly_reset_at && typeof body.weekly_reset_at === 'string') {
        const d = new Date(body.weekly_reset_at);
        if (!isNaN(d.getTime())) resetDate = d;
      } else if (body.weekly_reset_in_hours != null) {
        const h = Number(body.weekly_reset_in_hours);
        if (Number.isFinite(h) && h >= 0) {
          resetDate = new Date(Date.now() + h * 3600000);
        }
      }
      // v4.5.12 — match server/routes/usage.ts: derive day+hour fallback from the
      // recorded reset so the cycle continues after weeklyResetTime passes.
      const current = store.getFuelConfig() || { plan: 'pro', timezone: 'Europe/Prague', sessionWindowHours: 5, weeklyResetDay: 6, weeklyResetHour: 10 };
      if (resetDate) {
        updates.weeklyResetTime = resetDate.toISOString();
        const localized = new Date(resetDate.toLocaleString('en-US', { timeZone: current.timezone }));
        updates.weeklyResetDay = localized.getDay();
        updates.weeklyResetHour = localized.getHours();
      }
      store.setFuelConfig({ ...current, ...updates });
    }
    const entry = store.logUsage({ session_percent: body.session_percent, weekly_percent: body.weekly_percent, sonnet_weekly_percent: body.sonnet_weekly_percent, extra_usage: body.extra_usage, note: body.note });
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

  // ── CC plan files (Plan Archaeology) ──────────────
  if (pathname === '/api/cc-plans') {
    const { scanPlans } = await import('../lib/planIndex.ts');
    const raw = parseInt(params.get('limit') || '');
    const limit = Number.isFinite(raw) && raw > 0 ? Math.min(raw, 200) : 30;
    return scanPlans(limit);
  }

  // ── CC memory files (Memory Bridge) ───────────────
  if (pathname === '/api/cc-memory') {
    const { scanCCMemories } = await import('../lib/memoryIndex.ts');
    const raw = parseInt(params.get('limit') || '');
    const limit = Number.isFinite(raw) && raw > 0 ? Math.min(raw, 200) : 50;
    const typeFilter = params.get('type');
    const index = scanCCMemories(limit * 2);
    return typeFilter
      ? { ...index, memories: index.memories.filter((m: MemoryEntryLike) => m.type === typeFilter).slice(0, limit) }
      : { ...index, memories: index.memories.slice(0, limit) };
  }

  // ── Memory Bridge import (v4.3.8 #200) ────────────
  // The MCP tool posts to /api/import-cc-memories (path stays flat for standalone).
  // Dashboard mode uses /api/cc-memory/import via createMemoryRoutes — accept both here
  // so the same MCP tool works in either mode without path-munging.
  if ((pathname === '/api/import-cc-memories' || pathname === '/api/cc-memory/import') && method === 'POST') {
    const result = store.importAllCCMemories({
      project: typeof body.project === 'string' ? body.project : undefined,
      dryRun: !!body.dry_run,
      force: !!body.force,
    });
    if (!result.dryRun && (result.imported > 0 || result.updated > 0)) {
      store.addActivity(
        'memory_import',
        `Memory Bridge -- imported ${result.imported}, updated ${result.updated}, skipped ${result.skipped}`
      );
    }
    return result;
  }

  // ── Handover (v4.6.0 #398) ─────────────────────────
  // GET /api/handover         → list all per-project handovers
  // GET /api/handover/:project → read one
  // PUT /api/handover/:project → write/replace one (body: { content, updated_by? })
  if (pathname === '/api/handover' && method === 'GET') {
    return { handovers: store.getAllHandovers() };
  }
  if (pathname.startsWith('/api/handover/')) {
    const project = decodeURIComponent(pathname.slice('/api/handover/'.length));
    if (!project) throw new Error('400: project required');
    if (method === 'GET') {
      const entry = store.getHandover(project);
      if (!entry) throw new Error('404: no handover for this project yet');
      return { project, ...entry };
    }
    if (method === 'PUT') {
      if (typeof body.content !== 'string') throw new Error('400: content (string) required');
      const entry = store.setHandover(project, body.content, typeof body.updated_by === 'string' ? body.updated_by : undefined);
      store.addActivity('system', `[${project}] Handover updated (${body.content.length} chars)`);
      return { project, ...entry };
    }
    if (method === 'DELETE') {
      const removed = store.deleteHandover(project);
      if (!removed) throw new Error('404: no handover for this project');
      return { success: true, project };
    }
  }

  // ── Overseer risks ────────────────────────────────
  if (pathname === '/api/overseer/risks') {
    // Lightweight risk scan — no AI needed
    const tasks = store.getAllTasks();
    const usage = store.getLatestUsage();
    const risks: RiskItem[] = [];
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

  // v4.3.5 C2 — auto-summary for nexus_bridge_session in standalone mode.
  // Lightweight counts-based summary: no AI, no bundle bloat. The dashboard's
  // /api/auto-summary route uses LM Studio for richer prose; standalone trades
  // quality for a tiny bundle. Same response shape so bridge_session's parser works.
  if (pathname === '/api/auto-summary' && (method === 'GET' || method === 'POST')) {
    const project = (method === 'POST' ? body.project : params.get('project')) || 'Nexus';
    const lastSessions = store.getSessions({ project, limit: 1 });
    const lastSessionTime = lastSessions[0] ? new Date(lastSessions[0].created_at).getTime() : 0;
    const windowStart = Math.max(lastSessionTime, Date.now() - 4 * 3600000);

    const activity = store.getActivity(200).filter((a: ActivityEntry) => new Date(a.created_at).getTime() > windowStart);
    const completedTasks = store.getAllTasks().filter((t: Task) =>
      t.status === 'done' && new Date(t.updated_at).getTime() > windowStart
    );
    const recentDecisions = (store.data.ledger || []).filter((d: Decision) =>
      new Date(d.created_at).getTime() > windowStart
    );

    if (activity.length === 0 && completedTasks.length === 0 && recentDecisions.length === 0) {
      return { error: 'No activity to summarize since last session.' };
    }

    const bits: string[] = [];
    if (completedTasks.length > 0) bits.push(`${completedTasks.length} task${completedTasks.length === 1 ? '' : 's'} completed`);
    if (recentDecisions.length > 0) bits.push(`${recentDecisions.length} decision${recentDecisions.length === 1 ? '' : 's'} recorded`);
    if (activity.length > 0) bits.push(`${activity.length} activity event${activity.length === 1 ? '' : 's'}`);
    const summary = `Standalone session log: ${bits.join(', ')}.`;

    const result = {
      raw: summary,
      parsed: {
        summary,
        decisions: recentDecisions.slice(0, 5).map((d: Decision) => d.decision.slice(0, 120)),
        blockers: [],
        tags: ['standalone', 'counts-summary'],
      },
      context: {
        completedTasks: completedTasks.length,
        decisions: recentDecisions.length,
        activityEvents: activity.length,
      },
      model: 'standalone-counts',
    };

    if (method === 'POST') {
      const session = store.createSession({
        project,
        summary: result.parsed.summary,
        decisions: result.parsed.decisions,
        blockers: result.parsed.blockers,
        tags: [...result.parsed.tags, 'auto-summary'],
      });
      store.addActivity('auto_summary', `Session auto-logged for ${project} (standalone, counts-based)`);
      return session;
    }
    return result;
  }

  // v4.3 #197 — propose-edges needs the async task map in the Express server.
  // Standalone MCPB mode gracefully degrades to an advisory error.
  if (pathname === '/api/overseer/propose-edges' && method === 'POST') {
    const ai = await detectAI();
    if (!ai.available) return { error: 'No local AI available. Install LM Studio for Overseer-powered edge proposals.' };
    return {
      error: 'Overseer edge proposal requires the full Nexus server (async task tracking). ' +
             'Run `npm run dashboard` from C:/Projects/Nexus and retry — the dashboard hosts the /api/overseer/propose-edges endpoint used by this tool.',
    };
  }

  // ── Search ────────────────────────────────────────
  // v4.5.6 — two separate shapes:
  //   /api/search       returns a flat array (what the dashboard SearchModal consumes)
  //   /api/smart-search returns { query, method, results, stats } (what the MCP handler
  //                     consumes via nexus_search). Prior to v4.5.6 both paths returned
  //                     the flat array, which made `data.results` undefined on the MCP
  //                     side and produced "No results" for every nexus_search call from
  //                     Claude Desktop (the dashboard UI worked because it hit /api/search).
  if (pathname === '/api/search') {
    const q = params.get('q') || '';
    return store.search(q);
  }
  if (pathname === '/api/smart-search') {
    const q = params.get('q') || '';
    const results = store.search(q);
    return {
      query: q,
      method: 'keyword',                // standalone adapter has no embedder; full hybrid lives in the dashboard route
      results,
      stats: { total: Array.isArray(results) ? results.length : 0 },
    };
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
