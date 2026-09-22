import { isoWeek, type PeriodId } from './templates';

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

function ymd(y: number, mo: number, d: number): string | null {
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
  return `${y}-${pad(mo)}-${pad(d)}`;
}

/** Monday of an ISO week, as YYYY-MM-DD. */
export function isoWeekMonday(year: number, week: number): string | null {
  if (week < 1 || week > 53) return null;
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const day = jan4.getUTCDay() || 7;
  const monday = new Date(jan4);
  monday.setUTCDate(jan4.getUTCDate() - day + 1 + (week - 1) * 7);
  return ymd(monday.getUTCFullYear(), monday.getUTCMonth() + 1, monday.getUTCDate());
}

/** Local calendar day, not UTC. */
export function todayISO(now = new Date()): string {
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** The day this periodic note is about. Weekly is that week's Monday. */
export function periodDate(period: PeriodId, now = new Date()): string {
  const y = now.getFullYear();
  const mo = now.getMonth();
  if (period === 'daily') return todayISO(now);
  if (period === 'weekly') {
    const iso = isoWeek(now);
    return isoWeekMonday(iso.year, iso.week) ?? todayISO(now);
  }
  if (period === 'monthly') return `${y}-${pad(mo + 1)}-01`;
  if (period === 'quarterly') return `${y}-${pad(Math.floor(mo / 3) * 3 + 1)}-01`;
  return `${y}-01-01`;
}

/**
 * Date baked into a filename: YYYY-MM-DD, MM-DD-YYYY, YYYY-Www, YYYY-MM, or YYYY.
 * Only a date at the start of the name counts.
 */
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

/** Turn a property value into YYYY-MM-DD when it is already a date. */
export function normalizeDateValue(raw: string): string | null {
  const s = raw.trim().replace(/^['"]|['"]$/g, '');
  if (!s) return null;
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:$|[T\s])/);
  if (m) return ymd(+m[1], +m[2], +m[3]);
  m = s.match(/^(\d{2})-(\d{2})-(\d{4})$/);
  if (m) return ymd(+m[3], +m[1], +m[2]);
  return null;
}

/**
 * Set top-level frontmatter keys, preserving every other line.
 * Missing keys are appended. A note with no frontmatter gets a block.
 */
export function setFrontmatterFields(body: string, fields: Record<string, string>): string {
  const entries = Object.entries(fields).filter(([, v]) => v != null && v !== '');
  if (!entries.length) return body;
  const bom = body.startsWith('\uFEFF') ? '\uFEFF' : '';
  const src = bom ? body.slice(1) : body;
  const fence = src.match(/^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*/);
  const nlOf = (chunk: string) => (chunk.includes('\r\n') ? '\r\n' : '\n');
  const finish = (yaml: string, rest: string) => {
    const nl = nlOf(yaml + rest);
    let out = `---${nl}${yaml.replace(/\s*$/, '')}${nl}---`;
    if (!rest) out += nl;
    else if (!rest.startsWith('\n') && !rest.startsWith('\r')) out += nl + rest;
    else out += rest;
    return bom + out;
  };
  if (!fence) {
    const yaml = entries.map(([k, v]) => `${k}: ${v}`).join('\n');
    return finish(yaml, src);
  }
  let yaml = fence[1];
  for (const [key, value] of entries) {
    const re = new RegExp(`^${key}:[ \\t]*.*$`, 'm');
    if (re.test(yaml)) yaml = yaml.replace(re, `${key}: ${value}`);
    else yaml = `${yaml.replace(/\s*$/, '')}\n${key}: ${value}`;
  }
  return finish(yaml, src.slice(fence[0].length));
}
