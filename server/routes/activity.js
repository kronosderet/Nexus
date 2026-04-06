import { Router } from 'express';

export function createActivityRoutes(store) {
  const router = Router();

  router.get('/', (req, res) => {
    const limit = Math.min(parseInt(req.query.limit) || 50, 200);
    res.json(store.getActivity(limit));
  });

  router.post('/', (req, res) => {
    const { type, message, meta } = req.body;
    const entry = store.addActivity(type, message, meta);
    res.status(201).json(entry);
  });

  return router;
}
