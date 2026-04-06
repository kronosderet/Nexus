import express from 'express';
import cors from 'cors';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

import { NexusStore } from './db/store.js';
import { createTaskRoutes } from './routes/tasks.js';
import { createActivityRoutes } from './routes/activity.js';
import { createPulseRoutes } from './routes/pulse.js';
import { createScratchpadRoutes } from './routes/scratchpad.js';
import { createSessionRoutes } from './routes/sessions.js';
import { createSearchRoutes } from './routes/search.js';
import { createDigestRoutes } from './routes/digest.js';
import { createNotifyRoutes } from './routes/notify.js';
import { createActionRoutes } from './routes/actions.js';
import { createUsageRoutes } from './routes/usage.js';
import { createHeatmapRoutes } from './routes/heatmap.js';
import { createGitHubRoutes } from './routes/github.js';
import { createWebhookRoutes } from './routes/webhooks.js';
import { createAIRoutes } from './routes/ai.js';
import { createOverseerRoutes } from './routes/overseer.js';
import { createFocusRoutes } from './routes/focus.js';
import { createBudgetRoutes } from './routes/budget.js';
import { createInitRoutes } from './routes/init.js';
import { createClockRoutes } from './routes/clock.js';
import { createRemediateRoutes } from './routes/remediate.js';
import { startFileWatcher } from './watchers/fileWatcher.js';
import { startGpuPoller } from './watchers/gpuPoller.js';
import { startOverseerPoller } from './watchers/overseerPoller.js';
import { attachTerminal } from './routes/terminal.js';

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
app.use('/api/clock', createClockRoutes(store));
app.use('/api/remediate', createRemediateRoutes(store, broadcast));

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
