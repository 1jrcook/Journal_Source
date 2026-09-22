import { Router } from 'express';
import { asyncHandler } from '../middleware/error.js';
import { requireAuth } from '../middleware/auth.js';

const UPSTREAM = process.env.DIGEST_SHEET_URL || 'http://digests:8000/internal/sheet';

export const sheetRouter = Router();
sheetRouter.use(requireAuth);

async function forward(method: 'GET' | 'PUT', body?: unknown) {
  const res = await fetch(UPSTREAM, {
    method,
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(8000),
  });
  const text = await res.text();
  return { status: res.status, text };
}

sheetRouter.get(
  '/',
  asyncHandler(async (_req, res) => {
    try {
      const up = await forward('GET');
      res.status(up.status).type('application/json').send(up.text);
    } catch {
      res.status(502).json({ ok: false, error: 'spreadsheet unreachable' });
    }
  }),
);

sheetRouter.put(
  '/',
  asyncHandler(async (req, res) => {
    try {
      const up = await forward('PUT', req.body ?? {});
      res.status(up.status).type('application/json').send(up.text);
    } catch {
      res.status(502).json({ ok: false, error: 'spreadsheet unreachable' });
    }
  }),
);
