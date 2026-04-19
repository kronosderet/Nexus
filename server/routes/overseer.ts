import { Router, type Request, type Response } from 'express';
import { execSync } from 'child_process';
import { readdirSync, readFileSync, statSync } from 'fs';
import os from 'os';
import { join } from 'path';
import type { NexusStore } from '../db/store.ts';
import { createGpuAwareSignal } from '../lib/gpuSignal.ts';
import { acquireAiLock } from '../lib/aiSemaphore.ts';
import { aiFetch } from '../lib/aiFetch.ts';
import { PROJECTS_DIR } from '../lib/config.ts';
import { scanPlans } from '../lib/planIndex.ts';
import { scanCCMemories } from '../lib/memoryIndex.ts';
import type { Decision, GraphEdge, Task, RiskItem } from '../types.ts';
import type { PlanEntry } from '../lib/planIndex.ts';
import type { MemoryEntry } from '../lib/memoryIndex.ts';

// v4.3.5 P1 — typed repo info + centrality entry + AI config
interface RepoInfo {
  name: string;
  branch: string;
  uncommitted: number;
  lastCommit: string;
  daysSinceCommit: number;
}
interface CentralityEntry { decision: string; project: string; count: number }
interface AIConfig { base: string; model: string; provider?: string; type?: string }
interface AnthropicContentBlock { type?: string; text?: string }

type BroadcastFn = (data: unknown) => void;

// ── AI connection — shared detection from lib/aiEndpoints.ts ─────
import { detectAI } from '../lib/aiEndpoints.ts';

async function ask(ai: AIConfig, system: string, prompt: string, maxTokens = 1500): Promise<string> {
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
      const blocks: AnthropicContentBlock[] = data.content || [];
      return blocks.filter((b) => b.type === 'text').map((b) => b.text || '').join('\n').trim();
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
  const topCentral = (Object.entries(centralityMap) as Array<[string, CentralityEntry]>)
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, 5)
    .map(([id, v]) => ({ id: Number(id), ...v }));

  // Git info per repo
  const repos: RepoInfo[] = [];
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
  const projectsWithDecisions = new Set((store.getAllDecisions()).map((d: Decision) => d.project.toLowerCase()));
  const blindSpots = repos.filter(r => !projectsWithDecisions.has(r.name.toLowerCase())).map(r => r.name);

  // Advice journal: past recommendations + their outcomes (the learning loop)
  const allAdvice = store.getAdvice({ limit: 50 });
  const judgedAdvice = allAdvice.filter(a => a.accepted !== null).slice(0, 10);
  const advicePatterns = store.getAdvicePatterns();

  // v4.3 #196: CC scaffolding — plans + memory files. Read-only glimpse so the
  // Overseer can cross-reference Nexus decisions with what CC has stored about
  // the user's workflow. Bounded small (5 plans, 10 memories) to keep the
  // context prompt under control; larger surveys belong to the /nexus-audit flow.
  let ccPlans: PlanEntry[] = [];
  let ccMemories: MemoryEntry[] = [];
  try {
    const p = scanPlans(5);
    if (p.available) ccPlans = p.plans;
  } catch {}
  try {
    const m = scanCCMemories(10);
    if (m.available) ccMemories = m.memories;
  } catch {}

  return {
    tasks, sessions, activity, usage, repos, ledger,
    topCentral, blindSpots,
    graphStats: { nodes: graph.nodes.length, edges: graph.edges.length },
    judgedAdvice,
    advicePatterns,
    ccPlans,
    ccMemories,
  };
}

// Derive the ctx shape from gatherContext — keeps the interface in sync automatically.
type GatherContext = ReturnType<typeof gatherContext>;

function buildContextPrompt(ctx: GatherContext) {
  const lines: string[] = [];

  // Tasks
  const open = ctx.tasks.filter((t: Task) => t.status !== 'done');
  const done = ctx.tasks.filter((t: Task) => t.status === 'done');
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

  // v4.3 #196: CC scaffolding — surfaces what the user's Claude Code has recorded
  // about the project (plans it wrote, memory files it persisted). Lets the Overseer
  // flag inconsistencies between Nexus decisions and CC's own record.
  if (ctx.ccPlans?.length > 0) {
    lines.push('\nCC PLANS (from ~/.claude/plans/):');
    for (const p of ctx.ccPlans) {
      const age = p.ageDays === 0 ? 'today' : `${p.ageDays}d ago`;
      const proj = p.project ? `[${p.project}] ` : '';
      lines.push(`  ${proj}${p.title.slice(0, 80)} (${age})`);
    }
  }
  if (ctx.ccMemories?.length > 0) {
    lines.push('\nCC MEMORY (from ~/.claude/projects/*/memory/):');
    for (const m of ctx.ccMemories) {
      const proj = m.project ? `[${m.project}] ` : '';
      const head = (m.description || m.name || m.filename).slice(0, 90);
      lines.push(`  ${proj}[${m.type}] ${head}`);
    }
    lines.push('  (flag stale/outdated CC memory entries that conflict with current Ledger decisions)');
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
          openTasks: ctx.tasks.filter((t: Task) => t.status !== 'done').length,
          repos: ctx.repos.length,
          sessions: ctx.sessions.length,
          usage: ctx.usage,
        },
        timestamp: new Date().toISOString(),
      });
    } catch (err) {
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
    } catch (err) {
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

    const { focus = 'core', batch, files: selectedFiles } = req.body || {};
    const root = join(PROJECTS_DIR, 'Nexus');
    const files: { path: string; content: string }[] = [];

    // Selective audit: user-provided file list takes priority
    if (Array.isArray(selectedFiles) && selectedFiles.length > 0) {
      for (const rel of selectedFiles) {
        try {
          const content = readFileSync(join(root, String(rel)), 'utf-8');
          files.push({ path: String(rel), content });
        } catch {}
      }
    } else if (focus === 'core') {
      // Core files split into two batches for smaller context windows
      const CORE_BATCH_1 = [
        'server/db/store.ts', 'server/types.ts', 'server/dashboard.ts',
        'server/mcp/index.ts', 'server/lib/gpuSignal.ts', 'server/lib/embeddings.ts',
        'server/routes/tasks.ts',
      ];
      const CORE_BATCH_2 = [
        'server/routes/sessions.ts', 'server/routes/ledger.ts',
        'server/routes/usage.ts', 'server/routes/thoughts.ts', 'server/routes/impact.ts',
        'server/routes/estimator.ts', 'server/routes/guard.ts', 'server/routes/predict.ts',
      ];
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

  // v4.3 #197 — Overseer proposes typed edges between a subject decision and candidates.
  // Advisory-only: returns a taskId. Caller polls /ask/result/:taskId and parses the JSON
  // edge list, then commits chosen edges via POST /ledger/link (i.e. nexus_link_decisions).
  router.post('/propose-edges', async (req: Request, res: Response) => {
    const { decision_id, candidate_pool_size = 10, project_scope } = req.body || {};
    const id = Number(decision_id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'decision_id required.' });

    const subject = store.getAllDecisions().find((d: Decision) => d.id === id);
    if (!subject) return res.status(404).json({ error: `Decision #${id} not found.` });

    const ai = await detectAI();
    if (!ai.available) return res.json({ error: 'No local AI available. Install LM Studio and load a model.' });

    // Candidate selection: project-matched first, then recent.
    const all = store.getAllDecisions().filter((d: Decision) => d.id !== id && !d.deprecated);
    const scoped = project_scope
      ? all.filter((d: Decision) => (d.project || '').toLowerCase() === String(project_scope).toLowerCase())
      : all.filter((d: Decision) => (d.project || '').toLowerCase() === (subject.project || '').toLowerCase());
    const pool = (scoped.length >= 3 ? scoped : all)
      .sort((a: Decision, b: Decision) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
      .slice(0, Math.max(3, Math.min(30, Number(candidate_pool_size) || 10)));

    if (pool.length === 0) return res.json({ error: 'No candidate decisions available to propose edges against.' });

    const taskId = `propose-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    asyncTasks.set(taskId, {
      status: 'pending',
      question: `Edge proposals for decision #${id}`,
      startedAt: Date.now(),
    });

    const systemMsg = `You are Nexus's edge proposer. Your job is to identify typed relationships between a SUBJECT decision and a pool of CANDIDATE decisions from the same knowledge graph.

Edge types (pick the BEST fit, or omit if nothing fits):
- led_to      — the subject directly CAUSED the candidate (strong causal chain)
- depends_on  — the subject REQUIRES the candidate to exist/be true
- contradicts — the two decisions CONFLICT with each other
- replaced    — the subject supersedes the candidate (the candidate is now obsolete)
- related     — weakly connected but real
- informs     — candidate provides CONTEXT for the subject without being a hard requirement
- experimental — tentative link you're not sure about; worth revisiting

Rules:
- Be conservative. Only propose edges with real signal. "related" is the default when unsure.
- Direction matters. from→to means "from" acts on "to" via the rel.
- Output VALID JSON ONLY. No prose before or after. No markdown fences. No code blocks.
- Schema:
  { "proposals": [ { "from_id": N, "to_id": N, "rel": "...", "confidence": 0.0-1.0, "reason": "one short sentence" } ] }
- Max 5 proposals. Quality over quantity.
- If nothing fits, return { "proposals": [] }.`;

    const userMsg = `SUBJECT decision:
  #${subject.id} [${subject.project}] ${subject.decision}${subject.context ? `\n  context: ${subject.context.slice(0, 300)}` : ''}

CANDIDATE decisions (${pool.length}):
${pool.map((d: Decision) => `  #${d.id} [${d.project}] ${d.decision.slice(0, 180)}`).join('\n')}

Propose edges from the SUBJECT to one or more CANDIDATES. Remember: JSON only, max 5 proposals.`;

    // Fire and forget — same pattern as /ask/start
    ask(ai, systemMsg, userMsg, 800)
      .then((answer) => {
        const task = asyncTasks.get(taskId);
        if (task) {
          task.status = 'done';
          task.answer = answer;
          task.model = ai.model;
          task.adviceId = null;
        }
      })
      .catch((err) => {
        const task = asyncTasks.get(taskId);
        if (task) {
          task.status = 'error';
          task.error = err.message;
        }
      });

    res.json({
      taskId,
      status: 'pending',
      subject: { id: subject.id, decision: subject.decision, project: subject.project },
      candidates: pool.length,
      message: `Overseer is proposing edges. Poll /overseer/ask/result/${taskId}`,
    });
  });

  // Quick risk scan (lightweight, no AI needed)
  router.get('/risks', (req: Request, res: Response) => {
    const ctx = gatherContext(store);
    const risks: RiskItem[] = [];

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

    // Usage warnings — weekly
    if (ctx.usage?.weekly_percent != null && ctx.usage.weekly_percent <= 20) {
      risks.push({ level: 'critical', category: 'fuel', message: `Weekly Claude usage at ${ctx.usage.weekly_percent}% — ration carefully` });
    }

    // v4.3.9 #341 — session-fuel pressure (was missing; only weekly was checked).
    // Tight session budget matters even when weekly is fine.
    if (ctx.usage?.session_percent != null) {
      if (ctx.usage.session_percent <= 10) {
        risks.push({ level: 'critical', category: 'fuel', message: `Session fuel at ${ctx.usage.session_percent}% — wrap up or pivot to a small task`, fix: { cmd: 'nexus fuel', label: 'View fuel' } });
      } else if (ctx.usage.session_percent <= 20) {
        risks.push({ level: 'warning', category: 'fuel', message: `Session fuel at ${ctx.usage.session_percent}% — ration remaining tasks`, fix: { cmd: 'nexus fuel', label: 'View fuel' } });
      }
    }

    // v4.3.9 #341 — system memory pressure. Local-AI workloads (LM Studio, embeddings)
    // hit this hard. Reading os directly: cheap, no exec, no FS.
    const memPct = Math.round(((os.totalmem() - os.freemem()) / os.totalmem()) * 100);
    if (memPct >= 95) {
      risks.push({ level: 'critical', category: 'memory', message: `System memory at ${memPct}% — heavy work will swap or OOM` });
    } else if (memPct >= 85) {
      risks.push({ level: 'warning', category: 'memory', message: `System memory at ${memPct}% — consider closing apps before running Overseer` });
    }

    // v4.3.9 #341 — VRAM pressure from the most recent GPU snapshot already in store
    // (no nvidia-smi exec per request). Overseer itself uses VRAM, so this is a feedback loop.
    const gpuHistory = store.getGpuHistory(1); // last hour
    const latestGpu = gpuHistory[gpuHistory.length - 1];
    if (latestGpu && latestGpu.vram_total > 0) {
      const vramPct = Math.round((latestGpu.vram_used / latestGpu.vram_total) * 100);
      if (vramPct >= 95) {
        risks.push({ level: 'critical', category: 'vram', message: `VRAM at ${vramPct}% (${latestGpu.vram_used}/${latestGpu.vram_total} MiB) — unload a model before the next Overseer call` });
      } else if (vramPct >= 85) {
        risks.push({ level: 'warning', category: 'vram', message: `VRAM at ${vramPct}% — next local-AI call may fail or page-thrash` });
      }
    }

    // v4.3.9 #341 — orphan decisions. Signals knowledge-graph health.
    // Orphan = decision with zero in/out edges.
    const allEdges = store.getAllEdges();
    const connected = new Set<number>();
    for (const e of allEdges) { connected.add(e.from); connected.add(e.to); }
    const orphanCount = store.getAllDecisions().filter(d => !connected.has(d.id)).length;
    if (orphanCount >= 10) {
      risks.push({ level: 'warning', category: 'orphans', message: `${orphanCount} orphan decisions — knowledge graph fragmenting`, fix: { cmd: 'nexus graph holes', label: 'Review holes' } });
    } else if (orphanCount >= 5) {
      risks.push({ level: 'info', category: 'orphans', message: `${orphanCount} orphan decisions — consider linking via nexus_link_decisions`, fix: { cmd: 'nexus graph holes', label: 'Review holes' } });
    }

    res.json({ risks, scannedAt: new Date().toISOString() });
  });

  return router;
}
