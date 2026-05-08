/**
 * Ledger / Knowledge Graph commands: record / decisions / search / impact /
 * link / graph / seek / find.
 *
 * Extracted from cli/nexus.js in v4.7.5 (#217 part 3). All commands here
 * touch The Ledger (decisions + edges + search) — the read/write surface
 * of the knowledge graph.
 *
 * - `record`: append a decision
 * - `decisions`: list recent decisions, optional project filter
 * - `link`: connect two decisions with a typed edge (led_to / replaced /
 *   depends_on / contradicts / related / informs / experimental)
 * - `graph`: full-graph stats OR traverse from one decision
 * - `impact`: multi-mode analysis (blast | contradictions | centrality |
 *   holes | forecast)
 * - `search`: hybrid keyword + semantic via /smart-search
 * - `seek`: semantic-only via /embed/search
 * - `find`: keyword-only via /search
 */

import { api } from '../lib/api.js';
import { dim, amber, green, blue, red, progressBar } from '../lib/format.js';

export const ledgerCommands = {
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

    if (args[0] === 'forecast' && args[1]) {
      const id = parseInt(args[1]);
      console.log(`\n  ${amber('◈')} ${amber('Forecasting impact')} for #${id}...\n`);
      const data = await api(`/impact/forecast/${id}`);
      console.log(`  ${dim('Decision:')} ${data.decision?.decision}`);
      console.log(`  ${dim('Project:')}  ${data.decision?.project}`);
      console.log(`  ${dim('Affected:')} ${data.affectedCount} downstream decision${data.affectedCount === 1 ? '' : 's'} (max depth ${data.depth})\n`);
      if (data.affected?.length > 0) {
        console.log(`  ${dim('Downstream:')}`);
        for (const a of data.affected.slice(0, 10)) {
          console.log(`    ${'  '.repeat(Math.max(0, a.depth - 1))}${dim('→')} ${green(`#${a.id}`)} ${a.decision} ${dim(`[${a.project}]`)}`);
        }
        if (data.affected.length > 10) console.log(`    ${dim(`... and ${data.affected.length - 10} more`)}`);
        console.log('');
      }
      if (data.forecast) {
        console.log(`  ${amber('Forecast (AI):')}`);
        const lines = String(data.forecast).split('\n');
        for (const line of lines) console.log(`    ${line}`);
        console.log('');
      } else {
        console.log(`  ${dim('AI forecast unavailable. Start LM Studio with google/gemma-4-26b-a4b loaded.')}\n`);
      }
      return;
    }

    console.log('  Usage: nexus impact blast <id> | contradictions | centrality | holes | forecast <id>');
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

    await api('/ledger/link', { method: 'POST', body: { from, to, rel, note } });
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
};
