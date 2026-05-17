#!/usr/bin/env node
/**
 * Smoke test for the *bundled* Nexus MCP server (mcpb/server/index.js).
 * Spawns it as a plain `node` subprocess (no tsx, no node_modules) to
 * mimic exactly how Claude Desktop will invoke it after install.
 *
 *   node mcpb/smoke-test-bundle.mjs
 */
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SERVER = join(__dirname, 'server', 'index.js');

const child = spawn('node', [SERVER], {
  stdio: ['pipe', 'pipe', 'inherit'],
  // Force standalone mode to match manifest.json env. Without this the smoke test would
  // hit the user's dev server (stale code) and mask bundle regressions.
  env: { ...process.env, NEXUS_STANDALONE: '1', NEXUS_BASE_URL: 'http://localhost:3001' },
});

let buffer = '';
let nextId = 1;
const pending = new Map();

child.stdout.on('data', (chunk) => {
  buffer += chunk.toString();
  let nl;
  while ((nl = buffer.indexOf('\n')) >= 0) {
    const line = buffer.slice(0, nl);
    buffer = buffer.slice(nl + 1);
    if (!line.trim()) continue;
    try {
      const msg = JSON.parse(line);
      if (msg.id != null && pending.has(msg.id)) {
        const { resolve } = pending.get(msg.id);
        pending.delete(msg.id);
        resolve(msg);
      }
    } catch {}
  }
});

function send(method, params = {}) {
  const id = nextId++;
  const req = { jsonrpc: '2.0', id, method, params };
  child.stdin.write(JSON.stringify(req) + '\n');
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    setTimeout(() => {
      if (pending.has(id)) {
        pending.delete(id);
        reject(new Error(`timeout: ${method}`));
      }
    }, 10000);
  });
}

async function main() {
  await send('initialize', {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'bundle-smoke-test', version: '0.0.1' },
  });
  child.stdin.write(
    JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n'
  );

  const list = await send('tools/list');
  console.log(`✓ tools/list returned ${list.result.tools.length} tools`);
  for (const t of list.result.tools) {
    console.log(`  - ${t.name}`);
  }

  const brief = await send('tools/call', {
    name: 'nexus_brief',
    arguments: { project: 'Nexus' },
  });
  if (brief.result.isError) {
    console.error('✗ nexus_brief returned error:', brief.result.content[0].text);
    process.exit(1);
  }
  console.log(`\n✓ nexus_brief works (${brief.result.content[0].text.length} chars returned)`);

  const guard = await send('tools/call', {
    name: 'nexus_check_guard',
    arguments: { title: 'Build MCPB extension' },
  });
  console.log(`✓ nexus_check_guard works`);
  console.log(guard.result.content[0].text.split('\n').slice(0, 6).join('\n'));

  // v3.1.1: log_usage round-trip
  const logUsage = await send('tools/call', {
    name: 'nexus_log_usage',
    arguments: { session_percent: 74, weekly_percent: 6, note: 'smoke test' },
  });
  if (logUsage.result.isError) {
    console.error('✗ nexus_log_usage returned error:', logUsage.result.content[0].text);
    process.exit(1);
  }
  console.log(`\n✓ nexus_log_usage works`);

  // v3.2 write tools — create, activity, search, critique, predict, bridge
  const createTask = await send('tools/call', {
    name: 'nexus_create_task',
    arguments: {
      title: 'SMOKE TEST TASK — safe to delete',
      description: 'Created by mcpb/smoke-test-bundle.mjs',
      status: 'backlog',
    },
  });
  if (createTask.result.isError) {
    console.error('✗ nexus_create_task error:', createTask.result.content[0].text);
    process.exit(1);
  }
  console.log(`✓ nexus_create_task works`);
  const createdText = createTask.result.content[0].text;
  console.log('  ', createdText.split('\n')[0]);

  // Extract id from "◈ Task #123 plotted..." for cleanup
  const idMatch = createdText.match(/#(\d+)/);
  const createdId = idMatch ? parseInt(idMatch[1]) : null;

  // Clean up: mark the smoke-test task done first (exercises nexus_complete_task),
  // then delete it so it doesn't linger in the user's ledger + activity stream.
  // Previously only completed it — users saw "SMOKE TEST TASK" pile up in the
  // Command Done column and the Log activity timeline on every release.
  if (createdId) {
    const complete = await send('tools/call', {
      name: 'nexus_complete_task',
      arguments: { id: createdId },
    });
    if (!complete.result.isError) {
      console.log(`✓ nexus_complete_task works (closed smoke-test #${createdId})`);
    }
    const del = await send('tools/call', {
      name: 'nexus_delete_task',
      arguments: { id: createdId },
    });
    if (!del.result.isError) {
      console.log(`✓ nexus_delete_task works (purged smoke-test #${createdId})`);
    }
  }

  const logAct = await send('tools/call', {
    name: 'nexus_log_activity',
    arguments: { message: 'smoke test activity', type: 'system' },
  });
  console.log(`✓ nexus_log_activity works`);

  const search = await send('tools/call', {
    name: 'nexus_search',
    arguments: { query: 'mcp server' },
  });
  if (search.result.isError) {
    console.error('✗ nexus_search error:', search.result.content[0].text);
    process.exit(1);
  }
  console.log(`✓ nexus_search works`);

  const critique = await send('tools/call', {
    name: 'nexus_get_critique',
    arguments: {},
  });
  if (critique.result.isError) {
    console.error('✗ nexus_get_critique error:', critique.result.content[0].text);
    process.exit(1);
  }
  console.log(`✓ nexus_get_critique works`);

  const predict = await send('tools/call', {
    name: 'nexus_predict_gaps',
    arguments: {},
  });
  if (predict.result.isError) {
    console.error('✗ nexus_predict_gaps error:', predict.result.content[0].text);
    process.exit(1);
  }
  console.log(`✓ nexus_predict_gaps works`);

  // v4.3.5 I3 — calendar runway with empty events expects "Runway clear" response.
  // Pure-logic tool that uses /api/estimator state, works in standalone.
  const runway = await send('tools/call', {
    name: 'nexus_calendar_runway',
    arguments: { events: [] },
  });
  if (runway.result.isError) {
    console.error('✗ nexus_calendar_runway error:', runway.result.content[0].text);
    process.exit(1);
  }
  const runwayText = runway.result.content[0].text;
  if (!/Runway clear|Session fuel|No fuel data/.test(runwayText)) {
    console.error('✗ nexus_calendar_runway unexpected response:', runwayText.slice(0, 200));
    process.exit(1);
  }
  console.log(`✓ nexus_calendar_runway works (empty-events → ${runwayText.split('\n')[0]})`);

  // v4.3.5 I3 — propose_edges requires async task infrastructure only present in the
  // full server. Standalone MCPB should degrade gracefully with an advisory error.
  // Smoke test: use a fake decision_id, expect either "Edge proposal unavailable" or 404.
  const propose = await send('tools/call', {
    name: 'nexus_propose_edges',
    arguments: { decision_id: 999999 },
  });
  const proposeText = propose.result.content[0].text;
  if (!/Edge proposal unavailable|requires the full Nexus server|not found|No local AI/.test(proposeText)) {
    console.error('✗ nexus_propose_edges unexpected standalone response:', proposeText.slice(0, 200));
    process.exit(1);
  }
  console.log(`✓ nexus_propose_edges standalone-error path works (${proposeText.split('\n')[0].slice(0, 80)})`);

  // v4.3.7 F1a — nexus_version must report the package-declared version and list applied migrations.
  // Standalone bundle should never say "unknown" because the version is inlined by esbuild.
  const ver = await send('tools/call', { name: 'nexus_version', arguments: {} });
  const verText = ver.result.content[0].text;
  const pkgVersion = JSON.parse((await import('fs')).readFileSync(join(__dirname, '..', 'package.json'), 'utf-8')).version;
  if (!verText.includes(`version:            ${pkgVersion}`)) {
    console.error(`✗ nexus_version did not report v${pkgVersion} — output was:\n${verText}`);
    process.exit(1);
  }
  if (!verText.includes('tool_count:') || !verText.includes('mode:')) {
    console.error('✗ nexus_version missing expected fields (tool_count / mode). Output:\n', verText);
    process.exit(1);
  }
  console.log(`✓ nexus_version works (reports v${pkgVersion})`);

  // ─────────────────────────────────────────────────────────────────────
  // v4.9.1 #743 — extended coverage. Pre-fix 13/34 tools were exercised
  // before shipping the bundle. A regression that dropped one of the v4.6
  // handover tools or v4.8.2 list_* tools would have shipped silently.
  // Now: all 8 read-only tools, both stateful thought ops (push/pop self-cleans),
  // update_task (round-trip via the existing smoke task), record + update +
  // link decision pair (cleaned up by cleanupSmokeTraces), log_session +
  // update_handover (also cleaned up), and import_cc_memories in dry-run mode.
  // ─────────────────────────────────────────────────────────────────────

  // Pure read-only tools — zero residue.
  for (const name of ['nexus_get_plan', 'nexus_read_handover', 'nexus_list_tasks', 'nexus_list_decisions', 'nexus_list_thoughts', 'nexus_list_sessions', 'nexus_fleet_overview']) {
    const res = await send('tools/call', { name, arguments: name === 'nexus_read_handover' ? { project: 'Nexus' } : {} });
    if (res.result.isError) {
      console.error(`✗ ${name} error:`, res.result.content[0].text);
      process.exit(1);
    }
    console.log(`✓ ${name} works`);
  }

  // get_blast_radius — try the first decision in the ledger; if none, accept the friendly "not found".
  {
    const list = await send('tools/call', { name: 'nexus_list_decisions', arguments: { limit: 1 } });
    const idMatch = (list.result?.content?.[0]?.text || '').match(/#(\d+)/);
    const probeId = idMatch ? parseInt(idMatch[1]) : 999999;
    const blast = await send('tools/call', { name: 'nexus_get_blast_radius', arguments: { decision_id: probeId } });
    if (blast.result.isError) {
      console.error('✗ nexus_get_blast_radius error:', blast.result.content[0].text);
      process.exit(1);
    }
    console.log(`✓ nexus_get_blast_radius works (probed decision #${probeId})`);
  }

  // update_task — interleaved with the existing create→complete flow, but
  // because we already deleted the smoke task above, create a fresh one now,
  // run update on it, then complete + delete in the same way. We extend the
  // cleanup set with the new id.
  let updateTaskId = null;
  {
    const created = await send('tools/call', {
      name: 'nexus_create_task',
      arguments: { title: 'SMOKE UPDATE TASK — safe to delete', description: 'update_task probe', status: 'backlog' },
    });
    const idMatch2 = (created.result?.content?.[0]?.text || '').match(/#(\d+)/);
    updateTaskId = idMatch2 ? parseInt(idMatch2[1]) : null;
    if (updateTaskId) {
      const upd = await send('tools/call', {
        name: 'nexus_update_task',
        arguments: { id: updateTaskId, status: 'in_progress', priority: 1 },
      });
      if (upd.result.isError) {
        console.error('✗ nexus_update_task error:', upd.result.content[0].text);
        process.exit(1);
      }
      console.log(`✓ nexus_update_task works (#${updateTaskId} → in_progress)`);
      await send('tools/call', { name: 'nexus_complete_task', arguments: { id: updateTaskId } });
      await send('tools/call', { name: 'nexus_delete_task', arguments: { id: updateTaskId } });
    }
  }

  // push_thought + pop_thought — self-cleaning pair. push, immediately pop,
  // the thought ends up status='resolved' which cleanupSmokeTraces filters.
  {
    const push = await send('tools/call', {
      name: 'nexus_push_thought',
      arguments: { text: 'smoke test thought — safe to delete', context: 'smoke probe', project: 'smoke-test' },
    });
    if (push.result.isError) {
      console.error('✗ nexus_push_thought error:', push.result.content[0].text);
      process.exit(1);
    }
    console.log(`✓ nexus_push_thought works`);
    const pop = await send('tools/call', { name: 'nexus_pop_thought', arguments: {} });
    if (pop.result.isError) {
      console.error('✗ nexus_pop_thought error:', pop.result.content[0].text);
      process.exit(1);
    }
    console.log(`✓ nexus_pop_thought works`);
  }

  // record_decision + update_decision + link_decisions — three new tools in
  // one chain. Both decisions are tagged 'smoke-test' so cleanupSmokeTraces
  // can purge them and any edges between them.
  let decisionAId = null;
  let decisionBId = null;
  {
    const a = await send('tools/call', {
      name: 'nexus_record_decision',
      arguments: { decision: 'smoke test decision A — safe to delete', project: 'smoke-test', rationale: 'mcpb smoke probe' },
    });
    const idA = (a.result?.content?.[0]?.text || '').match(/#(\d+)/);
    decisionAId = idA ? parseInt(idA[1]) : null;
    if (a.result.isError || !decisionAId) {
      console.error('✗ nexus_record_decision error:', a.result.content[0].text);
      process.exit(1);
    }
    console.log(`✓ nexus_record_decision works (#${decisionAId})`);

    const upd = await send('tools/call', {
      name: 'nexus_update_decision',
      arguments: { id: decisionAId, lifecycle: 'validated' },
    });
    if (upd.result.isError) {
      console.error('✗ nexus_update_decision error:', upd.result.content[0].text);
      process.exit(1);
    }
    console.log(`✓ nexus_update_decision works (#${decisionAId} → validated)`);

    const b = await send('tools/call', {
      name: 'nexus_record_decision',
      arguments: { decision: 'smoke test decision B — safe to delete', project: 'smoke-test' },
    });
    const idB = (b.result?.content?.[0]?.text || '').match(/#(\d+)/);
    decisionBId = idB ? parseInt(idB[1]) : null;

    if (decisionBId) {
      const link = await send('tools/call', {
        name: 'nexus_link_decisions',
        arguments: { from: decisionAId, to: decisionBId, rel: 'related', note: 'smoke test edge' },
      });
      if (link.result.isError) {
        console.error('✗ nexus_link_decisions error:', link.result.content[0].text);
        process.exit(1);
      }
      console.log(`✓ nexus_link_decisions works (#${decisionAId} → #${decisionBId})`);
    }
  }

  // log_session — small session entry tagged 'smoke-test' so cleanup can scrub it.
  {
    const sess = await send('tools/call', {
      name: 'nexus_log_session',
      arguments: { project: 'smoke-test', summary: 'smoke test session — safe to delete', tags: ['smoke-test'] },
    });
    if (sess.result.isError) {
      console.error('✗ nexus_log_session error:', sess.result.content[0].text);
      process.exit(1);
    }
    console.log(`✓ nexus_log_session works`);
  }

  // update_handover — write a card under a test-only project, then cleanup wipes it.
  {
    const upd = await send('tools/call', {
      name: 'nexus_update_handover',
      arguments: { project: 'smoke-test-project', content: 'smoke test handover — safe to delete' },
    });
    if (upd.result.isError) {
      console.error('✗ nexus_update_handover error:', upd.result.content[0].text);
      process.exit(1);
    }
    console.log(`✓ nexus_update_handover works`);
  }

  // import_cc_memories — dry-run only so no decisions get imported.
  {
    const imp = await send('tools/call', { name: 'nexus_import_cc_memories', arguments: { dry_run: true } });
    if (imp.result.isError) {
      console.error('✗ nexus_import_cc_memories (dry-run) error:', imp.result.content[0].text);
      process.exit(1);
    }
    console.log(`✓ nexus_import_cc_memories works (dry-run)`);
  }

  // Skip nexus_ask_overseer (slow AI inference — needs LM Studio running),
  // nexus_ask_overseer_start / nexus_get_overseer_result (require dashboard
  // async-task infra), and nexus_bridge_session (commits a real session
  // entry that would be hard to scrub safely). All four verified by presence
  // in tools/list + manifest schema validation.
  console.log(`  (skipped: nexus_ask_overseer, nexus_ask_overseer_start, nexus_get_overseer_result, nexus_bridge_session — side-effects)`);

  console.log('\n=== BUNDLED SERVER WORKS AS STANDALONE NODE PROCESS ===');
  console.log(`  ${list.result.tools.length} tools total`);
  // Pass the new ids into the cleanup so it can purge them.
  globalThis.__smokeIds = { taskUpdate: updateTaskId, decisionA: decisionAId, decisionB: decisionBId };
  child.kill();

  // v4.5.2 — post-run cleanup. The smoke test fires several write-tool calls
  // (log_usage, create_task, complete_task, delete_task, log_activity) that
  // leave traces in the user's store. Users were reporting the smoke-test
  // task and its activity entries "reappearing" in Command and Log. The
  // delete_task call (just above) purges the task itself; this block scrubs
  // the remaining activity + usage noise. Runs after child.kill() so there's
  // no contention on the JSON file.
  await cleanupSmokeTraces(createdId).catch(err => {
    console.warn('  (cleanup skipped:', err.message + ')');
  });

  process.exit(0);
}

async function cleanupSmokeTraces(createdId) {
  const fs = await import('fs');
  const { readFileSync, writeFileSync, existsSync } = fs;
  const os = await import('os');
  const storePath = process.env.NEXUS_STORE_PATH || join(os.homedir(), '.nexus', 'nexus.json');
  if (!existsSync(storePath)) return;
  const raw = readFileSync(storePath, 'utf-8');
  const data = JSON.parse(raw);
  // v4.9.1 #743 — extended cleanup. Pre-fix scrubbed only activity + usage;
  // the expanded smoke-test now also touches ledger, graph_edges, sessions,
  // thoughts, and _handovers under deterministic markers (project name +
  // "safe to delete" suffix), so we scrub those too.
  const before = {
    activity: (data.activity || []).length,
    usage: (data.usage || []).length,
    ledger: (data.ledger || []).length,
    graph_edges: (data.graph_edges || []).length,
    sessions: (data.sessions || []).length,
    thoughts: (data.thoughts || []).length,
    handovers: Object.keys(data._handovers || {}).length,
  };
  const ids = globalThis.__smokeIds || {};
  const smokeIds = new Set([createdId, ids.taskUpdate, ids.decisionA, ids.decisionB].filter(Boolean));
  const smokeIdRe = smokeIds.size > 0 ? new RegExp(`"id":(${[...smokeIds].join('|')})\\b`) : null;
  const isSmokeDecision = (d) => smokeIds.has(d.id) || (d.project || '').toLowerCase() === 'smoke-test' || /safe to delete/i.test(d.decision || '');
  const purgedDecisionIds = new Set((data.ledger || []).filter(isSmokeDecision).map((d) => d.id));

  data.activity = (data.activity || []).filter((a) => {
    const msg = (a.message || '').toLowerCase();
    if (msg === 'smoke test activity') return false;
    if (/safe to delete/i.test(a.message || '')) return false;
    if (smokeIdRe && smokeIdRe.test(a.meta || '')) return false;
    // v4.9.1 #743 — match the "smoke test" prefix used by the new probes (e.g.
    // "smoke test session — safe to delete"). Narrow enough not to touch
    // unrelated user activity that merely mentions "smoke test" mid-sentence.
    if (/^smoke test\b/i.test(a.message || '')) return false;
    return true;
  });
  data.usage = (data.usage || []).filter((u) => (u.note || '').toLowerCase() !== 'smoke test');
  data.ledger = (data.ledger || []).filter((d) => !isSmokeDecision(d));
  data.graph_edges = (data.graph_edges || []).filter((e) => !purgedDecisionIds.has(e.from) && !purgedDecisionIds.has(e.to));
  data.sessions = (data.sessions || []).filter((s) => {
    if ((s.project || '').toLowerCase() === 'smoke-test') return false;
    if (/safe to delete/i.test(s.summary || '')) return false;
    if ((s.tags || []).includes('smoke-test')) return false;
    return true;
  });
  data.thoughts = (data.thoughts || []).filter((t) => {
    if ((t.project || '').toLowerCase() === 'smoke-test') return false;
    // v4.9.1 #743 — narrower marker: match only the explicit smoke-test
    // prefix, not any mention of the words.
    if (/^smoke test\b/i.test(t.text || '')) return false;
    return true;
  });
  if (data._handovers && data._handovers['smoke-test-project']) {
    delete data._handovers['smoke-test-project'];
  }
  const after = {
    activity: data.activity.length,
    usage: data.usage.length,
    ledger: data.ledger.length,
    graph_edges: data.graph_edges.length,
    sessions: data.sessions.length,
    thoughts: data.thoughts.length,
    handovers: Object.keys(data._handovers || {}).length,
  };
  const dirty = Object.keys(before).some((k) => before[k] !== after[k]);
  if (dirty) {
    writeFileSync(storePath, JSON.stringify(data, null, 2));
    const summary = Object.entries(before)
      .filter(([k]) => before[k] !== after[k])
      .map(([k]) => `${k} ${before[k]} → ${after[k]}`)
      .join(', ');
    console.log(`  ◈ Cleaned smoke traces: ${summary}`);
  }
}

main().catch((err) => {
  console.error('SMOKE TEST FAILED:', err);
  child.kill();
  process.exit(1);
});
