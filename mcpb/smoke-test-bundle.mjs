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

  // New in v3.1.1: log_usage round-trip
  const logUsage = await send('tools/call', {
    name: 'nexus_log_usage',
    arguments: {
      session_percent: 76,
      weekly_percent: 6,
      note: 'smoke test',
    },
  });
  if (logUsage.result.isError) {
    console.error('✗ nexus_log_usage returned error:', logUsage.result.content[0].text);
    process.exit(1);
  }
  console.log(`\n✓ nexus_log_usage works`);
  console.log(logUsage.result.content[0].text);

  console.log('\n=== BUNDLED SERVER WORKS AS STANDALONE NODE PROCESS ===');
  child.kill();
  process.exit(0);
}

main().catch((err) => {
  console.error('SMOKE TEST FAILED:', err);
  child.kill();
  process.exit(1);
});
