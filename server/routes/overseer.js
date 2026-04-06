import { Router } from 'express';
import { execSync } from 'child_process';
import { readdirSync, statSync } from 'fs';
import { join } from 'path';

const PROJECTS_DIR = 'C:/Projects';

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
      const data = await res.json();
      const models = ep.type === 'ollama'
        ? (data.models || []).map(m => m.name)
        : (data.data || []).filter(m => !m.id.includes('embed')).map(m => m.id);
      if (models.length === 0) continue;
      return { available: true, provider: ep.name, base: ep.base, type: ep.type, model: models[0] };
    } catch {}
  }
  return { available: false };
}

async function ask(ai, system, prompt, maxTokens = 1500) {
  // ── Anthropic Messages API (preferred) ──
  if (ai.type === 'anthropic') {
    const body = {
      model: ai.model,
      max_tokens: maxTokens,
      system,
      messages: [{ role: 'user', content: prompt }],
    };
    const res = await fetch(`${ai.base}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': 'none' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(120000),
    });
    if (!res.ok) throw new Error(`AI ${res.status}`);
    const data = await res.json();
    return (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('\n').trim();
  }

  // ── OpenAI / Ollama ──
  const url = ai.type === 'ollama' ? `${ai.base}/api/chat` : `${ai.base}/chat/completions`;
  const messages = [{ role: 'system', content: system }, { role: 'user', content: prompt }];
  const body = ai.type === 'ollama'
    ? { model: ai.model, messages, stream: false }
    : { model: ai.model, messages, max_tokens: maxTokens + 2048, temperature: 0.4 };

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(120000),
  });
  if (!res.ok) throw new Error(`AI ${res.status}`);
  const data = await res.json();

  if (ai.type === 'ollama') return data.message?.content || '';
  const choice = data.choices?.[0]?.message;
  if (choice?.content?.trim()) return choice.content.trim();
  if (choice?.reasoning_content) {
    const paras = choice.reasoning_content.trim().split(/\n\n+/).filter(p => p.trim().length > 20);
    return paras.slice(-3).join('\n\n').replace(/^\s*[*•-]\s+/gm, '').trim();
  }
  return '';
}

// ── Gather full fleet context ───────────────────────
function gatherContext(store) {
  const tasks = store.getAllTasks();
  const sessions = store.getSessions({ limit: 15 });
  const activity = store.getActivity(50);
  const usage = store.getLatestUsage();
  const ledger = store.getLedger({ limit: 15 });

  // Graph analytics
  const graph = store.getGraph();
  const edges = store.data.graph_edges || [];
  // Centrality: top 5 most connected decisions
  const centralityMap = {};
  for (const d of store.data.ledger || []) centralityMap[d.id] = { decision: d.decision, project: d.project, count: 0 };
  for (const e of edges) {
    if (centralityMap[e.from]) centralityMap[e.from].count++;
    if (centralityMap[e.to]) centralityMap[e.to].count++;
  }
  const topCentral = Object.entries(centralityMap)
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, 5)
    .map(([id, v]) => ({ id: Number(id), ...v }));

  // Git info per repo
  const repos = [];
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
  const projectsWithDecisions = new Set((store.data.ledger || []).map(d => d.project.toLowerCase()));
  const blindSpots = repos.filter(r => !projectsWithDecisions.has(r.name.toLowerCase())).map(r => r.name);

  return { tasks, sessions, activity, usage, repos, ledger, topCentral, blindSpots, graphStats: { nodes: graph.nodes.length, edges: graph.edges.length } };
}

function buildContextPrompt(ctx) {
  const lines = [];

  // Tasks
  const open = ctx.tasks.filter(t => t.status !== 'done');
  const done = ctx.tasks.filter(t => t.status === 'done');
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

export function createOverseerRoutes(store, broadcast) {
  const router = Router();

  // Full overseer analysis
  router.get('/', async (req, res) => {
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

      res.json({
        analysis,
        model: ai.model,
        provider: ai.provider,
        context: {
          openTasks: ctx.tasks.filter(t => t.status !== 'done').length,
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
  router.post('/ask', async (req, res) => {
    const { question } = req.body;
    if (!question) return res.status(400).json({ error: 'Question required.' });

    const ai = await detectAI();
    if (!ai.available) return res.json({ available: false, error: 'No local AI.' });

    const ctx = gatherContext(store);
    const contextPrompt = buildContextPrompt(ctx);

    try {
      const answer = await ask(ai, OVERSEER_SYSTEM, `Given this workspace state:\n\n${contextPrompt}\n\nQuestion: ${question}`);
      res.json({ answer, model: ai.model });
    } catch (err) {
      res.json({ error: err.message });
    }
  });

  // Quick risk scan (lightweight, no AI needed)
  router.get('/risks', (req, res) => {
    const ctx = gatherContext(store);
    const risks = [];

    // Stale repos (no commit in 14+ days)
    for (const r of ctx.repos) {
      if (r.daysSinceCommit > 14) {
        risks.push({ level: 'warning', category: 'stale', project: r.name, message: `${r.name} has gone cold (${r.daysSinceCommit}d since last commit)`, fix: { cmd: `cd C:/Projects/${r.name} && git log --oneline -5`, label: 'Review history' } });
      }
    }

    // Dirty repos (uncommitted changes)
    for (const r of ctx.repos) {
      if (r.uncommitted > 5) {
        risks.push({ level: r.uncommitted > 20 ? 'critical' : 'warning', category: 'uncommitted', project: r.name, message: `${r.name} has ${r.uncommitted} uncommitted changes at risk`, fix: { cmd: `cd C:/Projects/${r.name} && git status`, label: 'Check status' } });
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
