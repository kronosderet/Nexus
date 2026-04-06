#!/usr/bin/env node

/**
 * Nexus CLI -- talk to your mission control from any project directory.
 *
 * Usage:
 *   nexus log "Fixed the auth bug"         Log activity
 *   nexus task "Add caching layer"          Create a task (backlog)
 *   nexus task -s in_progress "Refactor"    Create with status
 *   nexus tasks                             List active tasks
 *   nexus done <id>                         Mark task done
 *   nexus pulse                             Quick system pulse
 *   nexus gpu                               GPU stats (CUDA engine)
 *   nexus status                            Check if Nexus is online
 *   nexus note "some text"                  Append to Captain's Log
 */

const BASE = process.env.NEXUS_URL || 'http://localhost:3001';

function timeSince(date) {
  const s = Math.floor((Date.now() - date.getTime()) / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

function progressBar(pct, width = 20) {
  const filled = Math.round((pct / 100) * width);
  const empty = width - filled;
  const bar = '█'.repeat(filled) + '░'.repeat(empty);
  return bar;
}

async function api(path, options = {}) {
  const url = `${BASE}/api${path}`;
  try {
    const res = await fetch(url, {
      headers: { 'Content-Type': 'application/json' },
      ...options,
      body: options.body ? JSON.stringify(options.body) : undefined,
    });
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    return await res.json();
  } catch (err) {
    if (err.cause?.code === 'ECONNREFUSED') {
      console.error('  ◈ Nexus is offline. Start it with: cd C:/Projects/Nexus && npm run dev');
      process.exit(1);
    }
    throw err;
  }
}

// ── Formatting helpers ─────────────────────────────────
const dim = (s) => `\x1b[2m${s}\x1b[0m`;
const amber = (s) => `\x1b[33m${s}\x1b[0m`;
const green = (s) => `\x1b[32m${s}\x1b[0m`;
const blue = (s) => `\x1b[34m${s}\x1b[0m`;
const red = (s) => `\x1b[31m${s}\x1b[0m`;

const STATUS_COLORS = {
  backlog: dim,
  in_progress: amber,
  review: blue,
  done: green,
};

function formatTask(t) {
  const color = STATUS_COLORS[t.status] || dim;
  return `  ${dim(`#${t.id}`)} ${color(`[${t.status}]`)} ${t.title}`;
}

// ── Commands ───────────────────────────────────────────
const commands = {
  async status() {
    const data = await api('/status');
    console.log(`  ◈ Nexus is ${green('online')}. ${data.message}`);
  },

  async handoff(args) {
    const project = args[0] || process.cwd().split(/[/\\]/).pop();
    const p = project.toLowerCase();

    console.log(`\n  ${amber('◈')} ${amber('SESSION HANDOFF')} — ${green(project)}\n`);
    console.log(`  ${dim('Generated for the next agent. Copy this into the session start.')}\n`);
    console.log(`  ${dim('─'.repeat(60))}\n`);

    // 1. Fuel state
    try {
      const f = await api('/estimator');
      if (f.tracked) {
        console.log(`  ${amber('FUEL STATE')}`);
        console.log(`  Session: ${f.estimated.session}% | Weekly: ${f.estimated.weekly}%`);
        if (f.session?.resetWindow) console.log(`  Window resets in: ${f.session.resetWindow}m`);
        console.log('');
      }
    } catch {}

    // 2. Active tasks
    try {
      const tasks = await api('/tasks');
      const active = tasks.filter(t => t.status !== 'done');
      if (active.length > 0) {
        console.log(`  ${amber('ACTIVE TASKS')} (${active.length})`);
        const inProgress = active.filter(t => t.status === 'in_progress');
        const backlog = active.filter(t => t.status === 'backlog');
        for (const t of inProgress) console.log(`  ${amber('→')} [IN PROGRESS] ${t.title}`);
        for (const t of backlog.slice(0, 5)) console.log(`  ${dim('·')} [backlog] ${t.title}`);
        if (backlog.length > 5) console.log(`  ${dim(`  +${backlog.length - 5} more`)}`);
        console.log('');
      }
    } catch {}

    // 3. Last session summary
    try {
      const ctx = await api(`/sessions/context/${encodeURIComponent(project)}`);
      if (ctx.sessions.length > 0) {
        const last = ctx.sessions[0];
        console.log(`  ${amber('LAST SESSION')}`);
        console.log(`  ${last.summary}`);
        if (last.decisions?.length) console.log(`  Decisions: ${last.decisions.join(', ')}`);
        if (last.blockers?.length) console.log(`  ${red('Blockers:')} ${last.blockers.join(', ')}`);
        console.log('');
      }
    } catch {}

    // 4. Recent decisions from Ledger
    try {
      const decisions = await api(`/ledger?project=${encodeURIComponent(project)}&limit=5`);
      if (decisions.length > 0) {
        console.log(`  ${amber('KEY DECISIONS')}`);
        for (const d of decisions) console.log(`  · ${d.decision}`);
        console.log('');
      }
    } catch {}

    // 5. Risks
    try {
      const r = await api('/overseer/risks');
      if (r.risks.length > 0) {
        console.log(`  ${amber('RISKS')}`);
        for (const risk of r.risks.slice(0, 5)) {
          const c = risk.level === 'critical' ? red : amber;
          console.log(`  ${c('!')} ${risk.message}`);
        }
        console.log('');
      }
    } catch {}

    // 6. Git state for this project
    try {
      const repos = await api('/git/repos');
      const repo = repos.find(r => r.name.toLowerCase() === p);
      if (repo) {
        console.log(`  ${amber('GIT STATE')}`);
        console.log(`  Branch: ${repo.branch} | Uncommitted: ${repo.uncommitted}`);
        if (repo.lastCommit) console.log(`  Last: ${repo.lastCommit.short} ${repo.lastCommit.message}`);
        if (repo.ahead > 0) console.log(`  ${green(`↑${repo.ahead} ahead`)}`);
        if (repo.behind > 0) console.log(`  ${red(`↓${repo.behind} behind`)}`);
        console.log('');
      }
    } catch {}

    // 7. Suggested next steps
    try {
      const w = await api('/estimator/workload');
      const cs = w?.currentSession;
      if (cs?.recommendation) {
        console.log(`  ${amber('SUGGESTED NEXT')}`);
        for (const s of cs.recommendation.suggested) console.log(`  ${amber('›')} ${s}`);
        console.log('');
      }
    } catch {}

    console.log(`  ${dim('─'.repeat(60))}`);
    console.log(`  ${dim('Start next session with:')} nexus brief ${project}`);
    console.log(`  ${dim('Quick check:')} nexus quick\n`);
  },

  async quick(args) {
    const project = args[0] || process.cwd().split(/[/\\]/).pop();

    // Fuel
    try {
      const f = await api('/estimator');
      if (f.tracked) {
        const sC = f.estimated.session <= 15 ? red : f.estimated.session <= 40 ? amber : green;
        const wC = f.estimated.weekly <= 15 ? red : f.estimated.weekly <= 40 ? amber : green;
        const runway = f.session?.minutesRemaining ? `${f.session.minutesRemaining}m runway` : '';
        const chunks = f.session?.chunksRemaining != null ? `${f.session.chunksRemaining} chunks` : '';
        console.log(`  ${amber('◈')} ${sC(`S:${f.estimated.session}%`)} ${wC(`W:${f.estimated.weekly}%`)} ${dim(runway)} ${dim(chunks)}`);
      }
    } catch {}

    // Risks (count only)
    try {
      const r = await api('/overseer/risks');
      if (r.risks.length > 0) {
        const critical = r.risks.filter(x => x.level === 'critical').length;
        const warnings = r.risks.filter(x => x.level === 'warning').length;
        console.log(`  ${critical > 0 ? red(`${critical} critical`) : ''} ${warnings > 0 ? amber(`${warnings} warnings`) : ''} ${r.risks.length === 0 ? green('clear') : ''}`.trim());
      } else {
        console.log(`  ${green('◈ All clear')}`);
      }
    } catch {}

    // Top task
    try {
      const tasks = await api('/tasks');
      const inProgress = tasks.find(t => t.status === 'in_progress');
      const backlog = tasks.filter(t => t.status === 'backlog');
      if (inProgress) console.log(`  ${amber('→')} ${inProgress.title}`);
      else if (backlog.length > 0) console.log(`  ${dim('→')} ${backlog[0].title} ${dim(`(+${backlog.length - 1} backlog)`)}`);
      else console.log(`  ${dim('Calm waters.')}`);
    } catch {}
  },

  async brief(args) {
    const project = args[0] || process.cwd().split(/[/\\]/).pop();
    const p = project.toLowerCase();

    console.log(`\n  ${amber('◈')} ${amber('N E X U S')}  Briefing for ${green(project)}\n`);

    // Usage + timing
    try {
      const usage = await api('/usage/latest');
      if (usage.tracked) {
        const sColor = usage.session_percent <= 15 ? red : usage.session_percent <= 40 ? amber : green;
        const wColor = usage.weekly_percent <= 10 ? red : usage.weekly_percent <= 30 ? amber : green;
        console.log(`  ${dim('Fuel')}       Session ${sColor(`${usage.session_percent}%`)} | Weekly ${wColor(`${usage.weekly_percent}%`)}`);
        if (usage.timing) {
          console.log(`  ${dim('Resets')}     Session ${usage.timing.session.countdown} | Weekly ${usage.timing.weekly.countdown}`);
        }
        if (usage.burnRate?.estimatedEmpty) {
          console.log(`  ${dim('Burn')}       ~${usage.burnRate.sessionPerHour}%/h, empty in ~${usage.burnRate.estimatedEmpty}`);
        }
        console.log('');
      }
    } catch {}

    // Active tasks (project-specific + untagged)
    try {
      const tasks = await api('/tasks');
      const active = tasks.filter(t => t.status !== 'done');
      const projTasks = active.filter(t => t.title.toLowerCase().includes(p));
      const display = projTasks.length > 0 ? projTasks : active;
      if (display.length > 0) {
        console.log(`  ${amber('Active tasks')}${projTasks.length > 0 ? ` (${project})` : ' (all)'}:`);
        for (const t of display.slice(0, 8)) console.log(formatTask(t));
        if (display.length > 8) console.log(`    ${dim(`... +${display.length - 8} more`)}`);
        console.log('');
      } else {
        console.log(`  ${dim('Tasks')}      Calm waters. No active missions.\n`);
      }
    } catch {}

    // Risks
    try {
      const riskData = await api('/overseer/risks');
      const projRisks = riskData.risks.filter(r => !r.project || r.project.toLowerCase() === p);
      const otherRisks = riskData.risks.filter(r => r.project && r.project.toLowerCase() !== p);
      if (projRisks.length > 0) {
        console.log(`  ${red('Risks:')}`);
        for (const r of projRisks.slice(0, 4)) {
          const c = r.level === 'critical' ? red : amber;
          console.log(`    ${c('!')} ${r.message}`);
        }
        console.log('');
      }
      if (otherRisks.length > 0) {
        console.log(`  ${dim(`+ ${otherRisks.length} risk${otherRisks.length !== 1 ? 's' : ''} in other projects`)}\n`);
      }
    } catch {}

    // Recent sessions for this project
    try {
      const ctx = await api(`/sessions/context/${encodeURIComponent(project)}`);
      if (ctx.sessions.length > 0) {
        console.log(`  ${amber('Prior sessions')} (${project}):`);
        for (const s of ctx.sessions.slice(0, 3)) {
          const date = new Date(s.created_at).toLocaleDateString();
          console.log(`  ${dim(date)} ${s.summary.slice(0, 100)}${s.summary.length > 100 ? '...' : ''}`);
          if (s.decisions.length) console.log(`    ${dim('Decisions:')} ${s.decisions.join(', ')}`);
          if (s.blockers.length) console.log(`    ${amber('Blockers:')} ${s.blockers.join(', ')}`);
        }
        console.log('');
      }
    } catch {}

    // Recent decisions from The Ledger
    try {
      const decisions = await api(`/ledger?project=${encodeURIComponent(project)}&limit=5`);
      if (decisions.length > 0) {
        console.log(`  ${amber('Key decisions')} (${project}):`);
        for (const d of decisions.slice(0, 5)) {
          console.log(`    ${dim('›')} ${d.decision}`);
        }
        console.log('');
      }
    } catch {}

    // Quick digest
    try {
      const digest = await api('/digest?range=7d');
      console.log(`  ${dim('This week')}  ${digest.stats.totalEvents} events, ${digest.stats.tasksCompleted} tasks done, ${digest.stats.sessions} sessions`);
      if (digest.projectRanking.length > 0) {
        console.log(`  ${dim('Most active')} ${digest.projectRanking.slice(0, 3).map(p => p.name).join(', ')}`);
      }
    } catch {}

    console.log(`\n  ${dim('Commands: nexus task | nexus done | nexus log | nexus session | nexus usage')}\n`);
  },

  async gpu() {
    const data = await api('/pulse/gpu');
    if (!data.available) {
      console.log('  ◈ No CUDA device detected.');
      return;
    }
    const g = data;
    const tempIcon = g.temperature < 55 ? green('●') : g.temperature < 75 ? amber('●') : red('●');

    console.log(`\n  ${green('◈')} ${amber('CUDA Engine')}\n`);
    console.log(`  ${g.name}  ${dim(`Driver ${g.driver} | ${g.pstate}`)}`);
    console.log('');
    console.log(`  ${dim('GPU Load')}   ${progressBar(g.utilization.gpu)}  ${g.utilization.gpu}%`);
    console.log(`  ${dim('Mem Bus')}    ${progressBar(g.utilization.memory)}  ${g.utilization.memory}%`);
    console.log(`  ${dim('VRAM')}       ${progressBar(g.vram.percent)}  ${g.vram.used}/${g.vram.total} MiB`);
    console.log(`  ${dim('Temp')}       ${tempIcon} ${g.temperature}°C`);
    console.log(`  ${dim('Power')}      ${progressBar(g.power.percent)}  ${g.power.draw.toFixed(0)}W / ${g.power.limit.toFixed(0)}W`);
    console.log(`  ${dim('Core')}       ${g.clocks.graphics} / ${g.clocks.maxGraphics} MHz`);
    console.log(`  ${dim('VRAM Clk')}   ${g.clocks.memory} / ${g.clocks.maxMemory} MHz`);
    console.log(`  ${dim('Fan')}        ${g.fan === 0 ? 'silent' : g.fan + '%'}`);

    if (data.processes && data.processes.length > 0) {
      console.log(`\n  ${dim('GPU Processes:')}`);
      for (const p of data.processes) {
        console.log(`    ${dim(`PID ${p.pid}`)} ${p.name}${p.vram ? ` (${p.vram} MiB)` : ''}`);
      }
    }
    console.log('');
  },

  async log(args) {
    const message = args.join(' ');
    if (!message) { console.error('  Usage: nexus log "your message"'); return; }

    // Auto-detect project context
    const cwd = process.cwd();
    const project = cwd.split(/[/\\]/).pop();
    const fullMessage = `[${project}] ${message}`;

    await api('/activity', { method: 'POST', body: { type: 'manual', message: fullMessage } });
    console.log(`  ◈ Logged: ${fullMessage}`);
  },

  async task(args) {
    let status = 'backlog';
    const filtered = [];
    for (let i = 0; i < args.length; i++) {
      if ((args[i] === '-s' || args[i] === '--status') && args[i + 1]) {
        status = args[++i];
      } else {
        filtered.push(args[i]);
      }
    }
    const title = filtered.join(' ');
    if (!title) { console.error('  Usage: nexus task "task title" [-s status]'); return; }

    const task = await api('/tasks', { method: 'POST', body: { title, status } });
    console.log(`  ◈ Plotted: ${formatTask(task)}`);
  },

  async tasks() {
    const tasks = await api('/tasks');
    const active = tasks.filter(t => t.status !== 'done');
    if (active.length === 0) {
      console.log('  ◈ Calm waters. No active missions.');
      return;
    }
    console.log(`  ◈ ${active.length} active bearing${active.length !== 1 ? 's' : ''}:\n`);
    for (const t of active) console.log(formatTask(t));
  },

  async done(args) {
    const id = parseInt(args[0]);
    if (!id) { console.error('  Usage: nexus done <task-id>'); return; }
    const task = await api(`/tasks/${id}`, { method: 'PATCH', body: { status: 'done' } });
    console.log(`  ◈ Landmark reached: ${task.title}`);
  },

  async pulse() {
    const data = await api('/pulse');
    const { system, projects, git } = data;
    console.log(`  ◈ System Pulse\n`);
    console.log(`  ${dim('CPUs')}      ${system.cpus}`);
    console.log(`  ${dim('Memory')}    ${system.memory.percent}% used`);
    console.log(`  ${dim('Uptime')}    ${Math.floor(system.uptime / 3600)}h ${Math.floor((system.uptime % 3600) / 60)}m`);
    if (git.isRepo) {
      console.log(`  ${dim('Branch')}    ${git.branch}`);
      console.log(`  ${dim('Uncommit')}  ${git.uncommittedChanges} changes`);
    }
    console.log(`  ${dim('Projects')}  ${projects.length} surveyed`);
  },

  async note(args) {
    const text = args.join(' ');
    if (!text) { console.error('  Usage: nexus note "your note"'); return; }

    // Log as a quick session note (not scratchpad -- scratchpad is for working scratch)
    const project = process.cwd().split(/[/\\]/).pop();
    await api('/sessions', { method: 'POST', body: { project, summary: text, tags: ['note'] } });
    console.log(`  ◈ Noted for ${green(project)}.`);
  },

  async session(args) {
    // Parse flags: --decisions, --blockers, --tags, --files
    let decisions = [], blockers = [], tags = [], files_touched = [];
    const textParts = [];

    for (let i = 0; i < args.length; i++) {
      if (args[i] === '--decisions' || args[i] === '-d') { decisions = args[++i]?.split(',').map(s => s.trim()) || []; }
      else if (args[i] === '--blockers' || args[i] === '-b') { blockers = args[++i]?.split(',').map(s => s.trim()) || []; }
      else if (args[i] === '--tags' || args[i] === '-t') { tags = args[++i]?.split(',').map(s => s.trim()) || []; }
      else if (args[i] === '--files' || args[i] === '-f') { files_touched = args[++i]?.split(',').map(s => s.trim()) || []; }
      else { textParts.push(args[i]); }
    }

    const summary = textParts.join(' ');
    if (!summary) {
      console.error('  Usage: nexus session "summary of what was done"');
      console.error('    Options: --decisions "d1,d2"  --blockers "b1"  --tags "tag1,tag2"  --files "f1,f2"');
      return;
    }

    const project = process.cwd().split(/[/\\]/).pop();
    const session = await api('/sessions', {
      method: 'POST',
      body: { project, summary, decisions, blockers, files_touched, tags },
    });

    console.log(`  ◈ Session logged for ${green(project)}:`);
    console.log(`    ${summary}`);
    if (decisions.length) console.log(`    ${dim('Decisions:')} ${decisions.join(', ')}`);
    if (blockers.length) console.log(`    ${amber('Blockers:')} ${blockers.join(', ')}`);
  },

  async context(args) {
    const project = args[0] || process.cwd().split(/[/\\]/).pop();
    const data = await api(`/sessions/context/${encodeURIComponent(project)}`);

    if (data.sessions.length === 0 && data.activeTasks.length === 0) {
      console.log(`  ◈ No prior context for ${project}. Uncharted territory.`);
      return;
    }

    console.log(`  ◈ Context for ${green(project)}:\n`);

    if (data.activeTasks.length > 0) {
      console.log(`  ${amber('Active tasks:')}`);
      for (const t of data.activeTasks) console.log(`    ${formatTask(t)}`);
      console.log('');
    }

    for (const s of data.sessions.slice(0, 5)) {
      const date = new Date(s.created_at).toLocaleDateString();
      console.log(`  ${dim(date)} ${s.summary}`);
      if (s.decisions.length) console.log(`    ${dim('Decisions:')} ${s.decisions.join(', ')}`);
      if (s.blockers.length) console.log(`    ${amber('Blockers:')} ${s.blockers.join(', ')}`);
    }
  },

  async digest(args) {
    const range = args[0] || '7d';
    const data = await api(`/digest?range=${range}`);
    console.log(`\n  ◈ ${green('Activity Digest')} (${data.rangeLabel})\n`);
    console.log(`  ${data.summary}\n`);
    console.log(`  ${dim('Events')}     ${data.stats.totalEvents}`);
    console.log(`  ${dim('Commits')}    ${data.stats.commits}`);
    console.log(`  ${dim('Completed')}  ${data.stats.tasksCompleted}`);
    console.log(`  ${dim('Open')}       ${data.stats.tasksOpen}`);
    console.log(`  ${dim('Sessions')}   ${data.stats.sessions}`);
    if (data.busiestDay) console.log(`  ${dim('Busiest')}    ${data.busiestDay.day} (${data.busiestDay.count} events)`);
    if (data.projectRanking.length > 0) {
      console.log(`\n  ${amber('Project ranking:')}`);
      for (const p of data.projectRanking.slice(0, 5)) {
        console.log(`    ${p.name.padEnd(20)} ${progressBar(Math.round((p.count / data.projectRanking[0].count) * 100), 15)} ${p.count}`);
      }
    }
    if (data.activeBlockers.length > 0) {
      console.log(`\n  ${red('Blockers:')}`);
      for (const b of data.activeBlockers) console.log(`    • ${b}`);
    }
    console.log('');
  },

  async usage(args) {
    if (args.length === 0) {
      // Show current usage
      const latest = await api('/usage/latest');
      if (!latest.tracked) {
        console.log('  ◈ No usage data yet. Log with: nexus usage <session%> <weekly%>');
        return;
      }
      const sColor = latest.session_percent <= 15 ? red : latest.session_percent <= 40 ? amber : green;
      const wColor = latest.weekly_percent <= 10 ? red : latest.weekly_percent <= 30 ? amber : green;
      console.log(`\n  ◈ ${amber('Claude Usage')}\n`);
      if (latest.session_percent != null) {
        console.log(`  ${dim('Session')}  ${progressBar(latest.session_percent)}  ${sColor(`${latest.session_percent}%`)} remaining`);
      }
      if (latest.weekly_percent != null) {
        console.log(`  ${dim('Weekly')}   ${progressBar(latest.weekly_percent)}  ${wColor(`${latest.weekly_percent}%`)} remaining`);
      }
      // Timing info
      if (latest.timing) {
        const t = latest.timing;
        console.log('');
        console.log(`  ${dim('Session resets')}  ${t.session.countdown}${t.session.elapsed ? ` (${t.session.elapsed} elapsed, ${t.session.windowHours}h window)` : ''}`);
        console.log(`  ${dim('Weekly resets')}   ${t.weekly.countdown} (${t.weekly.resetsAt})`);
      }
      // Burn rate
      if (latest.burnRate?.sessionPerHour) {
        console.log(`  ${dim('Burn rate')}      ~${latest.burnRate.sessionPerHour}%/h session`);
        if (latest.burnRate.estimatedEmpty) {
          console.log(`  ${dim('Empty in')}       ~${latest.burnRate.estimatedEmpty}`);
        }
      }
      console.log(`\n  ${dim('Updated')}  ${new Date(latest.created_at).toLocaleString()}`);
      if (latest.note) console.log(`  ${dim('Note')}     ${latest.note}`);
      console.log('');
      return;
    }

    // Parse: nexus usage 65 31 --reset 288  (reset in 288 minutes = 4h48m)
    //    or: nexus usage 65 31 "some note"
    let reset_in_minutes = null;
    const filtered = [];
    for (let i = 0; i < args.length; i++) {
      if (args[i] === '--reset' || args[i] === '-r') {
        reset_in_minutes = parseFloat(args[++i]) || null;
      } else {
        filtered.push(args[i]);
      }
    }

    const session_percent = parseFloat(filtered[0]) || null;
    const weekly_percent = parseFloat(filtered[1]) || null;
    const note = filtered.slice(2).join(' ');

    const body = { session_percent, weekly_percent, note };
    if (reset_in_minutes) body.reset_in_minutes = reset_in_minutes;

    await api('/usage', { method: 'POST', body });
    let msg = `  ◈ Usage logged: session ${session_percent ?? '?'}% | weekly ${weekly_percent ?? '?'}%`;
    if (reset_in_minutes) msg += ` (resets in ${Math.floor(reset_in_minutes/60)}h ${Math.round(reset_in_minutes%60)}m)`;
    console.log(msg);
  },

  async overseer(args) {
    if (args[0] === 'risks') {
      const data = await api('/overseer/risks');
      if (data.risks.length === 0) {
        console.log(`  ${green('◈')} All clear. No risks detected.`);
        return;
      }
      console.log(`\n  ${amber('◈')} ${amber('Risk Scanner')} -- ${data.risks.length} issue${data.risks.length !== 1 ? 's' : ''}\n`);
      for (const r of data.risks) {
        const c = r.level === 'critical' ? red : r.level === 'warning' ? amber : blue;
        console.log(`  ${c(`[${r.level}]`)} ${dim(`[${r.category}]`)} ${r.message}`);
      }
      console.log('');
      return;
    }

    if (args.length > 0 && args[0] !== 'analyze') {
      // Ask a specific question
      const question = args.join(' ');
      console.log(`  ◈ Asking the Overseer...`);
      const data = await api('/overseer/ask', { method: 'POST', body: { question } });
      if (data.error) { console.log(`  ${red('◈')} ${data.error}`); return; }
      console.log(`\n${data.answer.replace(/^/gm, '  ')}\n`);
      return;
    }

    // Full analysis
    console.log(`  ◈ The Overseer is analyzing the fleet...\n`);
    const data = await api('/overseer');
    if (data.error) { console.log(`  ${red('◈')} ${data.error}`); return; }

    console.log(`  ${amber('◈')} ${amber('O V E R S E E R')}  ${dim(`(${data.provider} / ${data.model})`)}\n`);
    console.log(`${data.analysis.replace(/^/gm, '  ')}`);
    console.log(`\n  ${dim(`${data.context.openTasks} open tasks | ${data.context.repos} repos | ${data.context.sessions} sessions`)}\n`);
  },

  async notify(args) {
    const message = args.join(' ');
    if (!message) { console.error('  Usage: nexus notify "message"'); return; }
    await api('/notify', { method: 'POST', body: { title: 'Nexus', message } });
    console.log(`  ◈ Toast sent: ${message}`);
  },

  async focus(args) {
    const project = args[0] || process.cwd().split(/[/\\]/).pop();
    const data = await api(`/focus/${encodeURIComponent(project)}`);

    console.log(`\n  ${amber('◈')} ${amber('Project Focus')}: ${green(data.project)}\n`);

    // Git
    if (data.git) {
      console.log(`  ${dim('Branch')}     ${data.git.branch} (${data.git.uncommitted} uncommitted)`);
      if (data.git.commits.length > 0) {
        console.log(`  ${dim('Commits')}    ${data.git.commits.slice(0, 5).map(c => `${dim(c.hash)} ${c.message.slice(0, 50)} ${dim(c.when)}`).join('\n               ')}`);
      }
      console.log('');
    }

    // Tasks
    const openTasks = data.tasks.project.filter(t => t.status !== 'done');
    if (openTasks.length > 0) {
      console.log(`  ${amber('Tasks')} (${openTasks.length}):`);
      for (const t of openTasks) console.log(formatTask(t));
      console.log('');
    }

    // Blockers
    if (data.blockers.length > 0) {
      console.log(`  ${red('Blockers')}:`);
      for (const b of data.blockers) console.log(`    ${red('!')} ${b.text}`);
      console.log('');
    }

    // Decisions
    if (data.decisions.length > 0) {
      console.log(`  ${dim('Key decisions')}:`);
      for (const d of data.decisions.slice(0, 5)) console.log(`    ${dim('›')} ${d.text}`);
      console.log('');
    }

    // Sessions
    if (data.sessions.length > 0) {
      console.log(`  ${dim('Last session')}: ${data.sessions[0].summary.slice(0, 100)}`);
    }

    // Activity count
    console.log(`  ${dim('Activity')}   ${data.activity.length} events tracked\n`);
  },

  async fuel() {
    const data = await api('/estimator');
    if (!data.tracked) { console.log('  ◈ No fuel data. Log with: nexus usage <session%> <weekly%>'); return; }

    const sColor = data.estimated.session <= 15 ? red : data.estimated.session <= 40 ? amber : green;
    const wColor = data.estimated.weekly <= 10 ? red : data.estimated.weekly <= 30 ? amber : green;
    const confColor = data.estimated.confidence === 'high' ? green : data.estimated.confidence === 'medium' ? amber : red;

    console.log(`\n  ${amber('◈')} ${amber('Fuel Estimator')}\n`);
    console.log(`  ${dim('Session')}      ${progressBar(data.estimated.session)}  ${sColor(`${data.estimated.session}%`)}`);
    console.log(`  ${dim('Weekly')}       ${progressBar(data.estimated.weekly)}  ${wColor(`${data.estimated.weekly}%`)}`);
    console.log(`  ${dim('Confidence')}   ${confColor(data.estimated.confidence)} (reported ${data.reported.minutesAgo}m ago)`);
    console.log('');
    console.log(`  ${dim('Burn rate')}    ${data.rates.sessionPerHour}%/h session`);
    if (data.session?.minutesRemaining) {
      console.log(`  ${dim('Runway')}       ${data.session.hoursRemaining}h (${data.session.minutesRemaining}m) — ${data.session.constrainingFactor}`);
      console.log(`  ${dim('Empty at')}     ${data.session.emptyAt}`);
      console.log(`  ${dim('Work chunks')}  ~${data.session.chunksRemaining} tasks of 15min`);
    }
    if (data.session?.resetWindow) console.log(`  ${dim('Window resets')} ${data.session.resetWindow}m`);
    if (data.weekly) {
      console.log('');
      console.log(`  ${dim('Weekly pool')}  ${data.weekly.remaining}% remaining`);
      console.log(`  ${dim('Sessions')}     ${data.weekly.note}`);
    }
    console.log('');
  },

  async workload() {
    const data = await api('/estimator/workload');
    const cs = data.currentSession;
    if (!cs?.recommendation) { console.log('  ◈ Insufficient data for workload planning.'); return; }

    const actionColor = {
      wrap_up: red, small_tasks: amber, medium_tasks: blue, full_capacity: green,
    }[cs.recommendation.action] || dim;

    console.log(`\n  ${amber('◈')} ${amber('Workload Planner')}\n`);
    console.log(`  ${dim('This session:')} ${cs.fuel}% fuel, ${cs.minutesRemaining}m runway (${cs.constraint})`);
    if (data.weeklyOutlook) {
      console.log(`  ${dim('This week:')}    ${data.weeklyOutlook.remaining}% weekly, ${data.weeklyOutlook.note}`);
    }
    console.log('');
    console.log(`  ${actionColor(cs.recommendation.message)}\n`);

    console.log(`  ${dim('Task capacity (this session):')}`);
    for (const [type, info] of Object.entries(cs.taskCapacity)) {
      const bar = info.count > 0 ? green(`×${info.count}`) : red('×0');
      console.log(`    ${type.padEnd(8)} ${bar}  ${dim(`(~${info.fuelEach}% each)`)}  ${dim(info.label)}`);
    }

    console.log(`\n  ${dim('Suggested work:')}`);
    for (const s of cs.recommendation.suggested) {
      console.log(`    ${amber('›')} ${s}`);
    }
    console.log('');
  },

  async budget() {
    const data = await api('/budget');
    const tierColor = { critical: red, low: amber, moderate: blue, healthy: green }[data.tier] || dim;

    console.log(`\n  ${amber('◈')} ${amber('Budget Advisor')}\n`);
    console.log(`  ${dim('Tier')}       ${tierColor(data.tier.toUpperCase())}`);
    console.log(`  ${dim('Session')}    ${data.session_remaining}% remaining`);
    console.log(`  ${dim('Weekly')}     ${data.weekly_remaining}% remaining`);
    console.log(`  ${dim('Scope')}      ${data.scope}\n`);

    if (data.suggestions.length > 0) {
      console.log(`  ${amber('Suggestions')}:`);
      for (const s of data.suggestions) {
        const pColor = s.priority === 'urgent' ? red : s.priority === 'high' ? amber : dim;
        console.log(`    ${pColor(`[${s.priority}]`)} ${s.action}`);
        console.log(`    ${dim(s.reason)}`);
      }
    }
    console.log('');
  },

  async repos() {
    const repos = await api('/git/repos');
    if (repos.length === 0) { console.log('  ◈ No git repos found.'); return; }
    console.log(`\n  ◈ ${amber('Git Fleet')} (${repos.length} repos)\n`);
    for (const r of repos) {
      const age = r.lastCommit?.date ? timeSince(new Date(r.lastCommit.date)) : 'unknown';
      const dirty = r.uncommitted > 0 ? amber(` +${r.uncommitted}`) : '';
      const sync = r.behind > 0 ? red(` ↓${r.behind}`) : r.ahead > 0 ? green(` ↑${r.ahead}`) : '';
      console.log(`  ${r.name.padEnd(22)} ${dim(r.branch.padEnd(12))} ${dim(age.padEnd(10))}${dirty}${sync}`);
      if (r.lastCommit?.message) console.log(`  ${''.padEnd(22)} ${dim(r.lastCommit.short)} ${dim(r.lastCommit.message.slice(0, 50))}`);
    }
    console.log('');
  },

  async ai(args) {
    if (args.length === 0 || args[0] === 'status') {
      const status = await api('/ai/status');
      if (!status.available) {
        console.log('  ◈ No local AI detected. Start LM Studio or Ollama.');
        return;
      }
      console.log(`  ◈ ${green(status.provider)} is online. ${status.models.length} model${status.models.length !== 1 ? 's' : ''} loaded:`);
      for (const m of status.models) console.log(`    ${m.id}`);
      return;
    }

    if (args[0] === 'summarize') {
      console.log(`  ◈ Asking local AI to summarize...`);
      const result = await api('/ai/summarize', { method: 'POST', body: { range: args[1] || '24h' } });
      if (result.error) { console.log(`  ${red('◈')} ${result.error}`); return; }
      console.log(`\n  ${amber('◈')} AI Summary (${result.provider} / ${result.model}):\n`);
      console.log(`  ${result.summary.replace(/\n/g, '\n  ')}\n`);
      return;
    }

    // Freeform prompt
    const prompt = args.join(' ');
    const result = await api('/ai/chat', { method: 'POST', body: { prompt } });
    if (result.error) { console.log(`  ${red('◈')} ${result.error}`); return; }
    console.log(`\n  ${result.response.replace(/\n/g, '\n  ')}\n`);
  },

  async record(args) {
    let project = process.cwd().split(/[/\\]/).pop();
    let context = '', alternatives = [], tags = [];
    const textParts = [];

    for (let i = 0; i < args.length; i++) {
      if (args[i] === '--context' || args[i] === '-c') { context = args[++i] || ''; }
      else if (args[i] === '--alt' || args[i] === '-a') { alternatives = (args[++i] || '').split(',').map(s => s.trim()); }
      else if (args[i] === '--tags' || args[i] === '-t') { tags = (args[++i] || '').split(',').map(s => s.trim()); }
      else if (args[i] === '--project' || args[i] === '-p') { project = args[++i] || project; }
      else { textParts.push(args[i]); }
    }

    const decision = textParts.join(' ');
    if (!decision) {
      console.error('  Usage: nexus record "decision text" [--context "why"] [--alt "option1,option2"] [--tags "t1,t2"]');
      return;
    }

    const entry = await api('/ledger', { method: 'POST', body: { decision, context, project, alternatives, tags } });
    console.log(`  ◈ Decision #${entry.id} recorded for ${green(entry.project)}`);
    console.log(`    ${entry.decision}`);
    if (alternatives.length) console.log(`    ${dim('Alternatives:')} ${alternatives.join(', ')}`);
  },

  async decisions(args) {
    const project = args[0] || null;
    const params = project ? `?project=${encodeURIComponent(project)}` : '';
    const entries = await api(`/ledger${params}`);

    if (entries.length === 0) {
      console.log('  ◈ The Ledger is empty. Record with: nexus record "decision"');
      return;
    }

    console.log(`\n  ${amber('◈')} ${amber('The Ledger')} (${entries.length} decisions)\n`);
    for (const e of entries.slice(0, 15)) {
      const date = new Date(e.created_at).toLocaleDateString('cs-CZ');
      console.log(`  ${dim(date)} ${dim(`#${e.id}`)} ${green(`[${e.project}]`)} ${e.decision}`);
      if (e.context) console.log(`    ${dim(e.context.slice(0, 80))}`);
      if (e.alternatives.length) console.log(`    ${dim('Alternatives:')} ${e.alternatives.join(', ')}`);
    }
    console.log('');
  },

  async search(args) {
    const query = args.join(' ');
    if (!query) { console.error('  Usage: nexus search "query"'); return; }

    console.log(`  ◈ Searching: "${query}"...`);
    const data = await api(`/smart-search?q=${encodeURIComponent(query)}`);
    if (data.error) { console.log(`  ${red('◈')} ${data.error}`); return; }
    if (data.results.length === 0) { console.log('  ◈ Nothing on the charts.'); return; }

    const methodLabel = data.method === 'hybrid' ? `${green('hybrid')} (keyword + semantic)` : amber('keyword-only');
    console.log(`\n  ${amber('◈')} ${data.results.length} results via ${methodLabel}\n`);

    const typeColors = { decision: green, session: green, task: blue, activity: dim, scratchpad: amber };
    for (const r of data.results) {
      const c = typeColors[r.type] || dim;
      const methods = r.methods.map(m => m === 'keyword' ? 'K' : 'S').join('+');
      console.log(`  ${dim(methods.padEnd(3))} ${c(`[${r.type}]`)} ${r.display}`);
    }
    console.log(`\n  ${dim(`${data.stats.keywordHits} keyword + ${data.stats.semanticHits} semantic → ${data.stats.fusedTotal} fused`)}\n`);
  },

  async impact(args) {
    if (args[0] === 'blast' && args[1]) {
      const id = parseInt(args[1]);
      const data = await api(`/impact/blast/${id}`);
      console.log(`\n  ${amber('◈')} ${amber('Blast Radius')} for #${id}: ${data.decision.decision}\n`);
      console.log(`  ${data.blastRadius > 5 ? red(data.warning) : data.blastRadius > 0 ? amber(data.warning) : green(data.warning)}\n`);
      if (data.affected.length > 0) {
        console.log(`  ${dim('Downstream impact:')}`);
        for (const a of data.affected) console.log(`    ${'  '.repeat(a.depth-1)}${dim('→')} ${green(`#${a.id}`)} ${a.decision} ${dim(`[${a.project}]`)}`);
      }
      if (data.related.length > 0) {
        console.log(`  ${dim('Also related:')}`);
        for (const r of data.related) console.log(`    ${dim('~')} ${green(`#${r.id}`)} ${r.decision}`);
      }
      console.log('');
      return;
    }

    if (args[0] === 'contradictions') {
      const data = await api('/impact/contradictions');
      if (data.total === 0) { console.log(`  ${green('◈')} No contradictions detected.`); return; }
      console.log(`\n  ${amber('◈')} ${data.total} potential contradiction${data.total !== 1 ? 's' : ''}:\n`);
      for (const c of data.contradictions) console.log(`  ${red('!')} ${c.message}`);
      console.log('');
      return;
    }

    if (args[0] === 'centrality') {
      const data = await api('/impact/centrality');
      console.log(`\n  ${amber('◈')} ${amber('Decision Centrality')} (avg ${data.averageConnections} connections)\n`);
      for (const c of data.centrality.slice(0, 10)) {
        const bar = progressBar(Math.min(100, c.total * 5), 10);
        console.log(`  ${dim(`#${c.id}`.padEnd(5))} ${bar} ${dim(`${c.total}`.padStart(3))} ${c.decision.slice(0, 50)} ${dim(`[${c.project}]`)}`);
      }
      console.log('');
      return;
    }

    if (args[0] === 'holes') {
      const data = await api('/impact/holes');
      console.log(`\n  ${amber('◈')} ${amber('Structural Holes')}\n`);
      if (data.holes.length === 0) { console.log(`  ${green('All projects well-connected.')}`); }
      else {
        for (const h of data.holes) console.log(`  ${amber('!')} ${h.pair}: ${h.note}`);
      }
      console.log(`\n  ${dim('Cross-project links:')}`);
      for (const [pair, count] of Object.entries(data.crossLinks)) {
        console.log(`    ${pair.padEnd(30)} ${count}`);
      }
      console.log('');
      return;
    }

    console.log('  Usage: nexus impact blast <id> | contradictions | centrality | holes');
  },

  async link(args) {
    if (args.length < 3) {
      console.error('  Usage: nexus link <from_id> <rel> <to_id> ["note"]');
      console.error('  Relations: led_to, replaced, depends_on, contradicts, related');
      return;
    }
    const from = parseInt(args[0]);
    const rel = args[1];
    const to = parseInt(args[2]);
    const note = args.slice(3).join(' ');

    const edge = await api('/ledger/link', { method: 'POST', body: { from, to, rel, note } });
    console.log(`  ◈ Linked: #${from} --[${amber(rel)}]--> #${to}`);
  },

  async graph(args) {
    if (args[0] && !isNaN(args[0])) {
      // Traverse from a specific decision
      const id = parseInt(args[0]);
      const depth = parseInt(args[1]) || 3;
      const data = await api(`/ledger/${id}/traverse?depth=${depth}`);
      if (data.chain.length === 0) { console.log('  ◈ Decision not found.'); return; }

      console.log(`\n  ${amber('◈')} ${amber('Decision Graph')} from #${id} (depth ${depth})\n`);
      for (const node of data.chain) {
        const indent = '  '.repeat(node.depth);
        const arrow = node.depth > 0 ? `${dim(node.path[node.path.length-1]?.edge || '')} → ` : '';
        console.log(`  ${indent}${arrow}${green(`#${node.id}`)} ${node.decision}`);
        if (node.context) console.log(`  ${indent}  ${dim(node.context.slice(0, 60))}`);
      }
      console.log('');
      return;
    }

    // Full graph stats
    const data = await api('/ledger/graph/full');
    const connected = new Set();
    for (const e of data.edges) { connected.add(e.from); connected.add(e.to); }
    const orphans = data.nodes.filter(n => !connected.has(n.id)).length;

    console.log(`\n  ${amber('◈')} ${amber('Knowledge Graph')}\n`);
    console.log(`  ${dim('Decisions')}    ${data.nodes.length}`);
    console.log(`  ${dim('Connections')} ${data.edges.length}`);
    console.log(`  ${dim('Connected')}   ${connected.size} nodes`);
    console.log(`  ${dim('Orphans')}     ${orphans} (unlinked)`);

    if (data.edges.length > 0) {
      const relCounts = {};
      for (const e of data.edges) relCounts[e.rel] = (relCounts[e.rel] || 0) + 1;
      console.log(`\n  ${dim('Edge types:')}`);
      for (const [rel, count] of Object.entries(relCounts).sort((a,b) => b[1] - a[1])) {
        console.log(`    ${amber(rel.padEnd(15))} ${count}`);
      }
    }
    console.log('');
  },

  async seek(args) {
    const query = args.join(' ');
    if (!query) { console.error('  Usage: nexus seek "semantic search query"'); return; }

    console.log(`  ◈ Seeking: "${query}"...`);
    const data = await api(`/embed/search?q=${encodeURIComponent(query)}`);
    if (data.error) { console.log(`  ${red('◈')} ${data.error}`); return; }
    if (data.results.length === 0) { console.log('  ◈ Nothing on the charts.'); return; }

    console.log(`\n  ${amber('◈')} ${data.results.length} results (semantic):\n`);
    const typeColors = { session: green, task: blue, activity: dim, scratchpad: amber };
    for (const r of data.results) {
      const c = typeColors[r.type] || dim;
      const score = Math.round(r.score * 100);
      console.log(`  ${dim(`${score}%`)} ${c(`[${r.type}]`)} ${r.display}`);
    }
    console.log('');
  },

  async find(args) {
    const query = args.join(' ');
    if (!query) { console.error('  Usage: nexus find "search query"'); return; }

    const results = await api(`/search?q=${encodeURIComponent(query)}`);
    if (results.length === 0) {
      console.log(`  ◈ Nothing on the charts for "${query}".`);
      return;
    }

    const typeColors = { task: blue, activity: dim, session: green, scratchpad: amber };
    console.log(`  ◈ ${results.length} result${results.length !== 1 ? 's' : ''} for "${query}":\n`);
    for (const r of results) {
      const colorFn = typeColors[r.type] || dim;
      console.log(`  ${colorFn(`[${r.type}]`)} ${r.title}`);
    }
  },

  async activity() {
    const entries = await api('/activity?limit=15');
    if (entries.length === 0) {
      console.log("  ◈ The log is empty. Calm waters.");
      return;
    }
    console.log("  ◈ Recent activity:\n");
    for (const e of entries) {
      const time = new Date(e.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      console.log(`  ${dim(time)} ${e.message}`);
    }
  },

  async help() {
    console.log(`
  ${amber('◈')} ${amber('N E X U S')}  CLI
  ${dim('The Cartographer -- talk to mission control from anywhere.')}

  ${amber('Commands:')}
    nexus quick                     3-line status (fuel + risks + task)
    nexus brief [project]           Full agent briefing (START HERE)
    nexus handoff [project]         Generate session handoff for next agent
    nexus status                   Check if Nexus is online
    nexus pulse                    Quick system overview
    nexus gpu                      CUDA engine stats + processes
    nexus log "message"            Log activity from current project
    nexus task "title"             Create a backlog task
    nexus task -s in_progress "t"  Create task with status
    nexus tasks                    List active tasks
    nexus done <id>                Mark a task complete
    nexus session "summary"        Log a session (the memory bridge)
    nexus context [project]        Get prior context for a project
    nexus record "decision"        Record a decision to The Ledger
    nexus decisions [project]      View decision history
    nexus impact blast <id>         Blast radius: what breaks if this changes?
    nexus impact contradictions    Find conflicting decisions
    nexus impact centrality        Most foundational decisions
    nexus impact holes             Weak cross-project connections
    nexus link <from> <rel> <to>   Link two decisions (knowledge graph)
    nexus graph [id] [depth]       View graph stats or traverse from a node
    nexus search "query"           Smart search (keyword + semantic)
    nexus seek "query"             Semantic-only search
    nexus find "query"             Keyword-only search
    nexus digest [24h|7d|30d]      Activity digest / summary
    nexus fuel                     Smart fuel estimate + runway prediction
    nexus workload                 Task capacity planner
    nexus usage                    Show current Claude usage
    nexus usage 75 40              Log session% and weekly% remaining
    nexus overseer                 AI strategic analysis of all projects
    nexus overseer risks           Quick risk scan (no AI needed)
    nexus overseer "question"      Ask the Overseer anything
    nexus focus [project]          Deep view of a single project
    nexus budget                   Budget-aware task suggestions
    nexus repos                    Git fleet overview (all repos)
    nexus ai status                Check local AI (LM Studio/Ollama)
    nexus ai summarize             AI-generated activity summary
    nexus ai "prompt"              Ask local AI anything
    nexus notify "message"         Send Windows toast notification
    nexus note "text"              Append to Captain's Log
    nexus activity                 Show recent activity

  ${amber('Environment:')}
    NEXUS_URL   API base (default: http://localhost:3001)

  ${amber('Integration:')}
    Add to any project's package.json scripts:
      "nexus:log": "nexus log",
      "nexus:task": "nexus task"

    Or use in git hooks:
      .git/hooks/post-commit:
        nexus log "Committed: $(git log -1 --format='%s')"
`);
  },
};

// ── Main ───────────────────────────────────────────────
const [cmd, ...args] = process.argv.slice(2);

if (!cmd || cmd === 'help' || cmd === '--help' || cmd === '-h') {
  commands.help();
} else if (commands[cmd]) {
  commands[cmd](args).catch(err => {
    console.error(`  ${red('◈')} Error: ${err.message}`);
    process.exit(1);
  });
} else {
  console.error(`  Unknown command: ${cmd}. Run 'nexus help' for usage.`);
  process.exit(1);
}
