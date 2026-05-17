/**
 * Handover commands: read-handover / update-handover.
 *
 * v4.9.1 #740 — CLI mirrors for the v4.6.0 Continuous Handover protocol
 * (nexus_read_handover + nexus_update_handover MCP tools). Pre-fix the
 * Continuous Handover was reachable only via the dashboard or the MCP tools;
 * shell users had to curl /api/handover/:project by hand.
 */

import { readFileSync } from 'node:fs';
import { api } from '../lib/api.js';
import { dim, amber, green } from '../lib/format.js';

export const handoverCommands = {
  async ['read-handover'](args) {
    const project = args[0];
    if (!project) {
      console.error('  Usage: nexus read-handover <project>');
      return;
    }
    try {
      const entry = await api(`/handover/${encodeURIComponent(project)}`);
      console.log(`  ${amber('◈ Handover · ' + project)} ${dim(`(updated ${entry.updated_at}${entry.updated_by ? ' by ' + entry.updated_by : ''})`)}\n`);
      console.log(entry.content);
    } catch (err) {
      console.error(`  ${err.message}`);
    }
  },

  // -f / --file reads content from a file path; otherwise the remaining args
  // are concatenated as the inline content. Empty content is rejected.
  async ['update-handover'](args) {
    if (args.length < 2) {
      console.error('  Usage: nexus update-handover <project> "content..."');
      console.error('     or: nexus update-handover <project> -f <path-to-md>');
      return;
    }
    const project = args[0];
    let content;
    let updatedBy = 'cli';
    const rest = args.slice(1);
    const fileIdx = rest.findIndex((a) => a === '-f' || a === '--file');
    if (fileIdx >= 0 && rest[fileIdx + 1]) {
      content = readFileSync(rest[fileIdx + 1], 'utf-8');
    } else {
      content = rest.join(' ');
    }
    const byIdx = rest.findIndex((a) => a === '--by');
    if (byIdx >= 0 && rest[byIdx + 1]) updatedBy = rest[byIdx + 1];
    if (!content || !content.trim()) {
      console.error('  Content is empty. Provide a string or use -f <path>.');
      return;
    }
    const entry = await api(`/handover/${encodeURIComponent(project)}`, {
      method: 'PUT',
      body: { content, updated_by: updatedBy },
    });
    console.log(`  ${green('◈ Handover saved')} · ${project} · ${entry.content.length} chars`);
  },

  // v4.9.1 #740 — list all handovers across projects. Equivalent to
  // hitting /api/handover (no project segment). Useful for cross-project
  // visibility when you're on the road and don't have the dashboard up.
  async ['list-handovers']() {
    const res = await api('/handover');
    const entries = Object.entries(res.handovers || {});
    if (entries.length === 0) {
      console.log('  ◈ No handovers yet.');
      return;
    }
    console.log(`  ${amber('◈ Handovers')} (${entries.length}):\n`);
    for (const [project, entry] of entries) {
      const chars = entry.content?.length ?? 0;
      console.log(`  ${amber(project)} ${dim(`· ${chars} chars · ${entry.updated_at}`)}`);
    }
  },
};
