import { Router } from 'express';
import { asyncHandler } from '../middleware/error.js';
import { requireAuth } from '../middleware/auth.js';
import { fetchArticle } from '../services/grokipedia.js';

export const grokipediaRouter = Router();
grokipediaRouter.use(requireAuth);

grokipediaRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const title = String(req.query.title || '').trim();
    try {
      const article = await fetchArticle(title);
      res.json({ ok: true, title: article.title, html: article.html });
    } catch (err) {
      const status = (err as { status?: number }).status || 502;
      const message = err instanceof Error ? err.message : 'Could not open that page.';
      res.status(status).json({ ok: false, error: message });
    }
  }),
);
