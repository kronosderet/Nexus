import express from 'express';
import cors from 'cors';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

import { NexusStore } from './db/store.ts';
import { createTaskRoutes } from './routes/tasks.ts';
import { createActivityRoutes } from './routes/activity.ts';
import { createPulseRoutes } from './routes/pulse.js';
import { createScratchpadRoutes } from './routes/scratchpad.ts';
import { createSessionRoutes } from './routes/sessions.ts';
import { createSearchRoutes } from './routes/search.ts';
import { createDigestRoutes } from './routes/digest.ts';
import { createNotifyRoutes } from './routes/notify.ts';
import { createActionRoutes } from './routes/actions.js';
import { createUsageRoutes, buildTimingInfo } from './routes/usage.js';
import { createHeatmapRoutes } from './routes/heatmap.ts';
import { createGitHubRoutes } from './routes/github.js';
import { createWebhookRoutes } from './routes/webhooks.js';
import { createAIRoutes } from './routes/ai.js';
import { createOverseerRoutes } from './routes/overseer.js';
import { createFocusRoutes } from './routes/focus.ts';
import { createBudgetRoutes } from './routes/budget.ts';
import { createInitRoutes } from './routes/init.ts';
import { createClockRoutes } from './routes/clock.ts';
import { createRemediateRoutes } from './routes/remediate.ts';
import { createEmbeddingRoutes } from './routes/embeddings.js';
import { createSmartSearchRoutes } from './routes/smartSearch.js';
import { readFileSync, existsSync } from 'fs';
import { createEstimatorRoutes } from './routes/estimator.js';
import { createLedgerRoutes } from './routes/ledger.js';
import { createImpactRoutes } from './routes/impact.js';
import { startFileWatcher } from './watchers/fileWatcher.js';
import { startGpuPoller } from './watchers/gpuPoller.js';
import { startOverseerPoller } from './watchers/overseerPoller.js';
import { attachTerminal } from './routes/terminal.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3001;

// ── Database ──────────────────────────────────────────────
const store = new NexusStore();

// ── Express ───────────────────────────────────────────────
const app = express();
app.use(cors());
app.use(express.json());

// Serve built client in production
app.use(express.static(join(__dirname, '..', 'client', 'dist')));

// ── WebSocket ─────────────────────────────────────────────
const server = createServer(app);
const wss = new WebSocketServer({ noServer: true });
const termWss = new WebSocketServer({ noServer: true });
attachTerminal(termWss);

// Route WebSocket upgrades by path
server.on('upgrade', (req, socket, head) => {
  if (req.url === '/ws/terminal') {
    termWss.handleUpgrade(req, socket, head, (ws) => termWss.emit('connection', ws, req));
  } else if (req.url === '/ws') {
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
  } else {
    socket.destroy();
  }
});

const clients = new Set();
wss.on('connection', (ws) => {
  clients.add(ws);
  ws.send(JSON.stringify({
    type: 'nexus_hello',
    payload: { message: 'Bearings restored. All instruments nominal.', timestamp: new Date().toISOString() }
  }));
  ws.on('close', () => clients.delete(ws));
});

function broadcast(data) {
  const msg = JSON.stringify(data);
  for (const ws of clients) {
    if (ws.readyState === 1) ws.send(msg);
  }
}

// ── Routes ────────────────────────────────────────────────
app.get('/api/status', (req, res) => {
  res.json({
    status: 'online',
    message: 'All instruments nominal.',
    version: '1.0.0',
    uptime: process.uptime(),
  });
});

app.use('/api/tasks', createTaskRoutes(store, broadcast));
app.use('/api/activity', createActivityRoutes(store));
app.use('/api/pulse', createPulseRoutes(store));
app.use('/api/scratchpads', createScratchpadRoutes(store));
app.use('/api/sessions', createSessionRoutes(store, broadcast));
app.use('/api/search', createSearchRoutes(store));
app.use('/api/digest', createDigestRoutes(store));
app.use('/api/notify', createNotifyRoutes(store, broadcast));
app.use('/api/actions', createActionRoutes(store, broadcast));
app.use('/api/usage', createUsageRoutes(store, broadcast));
app.use('/api/heatmap', createHeatmapRoutes(store));
app.use('/api/git', createGitHubRoutes(store, broadcast));
app.use('/api/webhooks', createWebhookRoutes(store, broadcast));
app.use('/api/ai', createAIRoutes(store));
app.use('/api/overseer', createOverseerRoutes(store, broadcast));
app.use('/api/focus', createFocusRoutes(store));
app.use('/api/budget', createBudgetRoutes(store));
app.use('/api/init', createInitRoutes(store));
app.use('/api/clock', createClockRoutes(store, buildTimingInfo));
app.use('/api/remediate', createRemediateRoutes(store, broadcast));
app.use('/api/embed', createEmbeddingRoutes(store));

// Shared embedding cache for smart search
const embedCachePath = join(__dirname, '..', 'nexus-embeddings.json');
let embedCache = {};
try { if (existsSync(embedCachePath)) embedCache = JSON.parse(readFileSync(embedCachePath, 'utf-8')); } catch {}
app.use('/api/smart-search', createSmartSearchRoutes(store, embedCache));
app.use('/api/estimator', createEstimatorRoutes(store));
app.use('/api/ledger', createLedgerRoutes(store, broadcast));
app.use('/api/impact', createImpactRoutes(store));

// SPA fallback (Express 5 requires named wildcard)
app.get('/{*splat}', (req, res) => {
  res.sendFile(join(__dirname, '..', 'client', 'dist', 'index.html'));
});

// ── Launch ────────────────────────────────────────────────
server.listen(PORT, () => {
  console.log('');
  console.log('  ┌──────────────────────────────────────────┐');
  console.log('  │                                          │');
  console.log('  │   ◈  N E X U S  v1.0                     │');
  console.log('  │   The Cartographer — The Sentinel         │');
  console.log('  │                                          │');
  console.log('  │   Setting course.                        │');
  console.log('  │   All instruments nominal.                │');
  console.log('  │                                          │');
  console.log(`  │   http://localhost:${PORT}                   │`);
  console.log('  │                                          │');
  console.log('  └──────────────────────────────────────────┘');
  console.log('');

  store.addActivity('system', 'Nexus is online. Setting course.');
  startFileWatcher(store, broadcast);
  startGpuPoller(store);
  startOverseerPoller(store, broadcast);
});

process.on('SIGINT', () => {
  console.log('\n  Instruments powered down. Safe harbors, Captain.\n');
  process.exit(0);
});
