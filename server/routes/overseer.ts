import { Router, type Request, type Response } from 'express';
import { execSync } from 'child_process';
import { readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';
import type { NexusStore } from '../db/store.ts';
import { createGpuAwareSignal } from '../lib/gpuSignal.ts';
import { acquireAiLock } from '../lib/aiSemaphore.ts';
import { aiFetch } from '../lib/aiFetch.ts';
import { PROJECTS_DIR } from '../lib/config.ts';

type BroadcastFn = (data: any) => void;

// ── AI connection (same detection as ai.js) ─────────
const AI_ENDPOINTS = [
  { name: 'LM Studio', base: 'http://localhost:1234/v1', type: 'openai' },
  { name: 'Ollama', base: 'http://localhost:11434', type: 'ollama' },
];

async function detectAI() {
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
  return { available: false } as any;
}

async function ask(ai: any, system: string, prompt: string, maxTokens = 1500) {
  // Semaphore: only one AI inference at a time (prevents slot contention on 8GB VRAM)
  const releaseLock = await acquireAiLock();
  // GPU-aware signal: waits as long as GPU is computing, aborts when idle
  const { signal, cleanup } = createGpuAwareSignal();

  try {
    // ── Anthropic Messages API (preferred) ──
    if (ai.type === 'anthropic') {
      const payload = {
        model: ai.model,
        max_tokens: maxTokens,
        system,
        messages: [{ role: 'user', content: prompt }],
      };
      const data = await aiFetch(`${ai.base}/messages`, payload, signal);
      return (data.content || []).filter((b: any) => b.type === 'text').map((b: any) => b.text).join('\n').trim();
    }

    // ── OpenAI / Ollama ──
    const url = ai.type === 'ollama' ? `${ai.base}/api/chat` : `${ai.base}/chat/completions`;
    const messages = [{ role: 'system', content: system }, { role: 'user', content: prompt }];
    const payload = ai.type === 'ollama'
      ? { model: ai.model, messages, stream: false }
      : { model: ai.model, messages, max_tokens: maxTokens + 2048, temperature: 0.4 };

    const data = await aiFetch(url, payload, signal);

    if (ai.type === 'ollama') return data.message?.content || '';
    const choice = data.choices?.[0]?.message;
    if (choice?.content?.trim()) return choice.content.trim();
    if (choice?.reasoning_content) {
      const paras = choice.reasoning_content.trim().split(/\n\n+/).filter((p: string) => p.trim().length > 20);
      return paras.slice(-3).join('\n\n').replace(/^\s*[*•-]\s+/gm, '').trim();
    }
    return '';
  } finally {
    cleanup(); // Always stop the GPU watchdog
    releaseLock(); // Release the AI semaphore for the next queued request
  }
}

// ── Gather full fleet context ───────────────────────
function gatherContext(store: NexusStore) {
  const tasks = store.getAllTasks();
  const sessions = store.getSessions({ limit: 15 });
  const activity = store.getActivity(50);
  const usage = store.getLatestUsage();
  const ledger = store.getLedger({ limit: 15 });

  // Graph analytics
  const graph = store.getGraph();
  const edges = store.getAllEdges();
  // Centrality: top 5 most connected decisions
  const centralityMap: Record<number, { decision: string; project: string; count: number }> = {};
  for (const d of store.getAllDecisions()) centralityMap[d.id] = { decision: d.decision, project: d.project, count: 0 };
  for (const e of edges) {
    if (centralityMap[e.from]) centralityMap[e.from].count++;
    if (centralityMap[e.to]) centralityMap[e.to].count++;
  }
  const topCentral = Object.entries(centralityMap)
    .sort((a, b) => (b[1] as any).count - (a[1] as any).count)
    .slice(0, 5)
    .map(([id, v]) => ({ id: Number(id), ...v }));

  // Git info per repo
  const repos: any[] = [];
  try {
    for (const name of readdirSync(PROJECTS_DIR)) {
      const p = join(PROJECTS_DIR, name);
      try { statSync(join(p, '.git')); } catch { continue; }
      try {
        const branch = execSync('git rev-parse --abbrev-ref HEAD', { cwd: p, encoding: 'utf-8' }).trim();
        const status = execSync('git status --porcelain', { cwd: p, encoding: 'utf-8' }).trim();
        const lastDate = execSync('git log -1 --format=%aI 2>nul', { cwd: p, encoding: 'utf-8' }).trim();
        const lastMsg = execSync('git log -1 --format=%s 2>nul', { cwd: p, encoding: 'utf-8' }).trim();
        const daysSince = Math.floor((Date.now() - new Date(lastDate).getTime()) / 86400000);
        repos.push({ name, branch, uncommitted: status ? status.split('\n').length : 0, lastCommit: lastMsg, daysSinceCommit: daysSince });
      } catch {}
    }
  } catch {}

  // Blind spots: projects with repos but no Ledger decisions
  const projectsWithDecisions = new Set((store.getAllDecisions()).map((d: any) => d.project.toLowerCase()));
  const blindSpots = repos.filter(r => !projectsWithDecisions.has(r.name.toLowerCase())).map(r => r.name);

  // Advice journal: past recommendations + their outcomes (the learning loop)
  const allAdvice = store.getAdvice({ limit: 50 });
  const judgedAdvice = allAdvice.filter(a => a.accepted !== null).slice(0, 10);
  const advicePatterns = store.getAdvicePatterns();

  return {
    tasks, sessions, activity, usage, repos, ledger,
    topCentral, blindSpots,
    graphStats: { nodes: graph.nodes.length, edges: graph.edges.length },
    judgedAdvice,
    advicePatterns,
  };
}

function buildContextPrompt(ctx: any) {
  const lines: string[] = [];

  // Tasks
  const open = ctx.tasks.filter((t: any) => t.status !== 'done');
  const done = ctx.tasks.filter((t: any) => t.status === 'done');
  lines.push(`TASKS: ${open.length} open, ${done.length} completed`);
  if (open.length > 0) {
    lines.push('Open tasks:');
    for (const t of open) lines.push(`  - [${t.status}] ${t.title}`);
  }

  // Knowledge Graph analytics
  if (ctx.graphStats) {
    lines.push(`\nKNOWLEDGE GRAPH: ${ctx.graphStats.nodes} decisions, ${ctx.graphStats.edges} connections`);
    if (ctx.topCentral?.length > 0) {
      lines.push('Most foundational decisions (by connection count):');
      for (const c of ctx.topCentral) lines.push(`  - [${c.project}] ${c.decision} (${c.count} connections)`);
    }
    if (ctx.blindSpots?.length > 0) {
      lines.push(`BLIND SPOTS (projects with repos but NO indexed decisions): ${ctx.blindSpots.join(', ')}`);
    }
  }

  // Key decisions from The Ledger
  if (ctx.ledger && ctx.ledger.length > 0) {
    lines.push('\nKEY DECISIONS (from The Ledger):');
    for (const d of ctx.ledger.slice(0, 10)) {
      lines.push(`  [${d.project}] ${d.decision}${d.alternatives.length ? ` (alternatives: ${d.alternatives.join(', ')})` : ''}`);
    }
  }

  // Advice Journal: your own track record (the learning loop)
  if (ctx.advicePatterns && ctx.advicePatterns.judged > 0) {
    const p = ctx.advicePatterns;
    lines.push(`\nYOUR OWN TRACK RECORD (${p.total} recommendations made, ${p.judged} judged):`);
    if (p.acceptanceRate !== null) lines.push(`  Acceptance rate: ${p.acceptanceRate}%`);
    if (p.accuracyRate !== null) lines.push(`  Accuracy rate: ${p.accuracyRate}% (when accepted, ratio that worked)`);
    lines.push(`  Outcomes: ${p.outcomes.worked} worked, ${p.outcomes.partial} partial, ${p.outcomes.wrong} wrong`);
  }

  if (ctx.judgedAdvice && ctx.judgedAdvice.length > 0) {
    lines.push('\nPAST ADVICE WITH VERDICTS (learn from these):');
    for (const a of ctx.judgedAdvice.slice(0, 5)) {
      const verdict = a.accepted
        ? (a.outcome === 'worked' ? '✓ WORKED' : a.outcome === 'partial' ? '~ PARTIAL' : a.outcome === 'wrong' ? '✗ WRONG' : '? NO OUTCOME')
        : '✗ REJECTED';
      lines.push(`  [${verdict}] ${a.recommendation.slice(0, 120)}${a.recommendation.length > 120 ? '...' : ''}`);
      if (a.notes) lines.push(`    Note: ${a.notes}`);
    }
    lines.push('\nUse this track record to adjust your confidence. Avoid patterns that failed before.');
  }

  // Sessions (recent context)
  if (ctx.sessions.length > 0) {
    lines.push('\nRECENT SESSIONS:');
    for (const s of ctx.sessions.slice(0, 8)) {
      lines.push(`  [${s.project}] ${s.summary.slice(0, 120)}`);
      if (s.blockers.length) lines.push(`    BLOCKERS: ${s.blockers.join(', ')}`);
    }
  }

  // Repos
  if (ctx.repos.length > 0) {
    lines.push('\nGIT REPOSITORIES:');
    for (const r of ctx.repos) {
      const status = r.uncommitted > 0 ? `${r.uncommitted} uncommitted` : 'clean';
      lines.push(`  ${r.name}: ${r.branch}, ${status}, last commit ${r.daysSinceCommit}d ago ("${r.lastCommit.slice(0, 60)}")`);
    }
  }

  // Usage
  if (ctx.usage) {
    lines.push(`\nCLAUDE USAGE: session ${ctx.usage.session_percent}% remaining, weekly ${ctx.usage.weekly_percent}% remaining`);
  }

  return lines.join('\n');
}

const OVERSEER_SYSTEM = `You are the Overseer of Nexus, an AI workspace management system. You analyze the full state of a developer's project fleet and provide strategic project management guidance.

Your analysis should cover:
1. SITUATION: Brief assessment of the current workspace state
2. PRIORITIES: What should be worked on next and why (rank by urgency/impact)
3. RISKS: Projects going stale, blockers aging, uncommitted work at risk, resource constraints
4. RECOMMENDATIONS: Concrete next actions (2-4 items)

Be direct, concise, and actionable. Use the developer's project names. If Claude usage is low, factor that into your recommendations (suggest smaller tasks or deferring work).

Format your response with clear section headers. Keep total response under 300 words.`;

export function createOverseerRoutes(store: NexusStore, broadcast: BroadcastFn) {
  const router = Router();

  // Lightweight AI status check (no inference, just detection)
  router.get('/status', async (_req: Request, res: Response) => {
    const ai = await detectAI();
    res.json(ai);
  });

  // Full overseer analysis
  router.get('/', async (req: Request, res: Response) => {
    const ai = await detectAI();
    if (!ai.available) {
      return res.json({ available: false, error: 'No local AI. Start LM Studio or Ollama.' });
    }

    const ctx = gatherContext(store);
    const contextPrompt = buildContextPrompt(ctx);

    try {
      const analysis = await ask(ai, OVERSEER_SYSTEM, `Analyze this workspace and provide strategic guidance:\n\n${contextPrompt}`);

      const entry = store.addActivity('overseer', 'Overseer analysis completed');
      broadcast({ type: 'activity', payload: entry });

      // Auto-log advice to the Advice Journal
      const advice = store.recordAdvice({
        source: 'overseer',
        question: '',
        recommendation: analysis,
      });

      res.json({
        analysis,
        adviceId: advice?.id ?? null,
        model: ai.model,
        provider: ai.provider,
        context: {
          openTasks: ctx.tasks.filter((t: any) => t.status !== 'done').length,
          repos: ctx.repos.length,
          sessions: ctx.sessions.length,
          usage: ctx.usage,
        },
        timestamp: new Date().toISOString(),
      });
    } catch (err: any) {
      res.json({ error: err.message });
    }
  });

  // Ask overseer a specific question about the workspace
  router.post('/ask', async (req: Request, res: Response) => {
    const { question } = req.body;
    if (!question) return res.status(400).json({ error: 'Question required.' });

    const ai = await detectAI();
    if (!ai.available) return res.json({ available: false, error: 'No local AI.' });

    const ctx = gatherContext(store);
    const contextPrompt = buildContextPrompt(ctx);

    try {
      const answer = await ask(ai, OVERSEER_SYSTEM, `Given this workspace state:\n\n${contextPrompt}\n\nQuestion: ${question}`);

      // Auto-log advice
      const advice = store.recordAdvice({
        source: 'ask',
        question,
        recommendation: answer,
      });

      res.json({ answer, adviceId: advice?.id ?? null, model: ai.model });
    } catch (err: any) {
      res.json({ error: err.message });
    }
  });

  // ── Code audit: load full codebase into context ──────
  // Reads all server + client + CLI source files and asks the Overseer
  // to audit for bugs, dead code, inconsistencies. Runs async (fire & poll).
  // The 200k context window can hold ~90k tokens of source + reasoning.
  router.post('/code-audit', async (req: Request, res: Response) => {
    const ai = await detectAI();
    if (!ai.available) return res.json({ error: 'No local AI available.' });

    const { focus = 'core', batch } = req.body || {}; // focus: core|server|client|full, batch: 1|2 (splits core in half)
    const root = join(PROJECTS_DIR, 'Nexus');
    const files: { path: string; content: string }[] = [];

    // Core files split into two batches for smaller context windows
    const CORE_BATCH_1 = [
      'server/db/store.ts', 'server/types.ts', 'server/index.ts',
      'server/mcp/index.ts', 'server/lib/gpuSignal.ts', 'server/lib/embeddings.ts',
      'server/routes/tasks.ts',
    ];
    const CORE_BATCH_2 = [
      'server/routes/sessions.ts', 'server/routes/ledger.ts',
      'server/routes/usage.ts', 'server/routes/thoughts.ts', 'server/routes/impact.ts',
      'server/routes/estimator.ts', 'server/routes/guard.ts', 'server/routes/predict.ts',
    ];

    if (focus === 'core') {
      const fileList = batch === 1 ? CORE_BATCH_1 : batch === 2 ? CORE_BATCH_2 : [...CORE_BATCH_1, ...CORE_BATCH_2];
      for (const rel of fileList) {
        try {
          const content = readFileSync(join(root, rel), 'utf-8');
          files.push({ path: rel, content });
        } catch {}
      }
    }

    function readDir(dir: string, ext: string[], prefix = '') {
      try {
        for (const name of readdirSync(dir)) {
          const full = join(dir, name);
          try {
            const stat = statSync(full);
            if (stat.isDirectory() && !name.startsWith('.') && name !== 'node_modules' && name !== 'dist') {
              readDir(full, ext, prefix + name + '/');
            } else if (ext.some(e => name.endsWith(e))) {
              const content = readFileSync(full, 'utf-8');
              files.push({ path: prefix + name, content });
            }
          } catch {}
        }
      } catch {}
    }

    if (focus === 'full' || focus === 'server') {
      readDir(join(root, 'server'), ['.ts']);
    }
    if (focus === 'full' || focus === 'client') {
      readDir(join(root, 'client', 'src'), ['.jsx', '.js']);
    }
    if (focus === 'full') {
      readDir(join(root, 'cli'), ['.js']);
    }

    const codeBlock = files.map(f => `=== ${f.path} ===\n${f.content}`).join('\n\n');
    const totalChars = codeBlock.length;
    const estTokens = Math.round(totalChars / 4);

    const CODE_AUDIT_SYSTEM = `You are a senior code auditor reviewing the Nexus project codebase.
Your job: find REAL bugs, security issues, dead code, logic errors, and inconsistencies.
Do NOT repeat what the code does — only flag PROBLEMS.
For each finding: file path, line (approximate), severity (critical/important/polish), one-line description.
Group by severity. Be terse. Maximum 30 findings.`;

    const taskId = `audit-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    asyncTasks.set(taskId, {
      status: 'pending',
      question: `Code audit (${focus}, ${files.length} files, ~${estTokens} tokens)`,
      startedAt: Date.now(),
    });

    ask(ai, CODE_AUDIT_SYSTEM, `Audit this codebase (${files.length} files, ~${estTokens} tokens):\n\n${codeBlock}`)
      .then((answer) => {
        const task = asyncTasks.get(taskId);
        if (task) {
          task.status = 'done';
          task.answer = answer;
          task.model = ai.model;
        }
      })
      .catch((err) => {
        const task = asyncTasks.get(taskId);
        if (task) { task.status = 'error'; task.error = err.message; }
      });

    res.json({
      taskId,
      status: 'pending',
      files: files.length,
      estimatedTokens: estTokens,
      message: `Auditing ${files.length} files (~${estTokens} tokens). Poll /ask/result/${taskId}`,
    });
  });

  // ── Async ask pattern ─────────────────────────────────
  // For MCP clients with ~60s timeouts, the synchronous /ask can't return
  // in time. /ask/start fires off the AI call and returns a task_id
  // immediately. /ask/result/:id polls for the answer.
  const asyncTasks = new Map<string, {
    status: 'pending' | 'done' | 'error';
    question: string;
    answer?: string;
    error?: string;
    model?: string;
    adviceId?: number | null;
    startedAt: number;
  }>();

  // Clean up old tasks after 2 hours (long audits need results to survive)
  setInterval(() => {
    const cutoff = Date.now() - 7_200_000;
    for (const [id, task] of asyncTasks) {
      if (task.startedAt < cutoff) asyncTasks.delete(id);
    }
  }, 60_000);

  router.post('/ask/start', async (req: Request, res: Response) => {
    const { question, system_prompt, skip_context } = req.body;
    if (!question) return res.status(400).json({ error: 'Question required.' });

    const ai = await detectAI();
    if (!ai.available) return res.json({ error: 'No local AI available.' });

    const taskId = `overseer-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    asyncTasks.set(taskId, {
      status: 'pending',
      question: question.slice(0, 200),
      startedAt: Date.now(),
    });

    // Fire and forget — the inference runs in the background
    // Callers can override the system prompt for task-specific outputs
    // (e.g., code audit, auto-link proposals, structured JSON output)
    // and skip context injection when the question already contains all needed data.
    const systemMsg = system_prompt || OVERSEER_SYSTEM;
    let userMsg = question;
    if (!skip_context) {
      const ctx = gatherContext(store);
      const contextPrompt = buildContextPrompt(ctx);
      userMsg = `Given this workspace state:\n\n${contextPrompt}\n\nQuestion: ${question}`;
    }
    ask(ai, systemMsg, userMsg)
      .then((answer) => {
        const advice = store.recordAdvice({ source: 'ask', question, recommendation: answer });
        const task = asyncTasks.get(taskId);
        if (task) {
          task.status = 'done';
          task.answer = answer;
          task.model = ai.model;
          task.adviceId = advice?.id ?? null;
        }
      })
      .catch((err) => {
        const task = asyncTasks.get(taskId);
        if (task) {
          task.status = 'error';
          task.error = err.message;
        }
      });

    res.json({ taskId, status: 'pending', message: 'Overseer is thinking. Poll /ask/result/' + taskId });
  });

  router.get('/ask/result/:taskId', (req: Request, res: Response) => {
    const task = asyncTasks.get(req.params.taskId);
    if (!task) return res.status(404).json({ error: 'Task not found or expired.' });

    if (task.status === 'pending') {
      const elapsed = Math.round((Date.now() - task.startedAt) / 1000);
      return res.json({ status: 'pending', elapsed, message: `Still thinking... (${elapsed}s)` });
    }
    if (task.status === 'error') {
      return res.json({ status: 'error', error: task.error });
    }
    // Done
    res.json({
      status: 'done',
      answer: task.answer,
      model: task.model,
      adviceId: task.adviceId,
      elapsed: Math.round((Date.now() - task.startedAt) / 1000),
    });
  });

  // Quick risk scan (lightweight, no AI needed)
  router.get('/risks', (req: Request, res: Response) => {
    const ctx = gatherContext(store);
    const risks: any[] = [];

    // Stale repos (no commit in 14+ days)
    for (const r of ctx.repos) {
      if (r.daysSinceCommit > 14) {
        risks.push({ level: 'warning', category: 'stale', project: r.name, message: `${r.name} has gone cold (${r.daysSinceCommit}d since last commit)`, fix: { cmd: `cd "${join(PROJECTS_DIR, r.name)}" && git log --oneline -5`, label: 'Review history' } });
      }
    }

    // Dirty repos (uncommitted changes)
    for (const r of ctx.repos) {
      if (r.uncommitted > 5) {
        risks.push({ level: r.uncommitted > 20 ? 'critical' : 'warning', category: 'uncommitted', project: r.name, message: `${r.name} has ${r.uncommitted} uncommitted changes at risk`, fix: { cmd: `cd "${join(PROJECTS_DIR, r.name)}" && git status`, label: 'Check status' } });
      }
    }

    // Stuck tasks (in_progress for a long time)
    for (const t of ctx.tasks) {
      if (t.status === 'in_progress') {
        const age = Math.floor((Date.now() - new Date(t.created_at).getTime()) / 86400000);
        if (age > 3) {
          risks.push({ level: 'info', category: 'stuck', message: `Task "${t.title}" stuck in progress for ${age}d`, fix: { cmd: `nexus done ${t.id}`, label: 'Mark done' } });
        }
      }
    }

    // Session blockers still active
    for (const s of ctx.sessions.slice(0, 10)) {
      for (const b of (s.blockers || [])) {
        risks.push({ level: 'warning', category: 'blocker', project: s.project, message: `[${s.project}] Blocker: ${b}`, fix: { cmd: `nexus focus ${s.project}`, label: 'View project' } });
      }
    }

    // Usage warnings
    if (ctx.usage?.weekly_percent != null && ctx.usage.weekly_percent <= 20) {
      risks.push({ level: 'critical', category: 'fuel', message: `Weekly Claude usage at ${ctx.usage.weekly_percent}% — ration carefully` });
    }

    res.json({ risks, scannedAt: new Date().toISOString() });
  });

  return router;
}
