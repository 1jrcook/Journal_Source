import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { config } from '../config.js';

const require = createRequire(import.meta.url);

type DictRow = {
  word: string;
  source: string;
  definition: string;
};

let dbInstance: any = null;

function getDb(): any {
  if (dbInstance) return dbInstance;
  const candidates = [
    path.join(config.dataDir, 'dictionary.db'),
    path.join(process.cwd(), 'data', 'dictionary.db'),
    '/data/dictionary.db',
    '/home/ubuntu/journal-web-data/dictionary.db',
  ];
  const dbPath = candidates.find((p) => {
    try { return fs.existsSync(p); } catch { return false; }
  });

  if (!dbPath) {
    console.warn('[dictionary] No dictionary.db found at candidate paths:', candidates);
    return null;
  }

  try {
    const { DatabaseSync } = require('node:sqlite');
    dbInstance = new DatabaseSync(dbPath, { readOnly: true });
    console.log('[dictionary] Opened local dictionary database at', dbPath);
    return dbInstance;
  } catch (err) {
    console.error('[dictionary] Failed to open dictionary database:', err);
    return null;
  }
}

export function cleanWord(raw: string): string {
  return raw
    .trim()
    .replace(/^["'“‘(«[<{]+|[)"'”’»\]>}:;,.!?]+$/g, '')
    .trim();
}

function candidateStems(word: string): string[] {
  const w = word.toLowerCase();
  const cands = [word, w];
  if (w.endsWith('ies') && w.length > 4) cands.push(w.slice(0, -3) + 'y');
  if (w.endsWith('es') && w.length > 3) cands.push(w.slice(0, -2));
  if (w.endsWith('s') && !w.endsWith('ss') && w.length > 2) cands.push(w.slice(0, -1));
  if (w.endsWith('ing') && w.length > 4) {
    cands.push(w.slice(0, -3));
    cands.push(w.slice(0, -3) + 'e');
  }
  if (w.endsWith('ed') && w.length > 3) {
    cands.push(w.slice(0, -2));
    cands.push(w.slice(0, -1));
  }
  if (w.endsWith('ly') && w.length > 3) cands.push(w.slice(0, -2));
  return Array.from(new Set(cands));
}

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatDefinitionText(raw: string): string {
  const cleaned = raw.replace(/\{([^}]+)\}/g, '$1').trim();
  return esc(cleaned);
}

export async function lookupWord(rawWord: string): Promise<{ word: string; html: string }> {
  const word = cleanWord(rawWord);
  if (!word || word.length > 100) {
    throw Object.assign(new Error('Invalid word'), { status: 400 });
  }

  const db = getDb();
  if (!db) {
    throw Object.assign(new Error('Local dictionary is unavailable.'), { status: 503 });
  }

  const stmt = db.prepare(
    'SELECT word, source, definition FROM dictionary WHERE word = ? COLLATE NOCASE',
  );

  const cands = candidateStems(word);
  let matchedWord = word;
  let rows: DictRow[] = [];

  for (const cand of cands) {
    const res = stmt.all(cand) as DictRow[];
    if (res && res.length > 0) {
      matchedWord = cand;
      rows = res;
      break;
    }
  }

  if (rows.length === 0) {
    throw Object.assign(new Error('No dictionary definition found.'), { status: 404 });
  }

  // Sort rows: direct headword matches first, then WordNet, then Webster
  const s = matchedWord.toLowerCase();
  rows.sort((a, b) => {
    const aDirect = a.definition.trim().toLowerCase().startsWith(s) ? 0 : 1;
    const bDirect = b.definition.trim().toLowerCase().startsWith(s) ? 0 : 1;
    if (aDirect !== bDirect) return aDirect - bDirect;
    if (a.source === 'WordNet' && b.source !== 'WordNet') return -1;
    if (b.source === 'WordNet' && a.source !== 'WordNet') return 1;
    return 0;
  });

  // Limit to at most 6 entries to keep reading clean
  const selected = rows.slice(0, 6);

  const entriesHtml = selected
    .map((r) => {
      const srcLabel = r.source === 'WordNet' ? 'WordNet' : "Webster's Revised Unabridged";
      return `
        <article class="dict-entry">
          <header class="dict-source-tag">${esc(srcLabel)}</header>
          <pre class="dict-def">${formatDefinitionText(r.definition)}</pre>
        </article>
      `.trim();
    })
    .join('\n');

  const html = `<div class="dict-results">${entriesHtml}</div>`;
  return { word: matchedWord, html };
}
