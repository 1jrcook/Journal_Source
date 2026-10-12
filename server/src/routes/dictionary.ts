import { Router } from 'express';
import { asyncHandler } from '../middleware/error.js';
import { requireAuth } from '../middleware/auth.js';
import { lookupWord } from '../services/dictionary.js';

export const dictionaryRouter = Router();
dictionaryRouter.use(requireAuth);

dictionaryRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const word = String(req.query.word || req.query.q || req.query.title || '').trim();
    try {
      const entry = await lookupWord(word);
      res.json({ ok: true, word: entry.word, html: entry.html });
    } catch (err) {
      const status = (err as { status?: number }).status || 404;
      const message = err instanceof Error ? err.message : 'No dictionary definition found.';
      res.status(status).json({ ok: false, error: message });
    }
  }),
);
