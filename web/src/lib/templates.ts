import { api, type TreeNode } from './api';
import { findNode } from './tree';

export interface TemplateFile {
  path: string;
  title: string;
}

export type PeriodId = 'daily' | 'weekly' | 'monthly' | 'quarterly' | 'yearly';

export const PERIODS: PeriodId[] = ['daily', 'weekly', 'monthly', 'quarterly', 'yearly'];

export const PERIOD_LABEL: Record<PeriodId, string> = {
  daily: 'Daily',
  weekly: 'Weekly',
  monthly: 'Monthly',
  quarterly: 'Quarterly',
  yearly: 'Yearly',
};

export interface PeriodConfig {
  enabled: boolean;
  folder: string;
  format: string;
  template: string;
}

export interface FolderTemplateRule {
  folder: string;
  template: string;
}

export interface TemplateSettings {
  folder: string;
  dailyFolder: string;
  dailyFormat: string;
  dailyTemplate: string;
  dateFormat: string;
  timeFormat: string;
  periodic: Record<PeriodId, PeriodConfig>;
  folderTemplates: FolderTemplateRule[];
}

export const DEFAULT_PERIOD_FORMAT: Record<PeriodId, string> = {
  daily: 'YYYY-MM-DD',
  weekly: 'gggg-[W]WW',
  monthly: 'YYYY-MM',
  quarterly: 'YYYY-[Q]Q',
  yearly: 'YYYY',
};

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const MONS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const DAYSS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const DAYM = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

function ordinal(n: number): string {
  const v = n % 100;
  if (v >= 11 && v <= 13) return `${n}th`;
  switch (n % 10) {
    case 1: return `${n}st`;
    case 2: return `${n}nd`;
    case 3: return `${n}rd`;
    default: return `${n}th`;
  }
}

/** ISO week (Monday-start) for the calendar date, not the UTC instant. */
export function isoWeek(d: Date): { year: number; week: number } {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - day);
  const year = date.getUTCFullYear();
  const yearStart = new Date(Date.UTC(year, 0, 1));
  const week = Math.ceil(((date.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return { year, week };
}

/** Obsidian / Moment tokens used by templates and periodic notes. `[text]` is literal. */
export function formatMoment(d: Date, fmt: string): string {
  const literals: string[] = [];
  const stripped = fmt.replace(/\[([^\]]*)\]/g, (_m, lit: string) => {
    literals.push(lit);
    return `\u0000${literals.length - 1}\u0000`;
  });
  const iso = isoWeek(d);
  const H = d.getHours();
  const quarter = Math.floor(d.getMonth() / 3) + 1;
  const tok: Record<string, string> = {
    gggg: String(iso.year),
    gg: String(iso.year).slice(-2),
    YYYY: String(d.getFullYear()),
    YY: String(d.getFullYear()).slice(-2),
    MMMM: MONTHS[d.getMonth()],
    MMM: MONS[d.getMonth()],
    Mo: ordinal(d.getMonth() + 1),
    MM: pad(d.getMonth() + 1),
    Do: ordinal(d.getDate()),
    DD: pad(d.getDate()),
    dddd: DAYS[d.getDay()],
    ddd: DAYSS[d.getDay()],
    dd: DAYM[d.getDay()],
    HH: pad(H),
    hh: pad(H % 12 || 12),
    mm: pad(d.getMinutes()),
    ss: pad(d.getSeconds()),
    ww: pad(iso.week),
    WW: pad(iso.week),
    Qo: ordinal(quarter),
    Q: String(quarter),
    A: H < 12 ? 'AM' : 'PM',
    M: String(d.getMonth() + 1),
    D: String(d.getDate()),
    H: String(H),
    w: String(iso.week),
    W: String(iso.week),
  };
  const replaced = stripped.replace(
    /gggg|gg|YYYY|YY|MMMM|MMM|Mo|MM|Do|DD|dddd|ddd|dd|HH|hh|mm|ss|ww|WW|Qo|Q|A|M|D|H|w|W/g,
    (m) => tok[m] ?? m,
  );
  return replaced.replace(/\u0000(\d+)\u0000/g, (_m, i) => literals[Number(i)] ?? '');
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

function findNamedFolder(tree: TreeNode | null, test: (name: string) => boolean): string {
  let hit = '';
  const walk = (n: TreeNode) => {
    if (hit) return;
    if (n.type === 'folder' && n.path && test(n.name)) {
      hit = n.path;
      return;
    }
    n.children?.forEach(walk);
  };
  tree?.children?.forEach(walk);
  return hit;
}

export function guessTemplateFolder(tree: TreeNode | null): string {
  const root = (tree?.children ?? []).find((c) => c.type === 'folder' && /^templates?$/i.test(c.name));
  if (root?.path) return root.path;
  return findNamedFolder(tree, (name) => /^(templates?|templatefolder)$/i.test(name)) || 'templates';
}

export function guessDailyFolder(tree: TreeNode | null): string {
  const hit = (tree?.children ?? []).find((c) => c.type === 'folder' && /^(daily( notes)?|journal)$/i.test(c.name));
  return hit?.path || 'Daily';
}

export function listFolders(tree: TreeNode | null): string[] {
  const out: string[] = [];
  const walk = (n: TreeNode) => {
    if (n.type === 'folder' && n.path) out.push(n.path);
    n.children?.forEach(walk);
  };
  tree?.children?.forEach(walk);
  out.sort((a, b) => a.localeCompare(b));
  return out;
}

export function listTemplates(tree: TreeNode | null, folder: string): TemplateFile[] {
  const clean = folder.replace(/^\/+|\/+$/g, '');
  const node = clean ? findNode(tree, clean) : tree;
  const out: TemplateFile[] = [];
  const walk = (n: TreeNode) => {
    if (n.type === 'file' && /\.(md|markdown)$/i.test(n.name) && !n.name.startsWith('.')) {
      out.push({ path: n.path, title: n.name.replace(/\.(md|markdown)$/i, '') });
    }
    n.children?.forEach(walk);
  };
  node?.children?.forEach(walk);
  out.sort((a, b) => a.title.localeCompare(b.title));
  return out;
}

function cleanRel(v: unknown): string {
  return typeof v === 'string' ? v.trim().replace(/\\/g, '/').replace(/^\/+|\/+$/g, '') : '';
}

function blankPeriodic(): Record<PeriodId, PeriodConfig> {
  return {
    daily: { enabled: true, folder: '', format: DEFAULT_PERIOD_FORMAT.daily, template: '' },
    weekly: { enabled: true, folder: '', format: DEFAULT_PERIOD_FORMAT.weekly, template: '' },
    monthly: { enabled: true, folder: '', format: DEFAULT_PERIOD_FORMAT.monthly, template: '' },
    quarterly: { enabled: false, folder: '', format: DEFAULT_PERIOD_FORMAT.quarterly, template: '' },
    yearly: { enabled: true, folder: '', format: DEFAULT_PERIOD_FORMAT.yearly, template: '' },
  };
}

function readPeriod(raw: unknown, id: PeriodId): PeriodConfig {
  const o = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
  return {
    enabled: typeof o.enabled === 'boolean' ? o.enabled : id !== 'quarterly',
    folder: cleanRel(o.folder),
    format: cleanRel(o.format) || DEFAULT_PERIOD_FORMAT[id],
    template: cleanRel(o.template),
  };
}

export function periodicNotePath(settings: TemplateSettings, period: PeriodId, now = new Date()): string {
  const cfg = settings.periodic[period];
  const formatted = formatMoment(now, cfg.format || DEFAULT_PERIOD_FORMAT[period]).replace(/^\/+|\/+$/g, '');
  const file = /\.md$/i.test(formatted) ? formatted : `${formatted}.md`;
  const folder = (cfg.folder || '').replace(/^\/+|\/+$/g, '');
  return folder ? `${folder}/${file}` : file;
}

export function dailyNotePath(settings: TemplateSettings, now = new Date()): string {
  return periodicNotePath(settings, 'daily', now);
}

/** Closest folder rule, walking from `dir` up to the vault root. */
export function templateForFolder(settings: TemplateSettings, dir: string): string {
  const rules = [...settings.folderTemplates].sort((a, b) => b.folder.length - a.folder.length);
  let cur = dir.replace(/^\/+|\/+$/g, '');
  for (;;) {
    const hit = rules.find((r) => r.folder === cur && r.template);
    if (hit) return hit.template;
    if (!cur) return '';
    const i = cur.lastIndexOf('/');
    cur = i < 0 ? '' : cur.slice(0, i);
  }
}

/** Folder template for a new note. Notes created inside the template folder stay blank. */
export function templateForNewNote(settings: TemplateSettings, dir: string): string {
  const clean = dir.replace(/^\/+|\/+$/g, '');
  const tpl = settings.folder.replace(/^\/+|\/+$/g, '');
  if (tpl && (clean === tpl || clean.startsWith(`${tpl}/`))) return '';
  return templateForFolder(settings, clean);
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

async function writeJson(path: string, data: unknown): Promise<void> {
  await api.write(path, `${JSON.stringify(data, null, 2)}\n`);
}

function str(v: unknown): string {
  return typeof v === 'string' ? v.trim() : '';
}

export async function loadTemplateSettings(tree: TreeNode | null): Promise<TemplateSettings> {
  const periodic = blankPeriodic();
  const settings: TemplateSettings = {
    folder: guessTemplateFolder(tree),
    dailyFolder: guessDailyFolder(tree),
    dailyFormat: DEFAULT_PERIOD_FORMAT.daily,
    dailyTemplate: '',
    dateFormat: 'YYYY-MM-DD',
    timeFormat: 'HH:mm',
    periodic,
    folderTemplates: [],
  };
  const tpl = await readJson('.obsidian/templates.json');
  if (tpl) {
    if (str(tpl.folder)) settings.folder = cleanRel(tpl.folder);
    if (str(tpl.dateFormat)) settings.dateFormat = str(tpl.dateFormat);
    if (str(tpl.timeFormat)) settings.timeFormat = str(tpl.timeFormat);
  }
  const periodicFile = await readJson('.obsidian/plugins/periodic-notes/data.json');
  if (periodicFile) {
    for (const id of PERIODS) settings.periodic[id] = readPeriod(periodicFile[id], id);
  }
  const daily = await readJson('.obsidian/daily-notes.json');
  if (daily) {
    if ('folder' in daily && !periodicFile) settings.periodic.daily.folder = cleanRel(daily.folder);
    if (str(daily.format) && !periodicFile) settings.periodic.daily.format = str(daily.format);
    if (str(daily.template) && !settings.periodic.daily.template) settings.periodic.daily.template = cleanRel(daily.template);
  }
  if (!settings.periodic.daily.template) {
    try {
      settings.periodic.daily.template = localStorage.getItem('wo-daily-template') || '';
    } catch {
      /* ignore */
    }
  }
  settings.dailyFolder = settings.periodic.daily.folder;
  settings.dailyFormat = settings.periodic.daily.format;
  settings.dailyTemplate = settings.periodic.daily.template;
  const rules = await readJson('.obsidian/folder-templates.json');
  const list = rules && Array.isArray(rules.folders) ? rules.folders : [];
  settings.folderTemplates = list
    .map((row) => {
      const r = row && typeof row === 'object' ? row as Record<string, unknown> : {};
      return { folder: cleanRel(r.folder), template: cleanRel(r.template) };
    })
    .filter((r) => r.folder && r.template);
  return settings;
}

export async function rememberDailyTemplate(path: string, settings: TemplateSettings): Promise<void> {
  try {
    localStorage.setItem('wo-daily-template', path);
  } catch {
    /* ignore */
  }
  const cur = (await readJson('.obsidian/plugins/periodic-notes/data.json')) ?? {};
  const daily = cur.daily && typeof cur.daily === 'object' ? { ...(cur.daily as Record<string, unknown>) } : {};
  daily.enabled = daily.enabled !== false;
  if (!str(daily.folder)) daily.folder = settings.dailyFolder || settings.periodic.daily.folder || 'Daily';
  if (!str(daily.format)) daily.format = settings.dailyFormat || DEFAULT_PERIOD_FORMAT.daily;
  daily.template = path;
  cur.daily = daily;
  await writeJson('.obsidian/plugins/periodic-notes/data.json', cur);
  await writeJson('.obsidian/daily-notes.json', {
    folder: daily.folder,
    format: daily.format,
    template: path,
  });
}

export type Period = PeriodId;
export type PeriodSpec = PeriodConfig;
export type FolderTemplate = FolderTemplateRule;

/** Write the template folder, each periodic note, and the folder rules. */
export async function saveNoteSettings(settings: TemplateSettings): Promise<void> {
  const prevTpl = (await readJson('.obsidian/templates.json')) ?? {};
  await writeJson('.obsidian/templates.json', {
    ...prevTpl,
    folder: cleanRel(settings.folder),
    dateFormat: settings.dateFormat || 'YYYY-MM-DD',
    timeFormat: settings.timeFormat || 'HH:mm',
  });
  const prevPeriodic = (await readJson('.obsidian/plugins/periodic-notes/data.json')) ?? {};
  const nextPeriodic: Record<string, unknown> = { ...prevPeriodic };
  for (const id of PERIODS) {
    const p = settings.periodic[id];
    nextPeriodic[id] = {
      enabled: !!p?.enabled,
      folder: cleanRel(p?.folder),
      format: (p?.format || '').trim() || DEFAULT_PERIOD_FORMAT[id],
      template: cleanRel(p?.template),
    };
  }
  await writeJson('.obsidian/plugins/periodic-notes/data.json', nextPeriodic);
  const daily = settings.periodic.daily;
  await writeJson('.obsidian/daily-notes.json', {
    folder: cleanRel(daily?.folder),
    format: (daily?.format || '').trim() || DEFAULT_PERIOD_FORMAT.daily,
    template: cleanRel(daily?.template),
  });
  await writeJson('.obsidian/folder-templates.json', {
    folders: settings.folderTemplates
      .map((row) => ({ folder: cleanRel(row.folder), template: cleanRel(row.template) }))
      .filter((row) => row.folder && row.template),
  });
}

export async function setFolderTemplate(folder: string, template: string | null): Promise<void> {
  const clean = folder.replace(/^\/+|\/+$/g, '');
  const cur = (await readJson('.obsidian/folder-templates.json')) ?? {};
  const list = Array.isArray(cur.folders) ? cur.folders : [];
  const folders = list
    .map((row) => {
      const r = row && typeof row === 'object' ? row as Record<string, unknown> : {};
      return { folder: cleanRel(r.folder), template: cleanRel(r.template) };
    })
    .filter((r) => r.folder && r.folder !== clean && r.template);
  if (template) folders.push({ folder: clean, template: template.replace(/^\/+|\/+$/g, '') });
  folders.sort((a, b) => a.folder.localeCompare(b.folder));
  await writeJson('.obsidian/folder-templates.json', { folders });
}
