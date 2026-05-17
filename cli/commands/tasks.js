/**
 * Task commands: task / tasks / done / quick.
 *
 * Extracted from cli/nexus.js in v4.7.5 (#217 part 3).
 *
 * `quick` is the lightweight one-glance status command — fuel + risk count
 * + top task. Lives here because the "top task" branch is the user-facing
 * concept; in practice the function reads three different API endpoints.
 */

import { api } from '../lib/api.js';
import { dim, amber, green, red, formatTask } from '../lib/format.js';

export const taskCommands = {
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

  // v4.9.1 #740 — CLI mirror of nexus_update_task. Moves a task through the
  // backlog → in_progress → review → done state machine without going through
  // the dashboard. Also takes --priority and --title for inline edits.
  async ['update-task'](args) {
    const id = parseInt(args[0]);
    if (!id || isNaN(id)) { console.error('  Usage: nexus update-task <id> [-s status] [-p priority] [-t title] [-d description]'); return; }
    const body = {};
    for (let i = 1; i < args.length; i++) {
      const k = args[i];
      const v = args[i + 1];
      if ((k === '-s' || k === '--status') && v) { body.status = v; i++; }
      else if ((k === '-p' || k === '--priority') && v) { body.priority = parseInt(v); i++; }
      else if ((k === '-t' || k === '--title') && v) { body.title = v; i++; }
      else if ((k === '-d' || k === '--description') && v) { body.description = v; i++; }
    }
    if (Object.keys(body).length === 0) {
      console.error('  Provide at least one field: -s/-p/-t/-d');
      return;
    }
    const task = await api(`/tasks/${id}`, { method: 'PATCH', body });
    console.log(`  ◈ Course adjusted: ${formatTask(task)}`);
  },

  // v4.9.1 #740 — CLI mirror of nexus_delete_task. Purges a task from the
  // ledger (not just status=done). Use sparingly — for smoke-test / duplicate
  // cleanup, not real work (nexus done is the canonical "completed" path).
  async ['delete-task'](args) {
    const id = parseInt(args[0]);
    if (!id || isNaN(id)) { console.error('  Usage: nexus delete-task <id>'); return; }
    await api(`/tasks/${id}`, { method: 'DELETE' });
    console.log(`  ◈ Task #${id} purged.`);
  },

  async quick() {
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
};
