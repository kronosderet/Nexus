import { Router, Request, Response } from 'express';
import { readdirSync, statSync } from 'fs';
import { join } from 'path';
import type { NexusStore } from '../db/store.ts';
import { PROJECTS_DIR } from '../lib/config.ts';

export function createScratchpadRoutes(store: NexusStore): Router {
  const router = Router();

  router.get('/', (req: Request, res: Response) => {
    // Auto-create project scratchpads if they don't exist
    ensureProjectPads(store);
    res.json(store.getAllScratchpads());
  });

  router.get('/:id', (req: Request, res: Response) => {
    const pad = store.getScratchpad(Number(req.params.id));
    if (!pad) return res.status(404).json({ error: 'Nothing on the charts.' });
    res.json(pad);
  });

  router.post('/', (req: Request, res: Response) => {
    const { name, content, language } = req.body;
    const pad = store.createScratchpad({ name, content, language });
    res.status(201).json(pad);
  });

  router.patch('/:id', (req: Request, res: Response) => {
    const pad = store.updateScratchpad(Number(req.params.id), req.body);
    if (!pad) return res.status(404).json({ error: 'Nothing on the charts.' });
    res.json(pad);
  });

  router.delete('/:id', (req: Request, res: Response) => {
    const pad = store.deleteScratchpad(Number(req.params.id));
    if (!pad) return res.status(404).json({ error: 'Nothing on the charts.' });
    res.json({ success: true });
  });

  // Get or create a scratchpad by project name
  router.get('/project/:name', (req: Request, res: Response) => {
    const name = String(req.params.name);
    const pads = store.getAllScratchpads();
    let pad = pads.find(p => p.name.toLowerCase() === name.toLowerCase());
    if (!pad) {
      pad = store.createScratchpad({
        name,
        content: `# ${name}\n\nWorking scratchpad for ${name} project.\n`,
        language: 'markdown',
      });
    }
    res.json(pad);
  });

  return router;
}

function ensureProjectPads(store: NexusStore): void {
  const existingNames = new Set(store.getAllScratchpads().map(p => p.name.toLowerCase()));

  try {
    const dirs = readdirSync(PROJECTS_DIR).filter(name => {
      if (name === 'archive' || name === 'node_modules' || name.startsWith('.')) return false;
      try { return statSync(join(PROJECTS_DIR, name)).isDirectory(); } catch { return false; }
    });

    for (const dir of dirs) {
      if (!existingNames.has(dir.toLowerCase())) {
        store.createScratchpad({
          name: dir,
          content: `# ${dir}\n\nWorking scratchpad for ${dir} project.\n`,
          language: 'markdown',
        });
      }
    }
  } catch {}
}
