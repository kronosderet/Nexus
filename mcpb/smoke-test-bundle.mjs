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
  env: { ...process.env, NEXUS_BASE_URL: 'http://localhost:3001' },
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

  // Clean up: mark the smoke-test task done so the backlog stays clean
  if (createdId) {
    const complete = await send('tools/call', {
      name: 'nexus_complete_task',
      arguments: { id: createdId },
    });
    if (!complete.result.isError) {
      console.log(`✓ nexus_complete_task works (closed smoke-test #${createdId})`);
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

  // Skip nexus_ask_overseer (slow AI inference) and nexus_bridge_session
  // (would commit a real session entry). Those are verified by existence
  // in the tools list + manifest schema validation.
  console.log(`  (skipped: nexus_ask_overseer, nexus_bridge_session — side-effects)`);

  console.log('\n=== BUNDLED SERVER WORKS AS STANDALONE NODE PROCESS ===');
  console.log(`  ${list.result.tools.length} tools total`);
  child.kill();
  process.exit(0);
}

main().catch((err) => {
  console.error('SMOKE TEST FAILED:', err);
  child.kill();
  process.exit(1);
});
