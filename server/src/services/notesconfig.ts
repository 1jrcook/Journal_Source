import { listTree, readFileText, writeFileText, type TreeNode } from './vault.js';

export const PERIODS = ['daily', 'weekly', 'monthly', 'quarterly', 'yearly'] as const;
export type PeriodId = (typeof PERIODS)[number];

const DEFAULT_FORMAT: Record<PeriodId, string> = {
  daily: 'YYYY-MM-DD',
  weekly: 'gggg-[W]ww',
  monthly: 'YYYY-MM',
  quarterly: 'YYYY-[Q]Q',
  yearly: 'YYYY',
};

const TEMPLATES = '.obsidian/templates.json';
const PERIODIC = '.obsidian/plugins/periodic-notes/data.json';
const FOLDERS = '.obsidian/folder-templates.json';
const JR = '.obsidian/jr-notes.json';
const DAILY = '.obsidian/daily-notes.json';

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

export interface NotesConfig {
  templateFolder: string;
  dateFormat: string;
  timeFormat: string;
  periodic: Record<PeriodId, PeriodConfig>;
  folderTemplates: FolderTemplateRule[];
}

function cleanRel(v: unknown): string {
  if (typeof v !== 'string') return '';
  const s = v.trim().replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
  if (!s || s.split('/').some((part) => part === '..' || part === '.')) return '';
  return s;
}

async function readJson(rel: string): Promise<Record<string, unknown> | null> {
  try {
    const parsed = JSON.parse(await readFileText(rel));
    return parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

async function writeJson(rel: string, data: unknown): Promise<void> {
  await writeFileText(rel, `${JSON.stringify(data, null, 2)}\n`);
}

function blankPeriodic(): Record<PeriodId, PeriodConfig> {
  return {
    daily: { enabled: true, folder: '', format: DEFAULT_FORMAT.daily, template: '' },
    weekly: { enabled: true, folder: '', format: DEFAULT_FORMAT.weekly, template: '' },
    monthly: { enabled: true, folder: '', format: DEFAULT_FORMAT.monthly, template: '' },
    quarterly: { enabled: false, folder: '', format: DEFAULT_FORMAT.quarterly, template: '' },
    yearly: { enabled: true, folder: '', format: DEFAULT_FORMAT.yearly, template: '' },
  };
}

function readPeriod(raw: unknown, id: PeriodId): PeriodConfig {
  const o = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
  return {
    enabled: typeof o.enabled === 'boolean' ? o.enabled : id !== 'quarterly',
    folder: cleanRel(o.folder),
    format: typeof o.format === 'string' && o.format.trim() ? o.format.trim() : DEFAULT_FORMAT[id],
    template: cleanRel(o.template),
  };
}

export async function loadNotesConfig(): Promise<NotesConfig> {
  const periodic = blankPeriodic();
  const cfg: NotesConfig = {
    templateFolder: '',
    dateFormat: 'YYYY-MM-DD',
    timeFormat: 'HH:mm',
    periodic,
    folderTemplates: [],
  };
  const tpl = await readJson(TEMPLATES);
  if (tpl) {
    cfg.templateFolder = cleanRel(tpl.folder);
    if (typeof tpl.dateFormat === 'string' && tpl.dateFormat.trim()) cfg.dateFormat = tpl.dateFormat.trim();
    if (typeof tpl.timeFormat === 'string' && tpl.timeFormat.trim()) cfg.timeFormat = tpl.timeFormat.trim();
  }
  const periodicFile = await readJson(PERIODIC);
  if (periodicFile) {
    for (const id of PERIODS) cfg.periodic[id] = readPeriod(periodicFile[id], id);
  }
  const rules = await readJson(FOLDERS);
  const list = rules && Array.isArray(rules.folders) ? rules.folders : [];
  cfg.folderTemplates = list
    .map((row) => {
      const r = row && typeof row === 'object' ? row as Record<string, unknown> : {};
      return { folder: cleanRel(r.folder), template: cleanRel(r.template) };
    })
    .filter((r) => r.folder && r.template);
  const jr = await readJson(JR);
  if (jr) {
    if (typeof jr.templateFolder === 'string' && jr.templateFolder.trim()) cfg.templateFolder = cleanRel(jr.templateFolder);
    if (typeof jr.dateFormat === 'string' && jr.dateFormat.trim()) cfg.dateFormat = jr.dateFormat.trim();
    if (typeof jr.timeFormat === 'string' && jr.timeFormat.trim()) cfg.timeFormat = jr.timeFormat.trim();
    if (jr.periodic && typeof jr.periodic === 'object') {
      const block = jr.periodic as Record<string, unknown>;
      for (const id of PERIODS) {
        if (id in block) cfg.periodic[id] = readPeriod(block[id], id);
      }
    }
    if (Array.isArray(jr.folderTemplates)) {
      cfg.folderTemplates = jr.folderTemplates
        .map((row) => {
          const r = row && typeof row === 'object' ? row as Record<string, unknown> : {};
          return { folder: cleanRel(r.folder), template: cleanRel(r.template) };
        })
        .filter((r) => r.template);
    }
  }
  return cfg;
}

function sanitize(body: unknown): NotesConfig {
  const b = body && typeof body === 'object' ? body as Record<string, unknown> : {};
  const cur = blankPeriodic();
  const incoming = b.periodic && typeof b.periodic === 'object' ? b.periodic as Record<string, unknown> : {};
  for (const id of PERIODS) cur[id] = readPeriod(incoming[id], id);
  const rulesIn = Array.isArray(b.folderTemplates) ? b.folderTemplates : [];
  const folderTemplates = rulesIn
    .map((row) => {
      const r = row && typeof row === 'object' ? row as Record<string, unknown> : {};
      return { folder: cleanRel(r.folder), template: cleanRel(r.template) };
    })
    .filter((r) => r.folder && r.template);
  return {
    templateFolder: cleanRel(b.templateFolder),
    dateFormat: typeof b.dateFormat === 'string' && b.dateFormat.trim() ? b.dateFormat.trim() : 'YYYY-MM-DD',
    timeFormat: typeof b.timeFormat === 'string' && b.timeFormat.trim() ? b.timeFormat.trim() : 'HH:mm',
    periodic: cur,
    folderTemplates,
  };
}

export async function saveNotesConfig(body: unknown): Promise<NotesConfig> {
  const cfg = sanitize(body);
  const prevTpl = (await readJson(TEMPLATES)) ?? {};
  await writeJson(TEMPLATES, {
    ...prevTpl,
    folder: cfg.templateFolder,
    dateFormat: cfg.dateFormat,
    timeFormat: cfg.timeFormat,
  });
  const prevPeriodic = (await readJson(PERIODIC)) ?? {};
  const nextPeriodic: Record<string, unknown> = { ...prevPeriodic };
  for (const id of PERIODS) nextPeriodic[id] = cfg.periodic[id];
  await writeJson(PERIODIC, nextPeriodic);
  await writeJson(FOLDERS, { folders: cfg.folderTemplates });
  await writeJson(JR, {
    templateFolder: cfg.templateFolder,
    dateFormat: cfg.dateFormat,
    timeFormat: cfg.timeFormat,
    periodic: cfg.periodic,
    folderTemplates: cfg.folderTemplates,
  });
  const daily = cfg.periodic.daily;
  await writeJson(DAILY, { folder: daily.folder, format: daily.format, template: daily.template });
  return cfg;
}

function mapPath(p: string, from: string, to: string): string {
  if (!p) return p;
  if (p === from) return to;
  if (p.startsWith(`${from}/`)) return to + p.slice(from.length);
  return p;
}

/** Keep template and periodic paths pointed at a file or folder after a rename. */
export async function retargetNoteConfig(from: string, to: string): Promise<void> {
  const cleanFrom = cleanRel(from);
  const cleanTo = cleanRel(to);
  if (!cleanFrom || !cleanTo || cleanFrom === cleanTo) return;
  const cfg = await loadNotesConfig();
  const next: NotesConfig = {
    ...cfg,
    templateFolder: mapPath(cfg.templateFolder, cleanFrom, cleanTo),
    periodic: {
      daily: { ...cfg.periodic.daily },
      weekly: { ...cfg.periodic.weekly },
      monthly: { ...cfg.periodic.monthly },
      quarterly: { ...cfg.periodic.quarterly },
      yearly: { ...cfg.periodic.yearly },
    },
    folderTemplates: cfg.folderTemplates.map((r) => ({
      folder: mapPath(r.folder, cleanFrom, cleanTo),
      template: mapPath(r.template, cleanFrom, cleanTo),
    })),
  };
  for (const id of PERIODS) {
    next.periodic[id] = {
      ...next.periodic[id],
      folder: mapPath(cfg.periodic[id].folder, cleanFrom, cleanTo),
      template: mapPath(cfg.periodic[id].template, cleanFrom, cleanTo),
    };
  }
  const same = JSON.stringify(cfg) === JSON.stringify(next);
  if (!same) await saveNotesConfig(next);
}

function walkFolders(node: TreeNode, out: string[]): void {
  for (const child of node.children ?? []) {
    if (child.type !== 'folder') continue;
    out.push(child.path);
    walkFolders(child, out);
  }
}

function walkNotes(node: TreeNode | undefined, out: { path: string; title: string }[]): void {
  if (!node) return;
  for (const child of node.children ?? []) {
    if (child.type === 'folder') walkNotes(child, out);
    else if (/\.(md|markdown)$/i.test(child.name) && !child.name.startsWith('.')) {
      out.push({ path: child.path, title: child.name.replace(/\.(md|markdown)$/i, '') });
    }
  }
}

export async function notesConfigView(listFolder?: string): Promise<NotesConfig & {
  folders: string[];
  templates: { path: string; title: string }[];
}> {
  const cfg = await loadNotesConfig();
  const tree = await listTree();
  const folders: string[] = [];
  walkFolders(tree, folders);
  const templates: { path: string; title: string }[] = [];
  const which = cleanRel(listFolder || '') || cfg.templateFolder;
  const root = which ? findFolder(tree, which) : undefined;
  walkNotes(root, templates);
  templates.sort((a, b) => a.title.localeCompare(b.title));
  return { ...cfg, folders, templates };
}

function findFolder(node: TreeNode, rel: string): TreeNode | undefined {
  if (!rel) return node;
  const [head, ...rest] = rel.split('/');
  const child = (node.children ?? []).find((c) => c.type === 'folder' && c.name === head);
  if (!child) return undefined;
  return rest.length ? findFolder(child, rest.join('/')) : child;
}

