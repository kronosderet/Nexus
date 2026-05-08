/**
 * Git fleet commands: sync / commit-all / repos.
 *
 * Extracted from cli/nexus.js in v4.7.5 (#217 part 3). All three operate on
 * the cross-project git fleet via /api/git/*. `commit-all` is the most
 * high-impact (writes commits across every dirty repo), so its output is
 * deliberately verbose with per-repo success/error lines.
 */

import { api } from '../lib/api.js';
import { dim, amber, green, red, timeSince } from '../lib/format.js';

export const gitCommands = {
  async sync() {
    console.log(`\n  ${amber('◈')} ${amber('Fleet Sync')}\n`);
    const repos = await api('/git/repos');
    for (const r of repos) {
      const dirty = r.uncommitted > 0 ? amber(` +${r.uncommitted}`) : '';
      const ahead = r.ahead > 0 ? green(` ↑${r.ahead}`) : '';
      const behind = r.behind > 0 ? red(` ↓${r.behind}`) : '';
      console.log(`  ${r.name.padEnd(22)} ${dim(r.branch.padEnd(10))}${dirty}${ahead}${behind}`);
    }
    // Trigger fetch
    console.log(`\n  ${dim('Fetching remotes...')}`);
    const results = await api('/git/sync', { method: 'POST' });
    for (const r of results) {
      if (r.newCommits > 0) console.log(`  ${green('↓')} ${r.project}: ${r.newCommits} new commits on remote`);
    }
    console.log(`  ${green('◈')} Fleet synced.\n`);
  },

  async ['commit-all'](args) {
    const message = args.join(' ') || 'Nexus auto-commit: save all pending work';
    console.log(`\n  ${amber('◈')} ${amber('Fleet Commit')}: "${message}"\n`);
    const repos = await api('/git/repos');
    let committed = 0;
    for (const r of repos) {
      if (r.uncommitted === 0) {
        console.log(`  ${dim(r.name.padEnd(22))} clean`);
        continue;
      }
      try {
        await api('/remediate/execute', {
          method: 'POST',
          body: { action: 'git-status', project: r.name },
        });
        // Actually commit via a dedicated endpoint
        const commitResult = await api('/git/commit', {
          method: 'POST',
          body: { project: r.name, message },
        });
        if (commitResult.success) {
          console.log(`  ${green('✓')} ${r.name.padEnd(22)} ${commitResult.files} files committed`);
          committed++;
        } else {
          console.log(`  ${red('!')} ${r.name.padEnd(22)} ${commitResult.error || 'failed'}`);
        }
      } catch (err) {
        console.log(`  ${red('!')} ${r.name.padEnd(22)} ${err.message}`);
      }
    }
    console.log(`\n  ${green('◈')} ${committed} repo${committed !== 1 ? 's' : ''} committed.\n`);
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
};
