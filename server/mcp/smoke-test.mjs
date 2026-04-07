#!/usr/bin/env node
/**
 * Smoke test for the Nexus MCP server.
 * Spawns it as a subprocess, sends MCP protocol requests over stdio,
 * and prints the responses. Run after any change to the adapter.
 *
 *   node server/mcp/smoke-test.mjs
 */
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SERVER = join(__dirname, 'index.ts');

const child = spawn('npx', ['tsx', SERVER], {
  stdio: ['pipe', 'pipe', 'inherit'],
  shell: process.platform === 'win32',
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
    } catch {
      console.error('non-json line:', line);
    }
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
  // Initialize handshake
  await send('initialize', {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'smoke-test', version: '0.0.1' },
  });
  // notifications/initialized has no id and expects no response
  child.stdin.write(
    JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n'
  );

  console.log('\n=== tools/list ===');
  const list = await send('tools/list');
  for (const t of list.result.tools) {
    console.log(`  ${t.name.padEnd(25)} ${t.description.slice(0, 70)}...`);
  }

  console.log('\n=== nexus_brief (project: Nexus) ===');
  const brief = await send('tools/call', {
    name: 'nexus_brief',
    arguments: { project: 'Nexus' },
  });
  console.log(brief.result.content[0].text);

  console.log('\n=== nexus_check_guard (title: Build MCP server) ===');
  const guard = await send('tools/call', {
    name: 'nexus_check_guard',
    arguments: { title: 'Build MCP server' },
  });
  console.log(guard.result.content[0].text);

  console.log('\n=== nexus_push_thought (round-trip test) ===');
  const push = await send('tools/call', {
    name: 'nexus_push_thought',
    arguments: {
      text: 'SMOKE TEST: this thought should be popped immediately',
      context: 'server/mcp/smoke-test.mjs',
      project: 'Nexus',
    },
  });
  console.log(push.result.content[0].text);

  console.log('\n=== nexus_pop_thought ===');
  const pop = await send('tools/call', {
    name: 'nexus_pop_thought',
    arguments: {},
  });
  console.log(pop.result.content[0].text);

  console.log('\n=== ALL CHECKS PASSED ===');
  child.kill();
  process.exit(0);
}

main().catch((err) => {
  console.error('SMOKE TEST FAILED:', err);
  child.kill();
  process.exit(1);
});
