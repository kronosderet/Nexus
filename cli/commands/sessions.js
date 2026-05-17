/**
 * Session + activity commands: log / note / session / context / summarize /
 * digest / activity / handoff.
 *
 * Extracted from cli/nexus.js in v4.7.5 (#217 part 3).
 *
 * `context` is here because the underlying endpoint is
 * /sessions/context/:project — it surfaces the same session history that
 * `nexus session` records. `handoff` and `summarize` are larger end-of-day
 * rituals that compose multiple endpoints into a single human-readable
 * report.
 */

import { api } from '../lib/api.js';
import { dim, amber, green, red, formatTask, progressBar } from '../lib/format.js';

export const sessionCommands = {
  // v4.9.1 #740 — CLI mirror of nexus_list_sessions. Pre-fix the closest verb
  // was `nexus context [project]` which hit a different endpoint and returned
  // a different shape (sessions + active tasks for ONE project). This one is
  // straight pagination over the global session log.
  async ['list-sessions'](args) {
    let project;
    let limit = 10;
    for (let i = 0; i < args.length; i++) {
      const k = args[i];
      const v = args[i + 1];
      if ((k === '-p' || k === '--project') && v) { project = v; i++; }
      else if ((k === '-n' || k === '--limit') && v) { limit = parseInt(v); i++; }
    }
    const qs = new URLSearchParams();
    if (project) qs.set('project', project);
    qs.set('limit', String(limit));
    const sessions = await api(`/sessions?${qs.toString()}`);
    if (!Array.isArray(sessions) || sessions.length === 0) {
      console.log('  ◈ No session entries yet.');
      return;
    }
    console.log(`  ${amber('◈ Sessions')} (${sessions.length}${project ? ` · ${project}` : ''}):\n`);
    for (const s of sessions) {
      const date = new Date(s.created_at).toLocaleDateString();
      const tags = (s.tags && s.tags.length) ? ` ${dim(`[${s.tags.join(', ')}]`)}` : '';
      console.log(`  ${dim(`#${s.id} ${date}`)} ${amber(`[${s.project}]`)} ${s.summary.slice(0, 100)}${tags}`);
    }
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
    await api('/sessions', {
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

  async summarize(args) {
    // Parse project and --commit flag
    const commit = args.includes('--commit') || args.includes('-c');
    const projectArg = args.find(a => !a.startsWith('-'));
    const project = projectArg || process.cwd().split(/[/\\]/).pop();

    console.log(`\n  ${amber('◈')} ${amber('Auto-Summarize')} — ${green(project)}\n`);
    console.log(`  ${dim('The Overseer is writing the session log...')}\n`);

    const url = `/auto-summary?project=${encodeURIComponent(project)}`;
    const data = await api(url);

    if (data.error) {
      console.log(`  ${red('◈')} ${data.error}`);
      return;
    }

    const ctx = data.context || {};
    console.log(`  ${dim('Context:')} ${ctx.completedTasks || 0} tasks done, ${ctx.decisions || 0} decisions, ${ctx.activityEvents || 0} events`);
    console.log('');

    if (data.parsed) {
      console.log(`  ${amber('SUMMARY')}`);
      console.log(`  ${data.parsed.summary}\n`);
      if (data.parsed.decisions?.length) {
        console.log(`  ${amber('DECISIONS')}`);
        for (const d of data.parsed.decisions) console.log(`    · ${d}`);
        console.log('');
      }
      if (data.parsed.blockers?.length) {
        console.log(`  ${amber('BLOCKERS')}`);
        for (const b of data.parsed.blockers) console.log(`    ${red('!')} ${b}`);
        console.log('');
      }
      if (data.parsed.tags?.length) {
        console.log(`  ${dim('Tags:')} ${data.parsed.tags.join(', ')}`);
        console.log('');
      }
    } else {
      console.log(`  ${dim('Raw (could not parse as JSON):')}`);
      console.log(data.raw?.split('\n').map(l => `  ${l}`).join('\n'));
      console.log('');
    }

    if (commit) {
      console.log(`  ${dim('Saving as session entry...')}`);
      const saved = await api('/auto-summary', { method: 'POST', body: { project } });
      if (saved.session) {
        console.log(`  ${green('◈')} Saved as session #${saved.session.id}`);
      } else {
        console.log(`  ${red('◈')} Save failed: ${saved.error || 'unknown'}`);
      }
    } else {
      console.log(`  ${dim('Preview only. To save:')} nexus summarize ${project} --commit`);
    }
    console.log('');
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
};
