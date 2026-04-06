import { Router } from 'express';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const HOOKS_PATH = join(__dirname, '..', '..', 'nexus-webhooks.json');

const DEFAULT_CONFIG = {
  outbound: [],
  // Example:
  // { id: 'discord-nexus', url: 'https://discord.com/api/webhooks/...', events: ['task_done', 'session'], format: 'discord' }
};

function loadConfig() {
  if (existsSync(HOOKS_PATH)) return JSON.parse(readFileSync(HOOKS_PATH, 'utf-8'));
  writeFileSync(HOOKS_PATH, JSON.stringify(DEFAULT_CONFIG, null, 2));
  return DEFAULT_CONFIG;
}

function saveConfig(config) {
  writeFileSync(HOOKS_PATH, JSON.stringify(config, null, 2));
}

// Format payload for different targets
function formatPayload(event, data, format) {
  const message = `[Nexus] ${event}: ${typeof data === 'string' ? data : data.message || data.title || JSON.stringify(data).slice(0, 200)}`;

  switch (format) {
    case 'discord':
      return { content: message };
    case 'slack':
      return { text: message };
    case 'teams':
      return { text: message };
    default: // raw json
      return { event, data, timestamp: new Date().toISOString(), source: 'nexus' };
  }
}

// Fire outbound webhooks for a given event
export async function fireWebhooks(event, data) {
  const config = loadConfig();
  for (const hook of config.outbound) {
    if (hook.events.includes(event) || hook.events.includes('*')) {
      const payload = formatPayload(event, data, hook.format || 'json');
      try {
        await fetch(hook.url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
      } catch {}
    }
  }
}

export function createWebhookRoutes(store, broadcast) {
  const router = Router();

  // List outbound webhooks
  router.get('/', (req, res) => {
    res.json(loadConfig());
  });

  // Add outbound webhook
  router.post('/', (req, res) => {
    const { url, events = ['*'], format = 'json', name = 'unnamed' } = req.body;
    if (!url) return res.status(400).json({ error: 'URL required.' });

    const config = loadConfig();
    const hook = { id: `hook-${Date.now()}`, name, url, events, format };
    config.outbound.push(hook);
    saveConfig(config);

    store.addActivity('webhook', `Outbound webhook added: ${name} -> ${events.join(', ')}`);
    res.status(201).json(hook);
  });

  // Delete outbound webhook
  router.delete('/:id', (req, res) => {
    const config = loadConfig();
    config.outbound = config.outbound.filter(h => h.id !== req.params.id);
    saveConfig(config);
    res.json({ success: true });
  });

  // Test a webhook
  router.post('/:id/test', async (req, res) => {
    const config = loadConfig();
    const hook = config.outbound.find(h => h.id === req.params.id);
    if (!hook) return res.status(404).json({ error: 'Nothing on the charts.' });

    const payload = formatPayload('test', 'Nexus webhook test -- all instruments nominal.', hook.format);
    try {
      await fetch(hook.url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      res.json({ success: true, payload });
    } catch (err) {
      res.json({ success: false, error: err.message });
    }
  });

  // Inbound webhook receiver (for GitHub, CI/CD, etc.)
  router.post('/inbound', (req, res) => {
    const { event, message, project, meta } = req.body;
    const githubEvent = req.headers['x-github-event'];

    let activityMessage;
    if (githubEvent) {
      // GitHub webhook
      activityMessage = parseGitHubEvent(githubEvent, req.body);
    } else {
      activityMessage = message || `Inbound signal: ${event || 'unknown'}`;
    }

    if (activityMessage) {
      const entry = store.addActivity('webhook_inbound', activityMessage);
      broadcast({ type: 'activity', payload: entry });
    }

    res.json({ received: true });
  });

  return router;
}

function parseGitHubEvent(event, payload) {
  switch (event) {
    case 'push': {
      const repo = payload.repository?.name || 'unknown';
      const count = payload.commits?.length || 0;
      const branch = (payload.ref || '').replace('refs/heads/', '');
      return `Signal from GitHub -- [${repo}/${branch}] ${count} commit${count !== 1 ? 's' : ''} pushed`;
    }
    case 'pull_request': {
      const repo = payload.repository?.name || 'unknown';
      const action = payload.action;
      const title = payload.pull_request?.title || '';
      return `Signal from GitHub -- [${repo}] PR ${action}: ${title}`;
    }
    case 'issues': {
      const repo = payload.repository?.name || 'unknown';
      const action = payload.action;
      const title = payload.issue?.title || '';
      return `Signal from GitHub -- [${repo}] Issue ${action}: ${title}`;
    }
    case 'release': {
      const repo = payload.repository?.name || 'unknown';
      const tag = payload.release?.tag_name || '';
      return `Signal from GitHub -- [${repo}] Release ${tag}`;
    }
    default:
      return `Signal from GitHub -- ${event}`;
  }
}
