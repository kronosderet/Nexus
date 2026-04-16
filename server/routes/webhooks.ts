import { Router, type Request, type Response } from 'express';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import type { NexusStore } from '../db/store.ts';

type BroadcastFn = (data: unknown) => void;

const __dirname = dirname(fileURLToPath(import.meta.url));
const HOOKS_PATH = join(__dirname, '..', '..', 'nexus-webhooks.json');

// v4.3.5 P1 — typed webhook config.
interface WebhookEntry {
  id: string;
  name: string;
  url: string;
  events: string[];
  format?: 'discord' | 'slack' | 'teams' | 'json';
}
interface WebhookConfig {
  outbound: WebhookEntry[];
}

const DEFAULT_CONFIG: WebhookConfig = {
  outbound: [],
  // Example:
  // { id: 'discord-nexus', url: 'https://discord.com/api/webhooks/...', events: ['task_done', 'session'], format: 'discord' }
};

function loadConfig(): WebhookConfig {
  if (existsSync(HOOKS_PATH)) return JSON.parse(readFileSync(HOOKS_PATH, 'utf-8'));
  writeFileSync(HOOKS_PATH, JSON.stringify(DEFAULT_CONFIG, null, 2));
  return DEFAULT_CONFIG;
}

function saveConfig(config: WebhookConfig) {
  writeFileSync(HOOKS_PATH, JSON.stringify(config, null, 2));
}

// Format payload for different targets. `data` is opaque at this boundary (could be a string,
// an Activity row, a Task, etc.) — the formatters defensively probe common fields.
function formatPayload(event: string, data: unknown, format: string) {
  const fallback = (d: unknown): string => {
    if (typeof d === 'string') return d;
    if (d && typeof d === 'object') {
      const obj = d as Record<string, unknown>;
      return (obj.message as string) || (obj.title as string) || JSON.stringify(d).slice(0, 200);
    }
    return String(d);
  };
  const message = `[Nexus] ${event}: ${fallback(data)}`;

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
export async function fireWebhooks(event: string, data: unknown) {
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

export function createWebhookRoutes(store: NexusStore, broadcast: BroadcastFn) {
  const router = Router();

  // List outbound webhooks
  router.get('/', (req: Request, res: Response) => {
    res.json(loadConfig());
  });

  // Add outbound webhook
  router.post('/', (req: Request, res: Response) => {
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
  router.delete('/:id', (req: Request, res: Response) => {
    const config = loadConfig();
    config.outbound = config.outbound.filter((h: WebhookEntry) => h.id !== String(req.params.id));
    saveConfig(config);
    res.json({ success: true });
  });

  // Test a webhook
  router.post('/:id/test', async (req: Request, res: Response) => {
    const config = loadConfig();
    const hook = config.outbound.find((h: WebhookEntry) => h.id === String(req.params.id));
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
      res.json({ success: false, error: (err as Error).message });
    }
  });

  // Inbound webhook receiver (for GitHub, CI/CD, etc.)
  router.post('/inbound', (req: Request, res: Response) => {
    const { event, message, project, meta } = req.body;
    const githubEvent = req.headers['x-github-event'] as string | undefined;

    let activityMessage: string | undefined;
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

interface GitHubPayload {
  repository?: { name?: string };
  commits?: Array<unknown>;
  ref?: string;
  pull_request?: { title?: string; number?: number; merged?: boolean };
  issue?: { title?: string; number?: number };
  release?: { tag_name?: string; name?: string };
  sender?: { login?: string };
  action?: string;
  [key: string]: unknown;
}

function parseGitHubEvent(event: string, payload: GitHubPayload): string {
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
