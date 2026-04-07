import { Router, type Request, type Response } from 'express';
import type { NexusStore } from '../db/store.ts';
import type { Task } from '../types.ts';

/**
 * Autonomous Session Planner — v3.0's killer feature.
 *
 * Combines Fuel Intel + Task Backlog + Knowledge Graph + Overseer
 * into one coherent session plan: what to work on, in what order,
 * sized to fit the available fuel budget.
 *
 * Uses Gemma 4 via local AI for the strategic reasoning layer.
 */

const AI_ENDPOINTS = [
  { name: 'LM Studio (Anthropic)', base: 'http://localhost:1234/v1', type: 'anthropic' },
  { name: 'LM Studio', base: 'http://localhost:1234/v1', type: 'openai' },
];

async function detectAI(): Promise<{ available: boolean; base?: string; type?: string; model?: string }> {
  for (const ep of AI_ENDPOINTS) {
    try {
      const res = await fetch(`${ep.base}/models`, { signal: AbortSignal.timeout(2000) });
      if (!res.ok) continue;
      const data: any = await res.json();
      const models = (data.data || [])
        .filter((m: any) => !m.id.includes('embed'))
        .map((m: any) => m.id);
      if (models.length === 0) continue;
      return { available: true, base: ep.base, type: ep.type, model: models[0] };
    } catch {}
  }
  return { available: false };
}

async function askAI(ai: any, system: string, prompt: string, maxTokens = 1500): Promise<string> {
  if (ai.type === 'anthropic') {
    const res = await fetch(`${ai.base}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': 'none' },
      body: JSON.stringify({
        model: ai.model,
        max_tokens: maxTokens,
        system,
        messages: [{ role: 'user', content: prompt }],
      }),
      signal: AbortSignal.timeout(120000),
    });
    if (!res.ok) throw new Error(`AI ${res.status}`);
    const data: any = await res.json();
    return (data.content || []).filter((b: any) => b.type === 'text').map((b: any) => b.text).join('\n').trim();
  }

  const res = await fetch(`${ai.base}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: ai.model,
      messages: [{ role: 'system', content: system }, { role: 'user', content: prompt }],
      max_tokens: maxTokens + 2048,
      temperature: 0.3,
    }),
    signal: AbortSignal.timeout(120000),
  });
  if (!res.ok) throw new Error(`AI ${res.status}`);
  const data: any = await res.json();
  const choice = data.choices?.[0]?.message;
  if (choice?.content?.trim()) return choice.content.trim();
  if (choice?.reasoning_content) {
    const paras = choice.reasoning_content.trim().split(/\n\n+/).filter((p: string) => p.trim().length > 20);
    return paras.slice(-3).join('\n\n').trim();
  }
  return '';
}

const PLANNER_SYSTEM = `You are the Autonomous Session Planner for Nexus. Given a developer's current fuel state, task backlog, recent blockers, and workspace context, you generate a concrete session plan.

Your output MUST follow this exact format:

## PLAN
A 1-2 sentence summary of this session's focus.

## TASKS
1. [15m] Task title — why it matters
2. [30m] Task title — why it matters
3. [15m] Task title — why it matters

## RATIONALE
2-3 sentences explaining WHY this order. Reference fuel constraints.

## AVOID
1-2 items to explicitly defer and why.

Rules:
- Pick tasks that FIT the available fuel (don't overcommit)
- Prefer tasks that unblock other work
- Order by dependency + priority
- Reference actual task titles from the backlog
- Be concrete, not vague
- Total time estimates should fit within the runway`;

export function createPlanRoutes(store: NexusStore) {
  const router = Router();

  router.get('/', async (req: Request, res: Response) => {
    const project = typeof req.query.project === 'string' ? req.query.project : undefined;
    const plan = await buildSessionPlan(store, project);
    res.json(plan);
  });

  return router;
}

async function buildSessionPlan(store: NexusStore, projectFilter?: string) {
  // ── 1. Gather current state ─────────────────────────
  const usage = store.getLatestUsage();
  const tasks = store.getAllTasks();
  const activeTasks = tasks.filter(t => t.status !== 'done');

  // Filter by project if specified
  // For "Nexus": includes tasks that explicitly mention Nexus OR don't mention any OTHER project name
  // For any other project: exact title match
  const KNOWN_PROJECTS = ['nexus', 'firewall-godot', 'noosphere', 'resonance godot', 'resonance-godot', 'shadowrun'];
  const filtered = projectFilter
    ? activeTasks.filter(t => {
        const title = t.title.toLowerCase();
        const filter = projectFilter.toLowerCase();
        if (title.includes(filter)) return true;
        if (filter === 'nexus') {
          // Nexus = anything that doesn't explicitly belong to another known project
          const belongsToOther = KNOWN_PROJECTS
            .filter(p => p !== 'nexus')
            .some(p => title.includes(p));
          return !belongsToOther;
        }
        return false;
      })
    : activeTasks;
  const inProgress = filtered.filter(t => t.status === 'in_progress');
  const backlog = filtered.filter(t => t.status === 'backlog');

  // ── 2. Calculate fuel constraints ───────────────────
  const sessionFuel = usage?.session_percent ?? 100;
  const weeklyFuel = usage?.weekly_percent ?? 100;

  // Get timing info
  const sessionTiming = store.data._sessionTiming;
  let minutesUntilReset: number | null = null;
  if (sessionTiming?.resetTime) {
    minutesUntilReset = Math.max(0, (new Date(sessionTiming.resetTime).getTime() - Date.now()) / 60000);
  }

  // Estimate burn rate from history
  const history = store.getUsage(20);
  let burnPerHour = 50; // fallback
  if (history.length >= 2) {
    const sessionHistory = sessionTiming?.startTime
      ? history.filter(h => new Date(h.created_at) >= new Date(sessionTiming.startTime))
      : history;
    if (sessionHistory.length >= 2) {
      const newest = sessionHistory[0];
      const oldest = sessionHistory[sessionHistory.length - 1];
      const hours = (new Date(newest.created_at).getTime() - new Date(oldest.created_at).getTime()) / 3600000;
      const burned = (oldest.session_percent ?? 0) - (newest.session_percent ?? 0);
      if (hours > 0.01 && burned > 0) burnPerHour = burned / hours;
    }
  }

  // How long can we work?
  const fuelMinutes = burnPerHour > 0 ? (sessionFuel / burnPerHour) * 60 : 600;
  const effectiveRunway = minutesUntilReset != null
    ? Math.min(fuelMinutes, minutesUntilReset)
    : fuelMinutes;

  // ── 3. Recent blockers from sessions ────────────────
  const recentSessions = projectFilter
    ? store.getSessions({ project: projectFilter, limit: 5 })
    : store.getSessions({ limit: 5 });
  const activeBlockers: string[] = [];
  for (const s of recentSessions) {
    for (const b of (s.blockers || [])) activeBlockers.push(`[${s.project}] ${b}`);
  }

  // ── 4. Risk scan ────────────────────────────────────
  const risks = store._lastRiskScan?.risks || [];
  const criticalRisks = risks.filter((r: any) => r.level === 'critical');

  // ── 5. Graph intelligence: most-connected pending areas ─
  const ledger = store.data.ledger || [];
  const edges = store.data.graph_edges || [];
  const recentDecisions = [...ledger]
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
    .slice(0, 10);

  // ── 6. Build context prompt for AI ──────────────────
  const contextLines: string[] = [];
  contextLines.push(`FUEL: session ${sessionFuel}%, weekly ${weeklyFuel}%, runway ${Math.round(effectiveRunway)} min`);
  contextLines.push(`Burn rate: ${Math.round(burnPerHour)}%/hour`);
  if (minutesUntilReset != null) contextLines.push(`Session window resets in ${Math.round(minutesUntilReset)} minutes`);

  if (inProgress.length > 0) {
    contextLines.push(`\nIN PROGRESS (${inProgress.length}):`);
    for (const t of inProgress) contextLines.push(`  - ${t.title}`);
  }

  if (backlog.length > 0) {
    contextLines.push(`\nBACKLOG (${backlog.length}):`);
    for (const t of backlog.slice(0, 20)) contextLines.push(`  - ${t.title}`);
  }

  if (activeBlockers.length > 0) {
    contextLines.push(`\nACTIVE BLOCKERS:`);
    for (const b of activeBlockers.slice(0, 5)) contextLines.push(`  - ${b}`);
  }

  if (criticalRisks.length > 0) {
    contextLines.push(`\nCRITICAL RISKS:`);
    for (const r of criticalRisks.slice(0, 3)) contextLines.push(`  - ${r.message}`);
  }

  if (recentDecisions.length > 0) {
    contextLines.push(`\nRECENT DECISIONS:`);
    for (const d of recentDecisions.slice(0, 5)) contextLines.push(`  - [${d.project}] ${d.decision}`);
  }

  // ── 7. Ask AI for the plan ──────────────────────────
  const ai = await detectAI();
  let aiPlan = '';
  let aiError: string | null = null;

  if (ai.available) {
    try {
      aiPlan = await askAI(ai, PLANNER_SYSTEM, contextLines.join('\n'));
    } catch (err: any) {
      aiError = err.message;
    }
  }

  // ── 8. Heuristic fallback if AI unavailable ─────────
  const fallbackPlan = buildFallbackPlan({
    sessionFuel, effectiveRunway, inProgress, backlog, activeBlockers, burnPerHour,
  });

  // ── 9. Return complete plan ─────────────────────────
  return {
    generatedAt: new Date().toISOString(),
    fuelState: {
      session: sessionFuel,
      weekly: weeklyFuel,
      runwayMinutes: Math.round(effectiveRunway),
      burnPerHour: Math.round(burnPerHour * 10) / 10,
      resetMinutes: minutesUntilReset != null ? Math.round(minutesUntilReset) : null,
    },
    context: {
      inProgressCount: inProgress.length,
      backlogCount: backlog.length,
      blockersCount: activeBlockers.length,
      criticalRisks: criticalRisks.length,
    },
    aiPlan: aiPlan || null,
    aiProvider: ai.available ? ai.model : null,
    aiError,
    fallbackPlan,
    rawContext: contextLines.join('\n'),
  };
}

function buildFallbackPlan(opts: {
  sessionFuel: number;
  effectiveRunway: number;
  inProgress: Task[];
  backlog: Task[];
  activeBlockers: string[];
  burnPerHour: number;
}) {
  const { sessionFuel, effectiveRunway, inProgress, backlog } = opts;

  // Fuel tier
  let tier: 'wrap_up' | 'small' | 'medium' | 'full';
  if (sessionFuel <= 10 || effectiveRunway <= 15) tier = 'wrap_up';
  else if (sessionFuel <= 25) tier = 'small';
  else if (sessionFuel <= 50) tier = 'medium';
  else tier = 'full';

  // Pick tasks
  const picked: { minutes: number; task: Task }[] = [];

  // Always finish in-progress first
  for (const t of inProgress) {
    const minutes = tier === 'full' ? 30 : tier === 'medium' ? 20 : 15;
    picked.push({ minutes, task: t });
  }

  // Fill remaining runway with backlog
  let used = picked.reduce((s, p) => s + p.minutes, 0);
  const taskSize = tier === 'full' ? 30 : tier === 'medium' ? 15 : 10;

  for (const t of backlog) {
    if (used + taskSize > effectiveRunway) break;
    picked.push({ minutes: taskSize, task: t });
    used += taskSize;
  }

  return {
    tier,
    totalMinutes: used,
    tasks: picked.map(p => ({
      id: p.task.id,
      title: p.task.title,
      minutes: p.minutes,
      status: p.task.status,
    })),
    summary: tier === 'wrap_up'
      ? 'Low fuel. Wrap up current work and log session.'
      : tier === 'small'
      ? `Small session: ${picked.length} quick tasks within ${Math.round(effectiveRunway)}m runway.`
      : tier === 'medium'
      ? `Medium session: ${picked.length} tasks focused on completing in-progress work.`
      : `Full capacity: ${picked.length} tasks including new backlog items.`,
  };
}
