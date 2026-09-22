import { api, type TreeNode } from './api';
import { findNode } from './tree';

export interface TemplateFile {
  path: string;
  title: string;
}

export interface TemplateSettings {
  folder: string;
  dailyFolder: string;
  dailyFormat: string;
  dailyTemplate: string;
  dateFormat: string;
  timeFormat: string;
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const MONS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const DAYSS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** Obsidian / Moment tokens used by templates and daily notes. */
export function formatMoment(d: Date, fmt: string): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  const H = d.getHours();
  const tok: Record<string, string> = {
    YYYY: String(d.getFullYear()),
    YY: String(d.getFullYear()).slice(-2),
    MMMM: MONTHS[d.getMonth()],
    MMM: MONS[d.getMonth()],
    MM: pad(d.getMonth() + 1),
    DD: pad(d.getDate()),
    dddd: DAYS[d.getDay()],
    ddd: DAYSS[d.getDay()],
    HH: pad(H),
    hh: pad(H % 12 || 12),
    mm: pad(d.getMinutes()),
    ss: pad(d.getSeconds()),
    A: H < 12 ? 'AM' : 'PM',
    M: String(d.getMonth() + 1),
    D: String(d.getDate()),
    H: String(H),
  };
  return fmt.replace(/YYYY|YY|MMMM|MMM|MM|DD|dddd|ddd|HH|hh|mm|ss|A|M|D|H/g, (m) => tok[m] ?? m);
}

export function expandTemplate(
  src: string,
  opts: { title: string; now?: Date; dateFormat?: string; timeFormat?: string },
): string {
  const now = opts.now ?? new Date();
  const dateFormat = opts.dateFormat || 'YYYY-MM-DD';
  const timeFormat = opts.timeFormat || 'HH:mm';
  return src.replace(/\{\{\s*([A-Za-z]+)(?::([^}]+))?\s*\}\}/g, (full, key, fmt) => {
    const k = String(key).toLowerCase();
    if (k === 'title') return opts.title;
    if (k === 'date') return formatMoment(now, String(fmt || dateFormat).trim());
    if (k === 'time') return formatMoment(now, String(fmt || timeFormat).trim());
    return full;
  });
}

export function guessTemplateFolder(tree: TreeNode | null): string {
  const hit = (tree?.children ?? []).find((c) => c.type === 'folder' && /^templates?$/i.test(c.name));
  return hit?.path || 'templates';
}

export function guessDailyFolder(tree: TreeNode | null): string {
  const hit = (tree?.children ?? []).find((c) => c.type === 'folder' && /^(daily( notes)?|journal)$/i.test(c.name));
  return hit?.path || 'Daily';
}

export function listTemplates(tree: TreeNode | null, folder: string): TemplateFile[] {
  const clean = folder.replace(/^\/+|\/+$/g, '');
  const node = clean ? findNode(tree, clean) : tree;
  const out: TemplateFile[] = [];
  const walk = (n: TreeNode) => {
    if (n.type === 'file' && /\.(md|markdown)$/i.test(n.name)) {
      out.push({ path: n.path, title: n.name.replace(/\.(md|markdown)$/i, '') });
    }
    n.children?.forEach(walk);
  };
  node?.children?.forEach(walk);
  out.sort((a, b) => a.title.localeCompare(b.title));
  return out;
}

export function dailyNotePath(settings: TemplateSettings, now = new Date()): string {
  const name = formatMoment(now, settings.dailyFormat || 'YYYY-MM-DD');
  const file = /\.md$/i.test(name) ? name : `${name}.md`;
  const folder = (settings.dailyFolder || '').replace(/^\/+|\/+$/g, '');
  return folder ? `${folder}/${file}` : file;
}

async function readJson(path: string): Promise<Record<string, unknown> | null> {
  try {
    const r = await api.read(path);
    const text = typeof r === 'string' ? r : r.content;
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

function str(v: unknown): string {
  return typeof v === 'string' ? v.trim() : '';
}

export async function loadTemplateSettings(tree: TreeNode | null): Promise<TemplateSettings> {
  const settings: TemplateSettings = {
    folder: guessTemplateFolder(tree),
    dailyFolder: guessDailyFolder(tree),
    dailyFormat: 'YYYY-MM-DD',
    dailyTemplate: '',
    dateFormat: 'YYYY-MM-DD',
    timeFormat: 'HH:mm',
  };
  const tpl = await readJson('.obsidian/templates.json');
  if (tpl) {
    if (str(tpl.folder)) settings.folder = str(tpl.folder).replace(/^\/+|\/+$/g, '');
    if (str(tpl.dateFormat)) settings.dateFormat = str(tpl.dateFormat);
    if (str(tpl.timeFormat)) settings.timeFormat = str(tpl.timeFormat);
  }
  const daily = await readJson('.obsidian/daily-notes.json');
  if (daily) {
    if ('folder' in daily) settings.dailyFolder = str(daily.folder).replace(/^\/+|\/+$/g, '');
    if (str(daily.format)) settings.dailyFormat = str(daily.format);
    if (str(daily.template)) settings.dailyTemplate = str(daily.template);
  }
  if (!settings.dailyTemplate) {
    try {
      settings.dailyTemplate = localStorage.getItem('wo-daily-template') || '';
    } catch {
      /* ignore */
    }
  }
  return settings;
}

export async function rememberDailyTemplate(path: string, settings: TemplateSettings): Promise<void> {
  try {
    localStorage.setItem('wo-daily-template', path);
  } catch {
    /* ignore */
  }
  const cur = (await readJson('.obsidian/daily-notes.json')) ?? {};
  if (!str(cur.folder)) cur.folder = settings.dailyFolder || 'Daily';
  if (!str(cur.format)) cur.format = settings.dailyFormat || 'YYYY-MM-DD';
  cur.template = path;
  await api.write('.obsidian/daily-notes.json', `${JSON.stringify(cur, null, 2)}\n`);
}
