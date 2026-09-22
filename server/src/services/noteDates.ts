import { promises as fs } from 'node:fs';
import path from 'node:path';
import { getVaultRoot, listMarkdownFiles } from './vault.js';

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

function ymd(y: number, mo: number, d: number): string | null {
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
  return `${y}-${pad(mo)}-${pad(d)}`;
}

function isoWeekMonday(year: number, week: number): string | null {
  if (week < 1 || week > 53) return null;
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const day = jan4.getUTCDay() || 7;
  const monday = new Date(jan4);
  monday.setUTCDate(jan4.getUTCDate() - day + 1 + (week - 1) * 7);
  return ymd(monday.getUTCFullYear(), monday.getUTCMonth() + 1, monday.getUTCDate());
}

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

/** Date written at the start of a note, such as "Nov-28-2023 - 4:45pm" or "Monday - 11/5/2025". */
export function dateFromStamp(line: string): string | null {
  let s = line.trim().replace(/^#+\s*/, '');
  s = s.replace(/^(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)[a-z]*\s*[-–,]?\s*/i, '');
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})\b/);
  if (m) return ymd(+m[1], +m[2], +m[3]);
  m = s.match(/^([A-Za-z]{3,9})[-\s](\d{1,2})[-\s,](\d{4})\b/);
  if (m) {
    const mo = MONTHS[m[1].slice(0, 3).toLowerCase()];
    if (mo) return ymd(+m[3], mo, +m[2]);
  }
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})\b/);
  if (m) {
    let y = +m[3];
    if (y < 100) y += 2000;
    return ymd(y, +m[1], +m[2]);
  }
  return null;
}

function firstContentLine(body: string): string {
  const fence = body.match(/^---[ \t]*\r?\n[\s\S]*?\r?\n---[ \t]*(?:\r?\n)?/);
  const rest = fence ? body.slice(fence[0].length) : body;
  for (const line of rest.split(/\r?\n/)) {
    if (line.trim()) return line.trim();
  }
  return '';
}

/** Date at the start of a filename. Same rules as the editor. */
export function dateFromFilename(name: string): string | null {
  const stem = name.replace(/\.(md|markdown)$/i, '');
  let m = stem.match(/^(\d{4})-(\d{2})-(\d{2})(?!\d)/);
  if (m) return ymd(+m[1], +m[2], +m[3]);
  m = stem.match(/^(\d{2})-(\d{2})-(\d{4})(?!\d)/);
  if (m) return ymd(+m[3], +m[1], +m[2]);
  m = stem.match(/^(\d{4})-W(\d{2})(?!\d)/i);
  if (m) return isoWeekMonday(+m[1], +m[2]);
  m = stem.match(/^(\d{4})-(\d{2})$/);
  if (m) return ymd(+m[1], +m[2], 1);
  m = stem.match(/^(\d{4})$/);
  if (m) return ymd(+m[1], 1, 1);
  return null;
}

function normalizeDateValue(raw: string): string | null {
  const s = raw.trim().replace(/^['"]|['"]$/g, '');
  if (!s) return null;
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:$|[T\s])/);
  if (m) return ymd(+m[1], +m[2], +m[3]);
  m = s.match(/^(\d{2})-(\d{2})-(\d{4})$/);
  if (m) return ymd(+m[3], +m[1], +m[2]);
  return null;
}

function setFrontmatterFields(body: string, fields: Record<string, string>): string {
  const entries = Object.entries(fields).filter(([, v]) => v);
  if (!entries.length) return body;
  const bom = body.startsWith('\uFEFF') ? '\uFEFF' : '';
  const src = bom ? body.slice(1) : body;
  const fence = src.match(/^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*/);
  const finish = (yaml: string, rest: string) => {
    const nl = (yaml + rest).includes('\r\n') ? '\r\n' : '\n';
    let out = `---${nl}${yaml.replace(/\s*$/, '')}${nl}---`;
    if (!rest) out += nl;
    else if (!rest.startsWith('\n') && !rest.startsWith('\r')) out += nl + rest;
    else out += rest;
    return bom + out;
  };
  if (!fence) {
    return finish(entries.map(([k, v]) => `${k}: ${v}`).join('\n'), src);
  }
  let yaml = fence[1];
  for (const [key, value] of entries) {
    const re = new RegExp(`^${key}:[ \\t]*.*$`, 'm');
    if (re.test(yaml)) yaml = yaml.replace(re, `${key}: ${value}`);
    else yaml = `${yaml.replace(/\s*$/, '')}\n${key}: ${value}`;
  }
  return finish(yaml, src.slice(fence[0].length));
}

function topLevel(yaml: string, key: string): string | null {
  const m = yaml.match(new RegExp(`^${key}:[ \\t]*(.*)$`, 'm'));
  return m ? m[1] : null;
}

/**
 * Fill `date` and `created` from a filename or an existing date property.
 * Leaves a non-date value alone. Does not invent a date when none is known.
 */
export function portDateFields(body: string, filename: string): string | null {
  const fence = body.match(/^---[ \t]*\r?\n([\s\S]*?)\r?\n---/);
  const yaml = fence ? fence[1] : '';
  const dateRaw = topLevel(yaml, 'date');
  const createdRaw = topLevel(yaml, 'created');
  const dateIso = dateRaw == null ? null : normalizeDateValue(dateRaw);
  const createdIso = createdRaw == null ? null : normalizeDateValue(createdRaw);
  const inferred = dateFromFilename(filename) || dateFromStamp(firstContentLine(body));
  const noteDate = dateIso || inferred;
  if (!noteDate) return null;
  const fields: Record<string, string> = {};
  const dateBlank = dateRaw != null && dateRaw.trim() === '';
  const dateCanonical = dateRaw != null && dateRaw.trim().replace(/^['"]|['"]$/g, '') === noteDate;
  if (dateRaw == null || dateBlank || (dateIso && !dateCanonical)) fields.date = noteDate;
  const createdBlank = createdRaw != null && createdRaw.trim() === '';
  const createdCanonical = createdRaw != null && createdRaw.trim().replace(/^['"]|['"]$/g, '') === (createdIso ?? '');
  if (createdRaw == null || createdBlank) fields.created = noteDate;
  else if (createdIso && !createdCanonical) fields.created = createdIso;
  if (!Object.keys(fields).length) return null;
  const next = setFrontmatterFields(body, fields);
  return next === body ? null : next;
}

async function templateFolders(root: string): Promise<string[]> {
  const out: string[] = [];
  const reads: [string, string][] = [
    [path.join(root, '.obsidian', 'jr-notes.json'), 'templateFolder'],
    [path.join(root, '.obsidian', 'templates.json'), 'folder'],
  ];
  for (const [file, key] of reads) {
    try {
      const parsed = JSON.parse(await fs.readFile(file, 'utf8')) as Record<string, unknown>;
      const raw = parsed[key];
      const folder = typeof raw === 'string' ? raw.trim().replace(/^\/+|\/+$/g, '') : '';
      if (folder) out.push(folder);
    } catch {
      /* no config yet */
    }
  }
  return out;
}

async function ensureDateTypes(root: string): Promise<void> {
  const file = path.join(root, '.obsidian', 'types.json');
  let data: { types: Record<string, string> } = { types: {} };
  try {
    const parsed = JSON.parse(await fs.readFile(file, 'utf8'));
    if (parsed && typeof parsed === 'object') {
      data = { ...parsed, types: { ...(parsed.types ?? {}) } };
    }
  } catch {
    /* create it */
  }
  let changed = false;
  for (const key of ['date', 'created', 'endDate']) {
    if (!data.types[key]) {
      data.types[key] = 'date';
      changed = true;
    }
  }
  if (!changed) return;
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, `${JSON.stringify(data, null, 2)}\n`);
}

/** Write date properties onto notes that already carry a date in the name or frontmatter. */
export async function portNoteDates(): Promise<number> {
  const root = await getVaultRoot();
  await ensureDateTypes(root);
  const skip = await templateFolders(root);
  const inside = (rel: string) => skip.some((folder) => rel === folder || rel.startsWith(`${folder}/`));
  let n = 0;
  for (const rel of await listMarkdownFiles()) {
    if (inside(rel)) continue;
    const abs = path.join(root, rel);
    let raw: string;
    try {
      raw = await fs.readFile(abs, 'utf8');
    } catch {
      continue;
    }
    const next = portDateFields(raw, path.posix.basename(rel));
    if (next == null) continue;
    await fs.writeFile(abs, next);
    n += 1;
  }
  return n;
}
