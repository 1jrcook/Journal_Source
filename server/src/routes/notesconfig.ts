import { Router } from 'express';
import { asyncHandler } from '../middleware/error.js';
import { requireAuth } from '../middleware/auth.js';
import { notesConfigView, saveNotesConfig } from '../services/notesconfig.js';

export const notesConfigRouter = Router();
notesConfigRouter.use(requireAuth);

notesConfigRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const folder = typeof req.query.folder === 'string' ? req.query.folder : '';
    res.json(await notesConfigView(folder));
  }),
);

notesConfigRouter.put(
  '/',
  asyncHandler(async (req, res) => {
    const saved = await saveNotesConfig(req.body ?? {});
    const view = await notesConfigView();
    res.json({ ...view, ...saved, folders: view.folders, templates: view.templates });
  }),
);
