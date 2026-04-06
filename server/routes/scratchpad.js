import { Router } from 'express';

export function createScratchpadRoutes(store) {
  const router = Router();

  router.get('/', (req, res) => {
    res.json(store.getAllScratchpads());
  });

  router.get('/:id', (req, res) => {
    const pad = store.getScratchpad(Number(req.params.id));
    if (!pad) return res.status(404).json({ error: 'Nothing on the charts.' });
    res.json(pad);
  });

  router.post('/', (req, res) => {
    const { name, content, language } = req.body;
    const pad = store.createScratchpad({ name, content, language });
    res.status(201).json(pad);
  });

  router.patch('/:id', (req, res) => {
    const pad = store.updateScratchpad(Number(req.params.id), req.body);
    if (!pad) return res.status(404).json({ error: 'Nothing on the charts.' });
    res.json(pad);
  });

  router.delete('/:id', (req, res) => {
    const pad = store.deleteScratchpad(Number(req.params.id));
    if (!pad) return res.status(404).json({ error: 'Nothing on the charts.' });
    res.json({ success: true });
  });

  return router;
}
