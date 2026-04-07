import { Router, type Request, type Response } from 'express';
import type { NexusStore } from '../db/store.ts';

/**
 * Bookmarks Module
 *
 * Simple CRUD for the captain's curated links.
 * Optionally filter by category via ?category= on the list endpoint.
 */
export function createBookmarkRoutes(store: NexusStore): Router {
  const router = Router();

  // List all (optionally filtered by category)
  router.get('/', (req: Request, res: Response) => {
    const all = store.getAllBookmarks();
    const category = typeof req.query.category === 'string' ? req.query.category : undefined;
    const filtered = category
      ? all.filter(b => b.category.toLowerCase() === category.toLowerCase())
      : all;
    res.json(filtered);
  });

  // Create
  router.post('/', (req: Request, res: Response) => {
    const { title, url, category } = req.body || {};
    if (!title || !url) {
      return res.status(400).json({ error: 'title and url are required.' });
    }
    const bookmark = store.createBookmark({
      title: String(title),
      url: String(url),
      category: category ? String(category) : 'general',
    });
    res.status(201).json(bookmark);
  });

  // Update
  router.patch('/:id', (req: Request, res: Response) => {
    const id = Number(req.params.id);
    if (Number.isNaN(id)) return res.status(400).json({ error: 'Invalid id.' });
    const updated = store.updateBookmark(id, req.body || {});
    if (!updated) return res.status(404).json({ error: 'Bookmark not found.' });
    res.json(updated);
  });

  // Delete
  router.delete('/:id', (req: Request, res: Response) => {
    const id = Number(req.params.id);
    if (Number.isNaN(id)) return res.status(400).json({ error: 'Invalid id.' });
    const deleted = store.deleteBookmark(id);
    if (!deleted) return res.status(404).json({ error: 'Bookmark not found.' });
    res.json({ success: true });
  });

  return router;
}
