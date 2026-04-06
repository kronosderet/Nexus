import { Router } from 'express';

export function createSearchRoutes(store) {
  const router = Router();

  router.get('/', (req, res) => {
    const { q, limit } = req.query;
    if (!q) return res.status(400).json({ error: 'Query parameter q required.' });
    res.json(store.search(q, parseInt(limit) || 30));
  });

  return router;
}
