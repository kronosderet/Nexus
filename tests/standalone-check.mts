process.env.NEXUS_STANDALONE = '1';
process.env.NEXUS_DB_PATH = './tests/.standalone-test.json';

const { localApiFetch } = await import('../server/mcp/localApi.ts');

console.log('=== Standalone Local API Test ===\n');

// Status
const status = await localApiFetch('/api/status');
console.log('✓ Status:', status.status, status.mode);

// Create task
const task = await localApiFetch('/api/tasks', { method: 'POST', body: JSON.stringify({ title: 'Standalone test task' }) });
console.log('✓ Created task #' + task.id + ':', task.title);

// List tasks
const tasks = await localApiFetch('/api/tasks');
console.log('✓ Tasks count:', tasks.length);

// Record decision
const dec = await localApiFetch('/api/ledger', { method: 'POST', body: JSON.stringify({ decision: 'Test decision', project: 'test' }) });
console.log('✓ Decision #' + dec.id + ':', dec.decision);

// Push thought
const thought = await localApiFetch('/api/thoughts', { method: 'POST', body: JSON.stringify({ text: 'Test thought', project: 'test' }) });
console.log('✓ Thought #' + thought.id + ':', thought.text);

// Pop thought
const popped = await localApiFetch('/api/thoughts/pop', { method: 'POST', body: '{}' });
console.log('✓ Popped:', popped.text);

// Guard
const guard = await localApiFetch('/api/guard?title=Test+task');
console.log('✓ Guard:', guard.warning || 'no warning');

// Critique
const critique = await localApiFetch('/api/critique');
console.log('✓ Critique insights:', critique.insights?.length || 0);

// Log usage
const usage = await localApiFetch('/api/usage', { method: 'POST', body: JSON.stringify({ session_percent: 50, weekly_percent: 90 }) });
console.log('✓ Usage logged');

// Estimator
const est = await localApiFetch('/api/estimator');
console.log('✓ Estimator:', est.tracked ? `${est.estimated.session}%/${est.estimated.weekly}%` : 'not tracked');

// Delete test task
await localApiFetch('/api/tasks/' + task.id, { method: 'DELETE' });
console.log('✓ Cleaned up');

// Cleanup test file
import { unlinkSync } from 'fs';
try { unlinkSync('./tests/.standalone-test.json'); } catch {}
try { unlinkSync('./tests/.standalone-test.json.bak'); } catch {}
try { unlinkSync('./tests/.standalone-test.json.bak.2'); } catch {}
try { unlinkSync('./tests/.standalone-test.json.tmp'); } catch {}

console.log('\n=== ALL STANDALONE TESTS PASSED ===');
