import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { api } from '../lib/api';
import type { TreeNode } from '../lib/api';
import { useStore } from '../lib/store';
import { findNode } from '../lib/tree';

const BOOK_EXT = /\.(epub|mobi|azw3?|fb2|fbz|cbz|pdf|txt|text|html?|docx|rtf)$/i;
const FOLIATE_EXT = /\.(epub|mobi|azw3?|fb2|fbz|cbz|pdf)$/i;
const SHELF = 'Library/Ebooks';
const READING = 'Reading';

const COLORS = [
  { id: 'yellow', value: '#e6c35c' },
  { id: 'green', value: '#7dcea0' },
  { id: 'blue', value: '#7eb6ff' },
  { id: 'pink', value: '#f5a3c7' },
  { id: 'orange', value: '#f0a05a' },
] as const;

type ColorId = (typeof COLORS)[number]['id'];
type BookFile = { path: string; name: string };
type Mark = { quote: string; location: string; color: ColorId; path: string; note: string };
type Bookmark = { cfi: string; label: string; at: string };
type TocItem = { label?: string; href?: string; subitems?: TocItem[] };
type Menu = {
  x: number;
  y: number;
  quote: string;
  location: string;
  color: ColorId;
  noting: boolean;
  draft: string;
  existing?: Mark;
};

type BooksPrefs = {
  fontSize: number;
  fontFamily: string;
  lineHeight: number;
  justify: boolean;
  hyphenate: boolean;
  margin: 'narrow' | 'medium' | 'wide';
  flow: 'paginated' | 'scrolled';
  ink: 'follow' | 'sepia' | 'paper';
  autoHideShelf: boolean;
  resumeLast: boolean;
  tapZones: boolean;
  progressBar: boolean;
  keepAwake: boolean;
  focusMode: boolean;
  showEta: boolean;
  wpm: number;
};

const DEFAULT_PREFS: BooksPrefs = {
  fontSize: 18,
  fontFamily: 'serif',
  lineHeight: 1.65,
  justify: true,
  hyphenate: true,
  margin: 'medium',
  flow: 'paginated',
  ink: 'follow',
  autoHideShelf: true,
  resumeLast: true,
  tapZones: true,
  progressBar: true,
  keepAwake: false,
  focusMode: true,
  showEta: true,
  wpm: 230,
};

const FONT_STACKS: Record<string, string> = {
  serif: 'Literata, "Iowan Old Style", "Palatino Linotype", Palatino, Georgia, serif',
  sans: 'Inter, "Segoe UI", system-ui, sans-serif',
  mono: '"IBM Plex Mono", "SF Mono", Menlo, Consolas, monospace',
  dyslexia: 'OpenDyslexic, "Comic Sans MS", Verdana, sans-serif',
};

type FoliateView = HTMLElement & {
  open: (file: File) => Promise<void>;
  init: (opts: { lastLocation?: string; showTextStart?: boolean }) => Promise<void>;
  goLeft: () => void;
  goRight: () => void;
  goTo: (target: string | number) => Promise<unknown>;
  goToFraction: (frac: number) => Promise<void>;
  addAnnotation: (a: { value: string }, remove?: boolean) => Promise<unknown>;
  deleteAnnotation: (a: { value: string }) => Promise<unknown>;
  getCFI: (index: number, range: Range) => string;
  book?: {
    metadata?: { title?: unknown; author?: unknown };
    toc?: TocItem[];
  };
  renderer?: {
    setStyles?: (css: string) => void;
    setAttribute?: (name: string, value: string) => void;
  };
  close?: () => void;
  lastLocation?: { fraction?: number; tocItem?: { label?: string }; cfi?: string };
};

function loadModule(url: string): Promise<Record<string, unknown>> {
  const fn = (globalThis as { __jrLoadModule?: (u: string) => Promise<Record<string, unknown>> }).__jrLoadModule;
  if (!fn) return Promise.reject(new Error('The reader is still loading. Try the book again.'));
  return fn(url);
}

function storedOn(key: string, fallback: boolean): boolean {
  try {
    const v = localStorage.getItem(key);
    if (v === '1') return true;
    if (v === '0') return false;
  } catch { /* private mode */ }
  return fallback;
}

function textOf(v: unknown): string {
  if (!v) return '';
  if (typeof v === 'string') return v;
  if (Array.isArray(v)) return textOf(v[0]);
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>;
    return textOf(o.en || o[''] || Object.values(o)[0]);
  }
  return String(v);
}

function safeName(s: string, max = 80): string {
  const t = s.replace(/[\\/:*?"<>|[\]]+/g, ' ').replace(/\s+/g, ' ').trim().replace(/^\.+|\.+$/g, '');
  return (t || 'Book').slice(0, max).trim();
}

function shelfLabel(name: string): string {
  const stem = name.replace(BOOK_EXT, '').split(/\s+--\s+/)[0] || name;
  return stem.replace(/_/g, ' ').replace(/\s+/g, ' ').trim();
}

function slug(s: string): string {
  const t = s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return t || 'book';
}

function yq(s: string): string {
  return JSON.stringify(s);
}

function colorValue(id: string): string {
  return COLORS.find((c) => c.id === id)?.value || COLORS[0].value;
}

function collectFiles(node: TreeNode | null, out: TreeNode[] = []): TreeNode[] {
  if (!node) return out;
  if (node.type === 'file') out.push(node);
  node.children?.forEach((c) => collectFiles(c, out));
  return out;
}

function shelfBooks(tree: TreeNode | null): BookFile[] {
  const out: BookFile[] = [];
  const walk = (node: TreeNode | null) => {
    if (!node) return;
    if (node.type === 'file' && BOOK_EXT.test(node.name)) out.push({ path: node.path, name: node.name });
    node.children?.forEach(walk);
  };
  walk(findNode(tree, SHELF));
  out.sort((a, b) => shelfLabel(a.name).localeCompare(shelfLabel(b.name)));
  return out;
}

function fmValue(src: string, key: string): string {
  const fence = src.match(/^---[ \t]*\r?\n([\s\S]*?)\r?\n---/);
  if (!fence) return '';
  const m = fence[1].match(new RegExp(`^${key}:[ \\t]*(.*)$`, 'm'));
  if (!m) return '';
  let v = m[1].trim();
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
    try {
      v = JSON.parse(v.startsWith("'") ? `"${v.slice(1, -1).replace(/"/g, '\\"')}"` : v);
    } catch {
      v = v.slice(1, -1);
    }
  }
  return v;
}

function firstQuote(src: string): string {
  const body = src.replace(/^---[\s\S]*?\n---\s*/, '');
  const lines: string[] = [];
  for (const line of body.split(/\r?\n/)) {
    if (line.startsWith('>')) lines.push(line.replace(/^>\s?/, ''));
    else if (lines.length) break;
  }
  return lines.join('\n').trim();
}

function noteBodyText(src: string): string {
  const body = src.replace(/^---[\s\S]*?\n---\s*/, '');
  const lines = body.split(/\r?\n/);
  let i = 0;
  while (i < lines.length && (lines[i].startsWith('>') || lines[i].trim() === '')) i++;
  while (i < lines.length && /^\[\[.+\]\]\s*$/.test(lines[i].trim())) i++;
  while (i < lines.length && lines[i].trim() === '') i++;
  return lines.slice(i).join('\n').trim();
}

function pageFromRelocate(d: { pageItem?: { label?: unknown }; location?: { current?: number; total?: number }; fraction?: number }): string {
  const label = textOf(d?.pageItem?.label);
  if (label) return label;
  const cur = d?.location?.current;
  const total = d?.location?.total;
  if (typeof cur === 'number' && typeof total === 'number' && total > 0) return `${cur + 1} / ${total}`;
  if (typeof d?.fraction === 'number') return `${Math.max(1, Math.round(d.fraction * 100))}%`;
  return '';
}

function rtfToText(src: string): string {
  return src
    .replace(/\\par[d]?/g, '\n')
    .replace(/\\'[0-9a-fA-F]{2}/g, (m) => {
      try { return decodeURIComponent('%' + m.slice(2)); } catch { return ''; }
    })
    .replace(/\\[a-z]+-?\d* ?/gi, '')
    .replace(/[{}]/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c] || c));
}

async function docxToHtml(file: File): Promise<string> {
  const zip = await loadModule('/foliate/vendor/zip.js');
  const ZipReader = zip.ZipReader as new (r: unknown) => { getEntries: () => Promise<{ filename: string; getData: (w: unknown) => Promise<string> }[]> };
  const BlobReader = zip.BlobReader as new (b: Blob) => unknown;
  const TextWriter = zip.TextWriter as new () => unknown;
  const reader = new ZipReader(new BlobReader(file));
  const entries = await reader.getEntries();
  const entry = entries.find((e) => e.filename === 'word/document.xml');
  if (!entry) return '<p>This document has no text.</p>';
  const xml = await entry.getData(new TextWriter());
  const text = xml
    .replace(/<w:p[^>]*>/g, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"');
  return text.split(/\n+/).map((p) => p.trim()).filter(Boolean).map((p) => `<p>${escapeHtml(p)}</p>`).join('');
}

function paintQuote(root: HTMLElement, quote: string, color: string) {
  const needle = quote.replace(/\s+/g, ' ').trim();
  if (needle.length < 2) return;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let node = walker.nextNode();
  while (node) {
    const text = node.textContent || '';
    let idx = text.indexOf(quote.trim());
    let len = quote.trim().length;
    if (idx < 0) {
      idx = text.indexOf(needle);
      len = needle.length;
    }
    if (idx >= 0) {
      const range = document.createRange();
      range.setStart(node, idx);
      range.setEnd(node, idx + len);
      const mark = document.createElement('mark');
      mark.dataset.book = color;
      try { range.surroundContents(mark); } catch { /* split nodes stay unpainted */ }
      return;
    }
    node = walker.nextNode();
  }
}

function nowParts() {
  const when = new Date();
  const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit' }).format(when);
  const clock = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Bangkok', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(when).replace(':', '');
  return { when, day, clock };
}

function readPrefs(): BooksPrefs {
  const pack = (window as unknown as { __jrTheme?: { books?: Partial<BooksPrefs> } }).__jrTheme?.books;
  let local: Partial<BooksPrefs> = {};
  try {
    local = JSON.parse(localStorage.getItem('jr-books-prefs') || '{}') as Partial<BooksPrefs>;
  } catch { /* ignore */ }
  const merged = { ...DEFAULT_PREFS, ...local, ...(pack || {}) };
  if (typeof merged.fontSize !== 'number') merged.fontSize = DEFAULT_PREFS.fontSize;
  if (typeof merged.lineHeight !== 'number') merged.lineHeight = DEFAULT_PREFS.lineHeight;
  if (typeof merged.wpm !== 'number') merged.wpm = DEFAULT_PREFS.wpm;
  return merged as BooksPrefs;
}

function marginCss(m: BooksPrefs['margin']): string {
  if (m === 'narrow') return '4%';
  if (m === 'wide') return '18%';
  return '10%';
}

function inkColors(ink: BooksPrefs['ink'], theme: string): { fg: string; bg: string; scheme: string } {
  if (ink === 'sepia') return { fg: '#5b4636', bg: '#f4ecd8', scheme: 'light' };
  if (ink === 'paper') return { fg: '#1a1814', bg: '#fbfaf6', scheme: 'light' };
  if (theme === 'light') return { fg: '#1a1814', bg: 'transparent', scheme: 'light' };
  return { fg: '#e8e4dc', bg: 'transparent', scheme: 'dark' };
}

function readerCss(prefs: BooksPrefs, theme: string): string {
  const stack = FONT_STACKS[prefs.fontFamily] || FONT_STACKS.serif;
  const ink = inkColors(prefs.ink, theme);
  const pad = marginCss(prefs.margin);
  return `
    @namespace epub "http://www.idpf.org/2007/ops";
    html {
      color-scheme: ${ink.scheme};
      background: ${ink.bg};
      color: ${ink.fg};
    }
    body {
      color: ${ink.fg} !important;
      background: ${ink.bg} !important;
      font-family: ${stack} !important;
      font-size: ${prefs.fontSize}px !important;
      line-height: ${prefs.lineHeight} !important;
      padding-left: ${pad} !important;
      padding-right: ${pad} !important;
    }
    p, li, blockquote, dd {
      line-height: ${prefs.lineHeight} !important;
      text-align: ${prefs.justify ? 'justify' : 'start'};
      -webkit-hyphens: ${prefs.hyphenate ? 'auto' : 'manual'};
      hyphens: ${prefs.hyphenate ? 'auto' : 'manual'};
    }
    a:link { color: ${theme === 'light' ? '#2a5db0' : '#9ec1ff'}; }
    img, svg, video { max-width: 100%; height: auto; }
    pre { white-space: pre-wrap !important; }
  `;
}

function flattenToc(items: TocItem[] | undefined, depth = 0, out: { label: string; href: string; depth: number }[] = []) {
  if (!items) return out;
  for (const it of items) {
    const label = (it.label || '').trim();
    if (label && it.href) out.push({ label, href: it.href, depth });
    if (it.subitems?.length) flattenToc(it.subitems, depth + 1, out);
  }
  return out;
}

function loadBookmarks(bookPath: string): Bookmark[] {
  try {
    const raw = JSON.parse(localStorage.getItem('jr-book-bm:' + bookPath) || '[]');
    return Array.isArray(raw) ? raw : [];
  } catch {
    return [];
  }
}

function saveBookmarks(bookPath: string, list: Bookmark[]) {
  try { localStorage.setItem('jr-book-bm:' + bookPath, JSON.stringify(list)); } catch { /* ignore */ }
}

function etaLabel(fraction: number, wpm: number): string {
  if (!(fraction >= 0) || fraction >= 0.995) return '';
  const remain = Math.max(0, 1 - fraction);
  // Rough: ~300 words per "book fraction unit" is meaningless; use remaining % of a 60k-word average.
  const wordsLeft = remain * 60000;
  const mins = Math.max(1, Math.round(wordsLeft / Math.max(80, wpm)));
  if (mins < 60) return `~${mins} min left`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m ? `~${h}h ${m}m left` : `~${h}h left`;
}

export default function Books() {
  const tree = useStore((s) => s.tree);
  const loadTree = useStore((s) => s.loadTree);
  const notify = useStore((s) => s.notify);
  const [bookPath, setBookPath] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [author, setAuthor] = useState('');
  const [pages, setPages] = useState('');
  const [fraction, setFraction] = useState(0);
  const [chapter, setChapter] = useState('');
  const [status, setStatus] = useState('');
  const [plainHtml, setPlainHtml] = useState('');
  const [marks, setMarks] = useState<Mark[]>([]);
  const [menu, setMenu] = useState<Menu | null>(null);
  const [prefs, setPrefs] = useState<BooksPrefs>(() => readPrefs());
  const [theme, setTheme] = useState(() => {
    try { return localStorage.getItem('jr-shell-theme') === 'light' ? 'light' : 'dark'; } catch { return 'dark'; }
  });
  const [panel, setPanel] = useState<'none' | 'toc' | 'marks' | 'bookmarks'>('none');
  const [bookmarks, setBookmarks] = useState<Bookmark[]>([]);
  const [toc, setToc] = useState<{ label: string; href: string; depth: number }[]>([]);
  const [focused, setFocused] = useState(false);
  const [armDelete, setArmDelete] = useState<string | null>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<FoliateView | null>(null);
  const [collapsed, setCollapsed] = useState(() => storedOn('jr-books-collapsed', false));
  const [peek, setPeek] = useState(false);
  const [holdShut, setHoldShut] = useState(false);
  const [fill, setFill] = useState(false);
  const [full, setFull] = useState(false);
  const sheetRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const folderRef = useRef('');
  const colorRef = useRef<Map<string, string>>(new Map());
  const prefsRef = useRef(prefs);
  const openMenuRef = useRef<(x: number, y: number, quote: string, location: string) => void>(() => {});
  const addBookmarkRef = useRef<() => void>(() => {});
  const wakeRef = useRef<{ release: () => Promise<void> } | null>(null);
  const idleRef = useRef(0);
  const marksLive = useRef(marks);
  colorRef.current = new Map(marks.map((m) => [m.location, colorValue(m.color)]));
  prefsRef.current = prefs;
  marksLive.current = marks;

  const books = useMemo(() => shelfBooks(tree), [tree]);
  const book = books.find((b) => b.path === bookPath) || null;
  const autoHide = prefs.autoHideShelf;
  const showLib = book && autoHide ? peek && !holdShut : !collapsed;
  const expanded = full || fill;

  useEffect(() => {
    const sync = () => {
      setPrefs(readPrefs());
      try {
        const t = localStorage.getItem('jr-shell-theme');
        if (t === 'light' || t === 'dark') setTheme(t);
      } catch { /* ignore */ }
      const pack = (window as unknown as { __jrTheme?: { theme?: string } }).__jrTheme;
      if (pack?.theme === 'light' || pack?.theme === 'dark') setTheme(pack.theme);
    };
    sync();
    const onEv = () => sync();
    const onMsg = (e: MessageEvent) => {
      if (e.data && e.data.type === 'jr-theme') sync();
    };
    window.addEventListener('jr-theme', onEv);
    window.addEventListener('message', onMsg);
    const id = window.setInterval(sync, 4000);
    return () => {
      window.removeEventListener('jr-theme', onEv);
      window.removeEventListener('message', onMsg);
      window.clearInterval(id);
    };
  }, []);

  useEffect(() => {
    try { localStorage.setItem('jr-books-collapsed', collapsed ? '1' : '0'); } catch { /* ignore */ }
  }, [collapsed]);

  useEffect(() => {
    const onChange = () => setFull(document.fullscreenElement === rootRef.current);
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  useEffect(() => {
    const view = viewRef.current;
    if (!view?.renderer) return;
    view.renderer.setStyles?.(readerCss(prefs, theme));
    view.renderer.setAttribute?.('flow', prefs.flow);
  }, [prefs, theme, bookPath]);

  useEffect(() => {
    const el = sheetRef.current;
    if (!el) return;
    const ink = inkColors(prefs.ink, theme);
    el.style.fontSize = `${prefs.fontSize}px`;
    el.style.lineHeight = String(prefs.lineHeight);
    el.style.fontFamily = FONT_STACKS[prefs.fontFamily] || FONT_STACKS.serif;
    el.style.color = ink.fg;
    el.style.background = ink.bg === 'transparent' ? '' : ink.bg;
    el.style.paddingLeft = marginCss(prefs.margin);
    el.style.paddingRight = marginCss(prefs.margin);
    el.style.textAlign = prefs.justify ? 'justify' : 'start';
  }, [prefs, theme, plainHtml]);

  useEffect(() => {
    if (!prefs.keepAwake || !book) {
      wakeRef.current?.release().catch(() => {});
      wakeRef.current = null;
      return;
    }
    const nav = navigator as Navigator & { wakeLock?: { request: (t: string) => Promise<{ release: () => Promise<void> }> } };
    nav.wakeLock?.request('screen').then((lock) => { wakeRef.current = lock; }).catch(() => {});
    return () => {
      wakeRef.current?.release().catch(() => {});
      wakeRef.current = null;
    };
  }, [prefs.keepAwake, book]);

  useEffect(() => {
    if (!prefs.focusMode || !book) {
      setFocused(false);
      return;
    }
    const bump = () => {
      setFocused(false);
      window.clearTimeout(idleRef.current);
      idleRef.current = window.setTimeout(() => setFocused(true), 2800);
    };
    bump();
    window.addEventListener('mousemove', bump);
    window.addEventListener('keydown', bump);
    return () => {
      window.removeEventListener('mousemove', bump);
      window.removeEventListener('keydown', bump);
      window.clearTimeout(idleRef.current);
    };
  }, [prefs.focusMode, book]);

  const hideLib = () => {
    if (book && autoHide) {
      setPeek(false);
      setHoldShut(true);
    } else {
      setCollapsed(true);
    }
  };
  const revealLib = () => {
    setHoldShut(false);
    if (book && autoHide) setPeek(true);
    else setCollapsed(false);
  };
  const toggleFull = () => {
    const el = rootRef.current;
    if (!el) return;
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => {});
      setFill(false);
      return;
    }
    if (fill) { setFill(false); return; }
    const req = el.requestFullscreen?.bind(el);
    if (!req) { setFill(true); return; }
    req().catch(() => setFill(true));
  };

  const applyStyles = useCallback((view: FoliateView) => {
    const p = prefsRef.current;
    const t = (() => {
      try { return localStorage.getItem('jr-shell-theme') === 'light' ? 'light' : 'dark'; } catch { return 'dark'; }
    })();
    view.renderer?.setStyles?.(readerCss(p, t));
    view.renderer?.setAttribute?.('flow', p.flow);
  }, []);

  const loadMarks = useCallback(async (folderName: string) => {
    if (!folderName) { setMarks([]); return; }
    const folder = findNode(useStore.getState().tree, `${READING}/${folderName}`);
    const files = collectFiles(folder).filter((f) => /\.md$/i.test(f.path));
    const next: Mark[] = [];
    for (const f of files) {
      try {
        const r = await api.read(f.path);
        const content = typeof r === 'string' ? r : r.content;
        const kind = fmValue(content, 'type');
        if (kind === 'book') continue;
        const isHighlight = kind === 'highlight' || kind === 'book-note' || /\/Highlight\.md$/i.test(f.path) || firstQuote(content);
        if (!isHighlight) continue;
        const color = fmValue(content, 'color');
        next.push({
          quote: firstQuote(content),
          location: fmValue(content, 'location'),
          color: (COLORS.some((c) => c.id === color) ? color : 'yellow') as ColorId,
          path: f.path,
          note: noteBodyText(content),
        });
      } catch { /* skip a note that moved */ }
    }
    setMarks(next);
  }, []);

  const openMenu = (x: number, y: number, quote: string, location: string) => {
    const text = quote.trim();
    if (text.length < 2 && !location) return;
    const known = marks.find((m) => (m.location && location && m.location === location)
      || (m.quote && text && m.quote.replace(/\s+/g, ' ') === text.replace(/\s+/g, ' ')));
    setMenu({
      x: Math.max(8, Math.min(x, window.innerWidth - 300)),
      y: Math.max(8, Math.min(y + 10, window.innerHeight - 260)),
      quote: text || known?.quote || '',
      location: location || known?.location || '',
      color: known?.color || 'yellow',
      noting: Boolean(known?.note),
      draft: known?.note || '',
      existing: known,
    });
  };
  openMenuRef.current = openMenu;

  useEffect(() => {
    const host = hostRef.current;
    if (!book) {
      setTitle('');
      setAuthor('');
      setPlainHtml('');
      setPages('');
      setFraction(0);
      setChapter('');
      setMarks([]);
      setToc([]);
      setBookmarks([]);
      folderRef.current = '';
      setPanel('none');
      return;
    }
    let dead = false;
    const stem = shelfLabel(book.name);
    setTitle(stem);
    setAuthor('');
    setPlainHtml('');
    setPages('');
    setMenu(null);
    setStatus('');
    setBookmarks(loadBookmarks(book.path));
    folderRef.current = safeName(stem, 120);
    viewRef.current?.close?.();
    viewRef.current = null;
    if (host) host.replaceChildren();

    (async () => {
      let file: File;
      if (/\.(txt|text)$/i.test(book.name)) {
        const r = await api.read(book.path);
        const content = typeof r === 'string' ? r : r.content;
        file = new File([content], book.name);
      } else {
        const res = await fetch(api.rawUrl(book.path), { credentials: 'include' });
        if (!res.ok) throw new Error('Could not read the file');
        file = new File([await res.blob()], book.name);
      }
      if (dead) return;
      if (!FOLIATE_EXT.test(book.name)) {
        let html = '';
        if (/\.docx$/i.test(book.name)) html = await docxToHtml(file);
        else if (/\.html?$/i.test(book.name)) html = (await file.text()).replace(/<script[\s\S]*?<\/script>/gi, '');
        else if (/\.rtf$/i.test(book.name)) html = `<pre>${escapeHtml(rtfToText(await file.text()))}</pre>`;
        else html = `<pre>${escapeHtml(await file.text())}</pre>`;
        if (dead) return;
        setPlainHtml(html);
        await loadMarks(folderRef.current);
        try {
          const saved = Number(localStorage.getItem('jr-book-scroll:' + book.path) || '0');
          requestAnimationFrame(() => {
            if (sheetRef.current && prefsRef.current.resumeLast) sheetRef.current.scrollTop = saved;
          });
        } catch { /* ignore */ }
        return;
      }
      await loadModule('/foliate/view.js');
      const over = await loadModule('/foliate/overlayer.js');
      const Highlight = (over.Overlayer as { highlight: unknown }).highlight;
      if (dead || !host) return;
      const view = document.createElement('foliate-view') as FoliateView;
      viewRef.current = view;
      host.append(view);
      view.addEventListener('relocate', (ev) => {
        const detail = (ev as CustomEvent).detail || {};
        setPages(pageFromRelocate(detail));
        if (typeof detail.fraction === 'number') setFraction(detail.fraction);
        const ch = detail.tocItem?.label;
        if (ch) setChapter(String(ch));
        const cfi = detail.cfi as string | undefined;
        if (cfi) {
          try { localStorage.setItem('jr-book:' + book.path, cfi); } catch { /* ignore */ }
        }
      });
      view.addEventListener('load', (ev) => {
        const doc = (ev as CustomEvent).detail?.doc as Document | undefined;
        const index = (ev as CustomEvent).detail?.index as number;
        if (!doc) return;
        doc.addEventListener('mouseup', (e) => {
          const sel = doc.getSelection();
          const quote = sel?.toString() || '';
          if (!sel || !sel.rangeCount || quote.trim().length < 2) return;
          let location = '';
          try { location = view.getCFI(index, sel.getRangeAt(0)); } catch { location = ''; }
          const frame = doc.defaultView?.frameElement as HTMLElement | null;
          const box = frame?.getBoundingClientRect();
          const me = e as MouseEvent;
          openMenuRef.current((box?.left || 0) + me.clientX, (box?.top || 0) + me.clientY, quote, location);
        });
        doc.addEventListener('click', (e) => {
          const t = e.target as HTMLElement | null;
          if (t?.closest?.('a[href]')) return;
          const sel = doc.getSelection();
          if (sel && sel.toString().trim().length >= 2) return;
          if (!prefsRef.current.tapZones) return;
          const w = doc.documentElement.clientWidth || 1;
          const x = (e as MouseEvent).clientX;
          if (x < w * 0.14) view.goLeft();
          else if (x > w * 0.86) view.goRight();
        });
        doc.addEventListener('keydown', (e) => {
          if (e.key === 'ArrowLeft') { e.preventDefault(); view.goLeft(); }
          else if (e.key === 'ArrowRight') { e.preventDefault(); view.goRight(); }
        });
      });
      view.addEventListener('draw-annotation', (ev) => {
        const detail = (ev as CustomEvent).detail || {};
        const value = detail.annotation?.value as string;
        const draw = detail.draw as ((fn: unknown, opts: { color: string }) => void) | undefined;
        draw?.(Highlight, { color: colorRef.current.get(value) || COLORS[0].value });
      });
      view.addEventListener('show-annotation', (ev) => {
        const value = (ev as CustomEvent).detail?.value as string;
        const hit = marksLive.current.find((m) => m.location === value);
        openMenuRef.current(window.innerWidth / 2 - 120, 80, hit?.quote || '', value);
      });
      await view.open(file);
      if (dead) { view.close?.(); return; }
      const metaTitle = textOf(view.book?.metadata?.title) || stem;
      const metaAuthor = textOf(view.book?.metadata?.author);
      folderRef.current = safeName(metaTitle, 120);
      setTitle(metaTitle);
      setAuthor(metaAuthor);
      setToc(flattenToc(view.book?.toc));
      applyStyles(view);
      const saved = prefsRef.current.resumeLast
        ? (() => { try { return localStorage.getItem('jr-book:' + book.path) || ''; } catch { return ''; } })()
        : '';
      try {
        await view.init({ lastLocation: saved || undefined, showTextStart: !saved });
      } catch { /* the first page is already up */ }
      applyStyles(view);
      await loadMarks(folderRef.current);
    })().catch((e: Error) => {
      if (!dead) setStatus(e?.message || 'Could not open this book');
    });
    return () => {
      dead = true;
      viewRef.current?.close?.();
      viewRef.current = null;
    };
    // bookPath only: a saved highlight reloads the tree and must not reopen the file.
  }, [bookPath, loadMarks, applyStyles]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    for (const m of marks) {
      if (m.location && !m.location.startsWith('quote:')) view.addAnnotation({ value: m.location }).catch(() => {});
    }
  }, [marks]);

  useEffect(() => {
    const root = sheetRef.current;
    if (!root) return;
    root.querySelectorAll('mark[data-book]').forEach((el) => {
      const parent = el.parentNode;
      if (!parent) return;
      parent.replaceChild(document.createTextNode(el.textContent || ''), el);
      parent.normalize();
    });
    for (const m of marks) if (m.quote) paintQuote(root, m.quote, m.color);
  }, [marks, plainHtml]);

  useEffect(() => {
    const onUp = (e: MouseEvent) => {
      const root = sheetRef.current;
      if (!root || !root.contains(e.target as Node)) return;
      const sel = document.getSelection();
      const quote = sel?.toString() || '';
      if (quote.trim().length < 2) return;
      openMenuRef.current(e.clientX, e.clientY, quote, 'quote:' + quote.trim().slice(0, 240));
    };
    const onDown = (e: MouseEvent) => {
      if (menuRef.current?.contains(e.target as Node)) return;
      const t = e.target as HTMLElement | null;
      if (t?.closest?.('.books-flyout, .books-tool, .books-lib')) return;
      setMenu(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setMenu(null);
        setPanel('none');
        if (!document.fullscreenElement) setFill(false);
        return;
      }
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      if (e.key === 'ArrowLeft') viewRef.current?.goLeft();
      else if (e.key === 'ArrowRight') viewRef.current?.goRight();
      else if (e.key === 'b' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        void addBookmarkRef.current();
      }
      else if (e.key === 't' && (e.metaKey || e.ctrlKey) && e.shiftKey) {
        e.preventDefault();
        setPanel((p) => (p === 'toc' ? 'none' : 'toc'));
      }
    };
    document.addEventListener('mouseup', onUp);
    document.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mouseup', onUp);
      document.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, []);

  const onSheetScroll = () => {
    const el = sheetRef.current;
    if (!el || !book) return;
    const pagesN = Math.max(1, Math.ceil(el.scrollHeight / Math.max(1, el.clientHeight)));
    const page = Math.min(pagesN, Math.floor(el.scrollTop / Math.max(1, el.clientHeight)) + 1);
    setPages(`${page} / ${pagesN}`);
    setFraction(el.scrollTop / Math.max(1, el.scrollHeight - el.clientHeight));
    try { localStorage.setItem('jr-book-scroll:' + book.path, String(el.scrollTop)); } catch { /* ignore */ }
  };

  const ensureBookHub = async (bookTitle: string, bookAuthor: string, sourcePath: string) => {
    const hubPath = `${READING}/${safeName(bookTitle, 120)}.md`;
    try {
      await api.read(hubPath);
      return hubPath;
    } catch {
      const { when, day } = nowParts();
      const body = [
        '---',
        'tags:',
        '  - book',
        `  - book/${slug(bookTitle)}`,
        `type: book`,
        `book: ${yq(bookTitle)}`,
        bookAuthor ? `author: ${yq(bookAuthor)}` : null,
        `created: ${when.toISOString()}`,
        `date: ${day}`,
        `source: ${yq(sourcePath)}`,
        '---',
        '',
        `# ${bookTitle}`,
        '',
        bookAuthor ? `By ${bookAuthor}` : null,
        '',
        'Highlights and notes from this book link here for the graph.',
        '',
      ].filter((l) => l !== null).join('\n');
      await api.createFolder(READING).catch(() => {});
      await api.write(hubPath, body);
      return hubPath;
    }
  };

  const uniqueHighlightPath = (bookFolder: string, quote: string) => {
    const head = safeName(quote.replace(/\s+/g, ' ').slice(0, 72), 72) || 'Passage';
    const taken = new Set(
      (findNode(useStore.getState().tree, bookFolder)?.children || [])
        .filter((c) => c.type === 'file')
        .map((c) => c.name.toLowerCase()),
    );
    let name = `${head}.md`;
    for (let i = 2; taken.has(name.toLowerCase()); i++) name = `${safeName(`${head} ${i}`, 72)}.md`;
    return `${bookFolder}/${name}`;
  };

  const writePassage = async (color: ColorId, note: string) => {
    if (!menu || !book) return;
    const bookTitle = title || shelfLabel(book.name);
    const bookFolderName = folderRef.current || safeName(bookTitle, 120);
    const bookDir = `${READING}/${bookFolderName}`;
    const { when, day } = nowParts();
    const quote = menu.quote;
    let path = menu.existing?.path || '';
    // Migrate away from old per-passage folders named Highlight.md
    if (path && /\/Highlight\.md$/i.test(path)) path = '';
    if (!path) {
      await api.createFolder(READING).catch(() => {});
      await api.createFolder(bookDir).catch(() => {});
      path = uniqueHighlightPath(bookDir, quote);
    }
    const thought = note.trim();
    const body = [
      '---',
      'tags:',
      '  - book',
      `  - book/${slug(bookTitle)}`,
      `book: ${yq(bookTitle)}`,
      author ? `author: ${yq(author)}` : null,
      `type: ${thought ? 'book-note' : 'highlight'}`,
      `color: ${color}`,
      `created: ${when.toISOString()}`,
      `date: ${day}`,
      `source: ${yq(book.path)}`,
      menu.location ? `location: ${yq(menu.location)}` : null,
      '---',
      '',
      quote.split(/\r?\n/).map((l) => `> ${l}`).join('\n'),
      '',
      `[[${bookTitle}]]`,
      '',
      thought,
      '',
    ].filter((l) => l !== null).join('\n');
    try {
      await ensureBookHub(bookTitle, author, book.path);
      await api.write(path, body);
      // Clean old Highlight.md + Note.md folder layout if we replaced it
      if (menu.existing?.path && /\/Highlight\.md$/i.test(menu.existing.path)) {
        const oldDir = menu.existing.path.replace(/\/Highlight\.md$/i, '');
        try { await api.remove(`${oldDir}/Note.md`); } catch { /* ignore */ }
        try { await api.remove(menu.existing.path); } catch { /* ignore */ }
        try { await api.remove(oldDir); } catch { /* ignore */ }
      }
      await loadTree();
      await loadMarks(bookFolderName);
      if (menu.location && !menu.location.startsWith('quote:') && viewRef.current) {
        viewRef.current.addAnnotation({ value: menu.location }).catch(() => {});
      }
      setMenu(null);
    } catch (e) {
      notify(e instanceof Error ? e.message : 'Could not save');
    }
  };

  const removePassage = async () => {
    if (!menu?.existing || !book) return;
    const mark = menu.existing;
    try {
      if (/\/Highlight\.md$/i.test(mark.path)) {
        const dir = mark.path.replace(/\/Highlight\.md$/i, '');
        try { await api.remove(`${dir}/Note.md`); } catch { /* ignore */ }
        await api.remove(mark.path);
        try { await api.remove(dir); } catch { /* ignore */ }
      } else {
        await api.remove(mark.path);
      }
      if (mark.location && !mark.location.startsWith('quote:') && viewRef.current) {
        await viewRef.current.deleteAnnotation({ value: mark.location }).catch(() => {});
      }
      await loadTree();
      await loadMarks(folderRef.current);
      setMenu(null);
    } catch (e) {
      notify(e instanceof Error ? e.message : 'Could not remove');
    }
  };

  const addBookmark = async () => {
    if (!book) return;
    const view = viewRef.current;
    const cfi = view?.lastLocation?.cfi
      || (() => { try { return localStorage.getItem('jr-book:' + book.path) || ''; } catch { return ''; } })();
    if (!cfi && !plainHtml) {
      notify('Open a page first');
      return;
    }
    const label = chapter || pages || 'Bookmark';
    const next = [{ cfi: cfi || `scroll:${sheetRef.current?.scrollTop || 0}`, label, at: new Date().toISOString() }, ...bookmarks]
      .filter((b, i, arr) => arr.findIndex((x) => x.cfi === b.cfi) === i)
      .slice(0, 40);
    setBookmarks(next);
    saveBookmarks(book.path, next);
    notify('Bookmark saved');
  };
  addBookmarkRef.current = () => { void addBookmark(); };

  const goBookmark = (bm: Bookmark) => {
    if (bm.cfi.startsWith('scroll:')) {
      const top = Number(bm.cfi.slice(7));
      if (sheetRef.current) sheetRef.current.scrollTop = top;
      return;
    }
    viewRef.current?.goTo(bm.cfi).catch(() => notify('Could not open that bookmark'));
  };

  const removeBookmark = (cfi: string) => {
    if (!book) return;
    const next = bookmarks.filter((b) => b.cfi !== cfi);
    setBookmarks(next);
    saveBookmarks(book.path, next);
  };

  const deleteBook = async (path: string) => {
    if (armDelete !== path) {
      setArmDelete(path);
      window.setTimeout(() => setArmDelete((cur) => (cur === path ? null : cur)), 2500);
      return;
    }
    setArmDelete(null);
    try {
      await api.remove(path);
      try {
        localStorage.removeItem('jr-book:' + path);
        localStorage.removeItem('jr-book-scroll:' + path);
        localStorage.removeItem('jr-book-bm:' + path);
      } catch { /* ignore */ }
      if (bookPath === path) setBookPath(null);
      await loadTree();
      notify('Book removed');
    } catch (e) {
      notify(e instanceof Error ? e.message : 'Could not delete');
    }
  };

  const onUpload = async (list: FileList | null) => {
    const file = list?.[0];
    if (!file) return;
    if (!BOOK_EXT.test(file.name)) {
      notify('Use EPUB, PDF, Kindle, FB2, a comic, Word, or text');
      return;
    }
    setStatus('Adding…');
    try {
      await api.createFolder('Library').catch(() => {});
      await api.createFolder(SHELF).catch(() => {});
      const up = await api.upload(file, SHELF);
      await loadTree();
      setBookPath(up.path);
      setStatus('');
    } catch (e) {
      setStatus('');
      notify(e instanceof Error ? e.message : 'Upload failed');
    }
  };

  const progressPct = Math.max(0, Math.min(100, Math.round(fraction * 100)));
  const eta = prefs.showEta ? etaLabel(fraction, prefs.wpm) : '';

  return (
    <div
      ref={rootRef}
      className={[
        'books',
        !showLib ? 'lib-shut' : '',
        fill ? 'books-fill' : '',
        focused ? 'books-focused' : '',
      ].filter(Boolean).join(' ')}
    >
      {prefs.progressBar && book && (
        <div className="books-progress" aria-hidden="true">
          <i style={{ width: `${progressPct}%` }} />
        </div>
      )}
      <div
        className="books-lib-wrap"
        onMouseEnter={() => { if (autoHide) setPeek(true); }}
        onMouseLeave={() => { setPeek(false); setHoldShut(false); }}
      >
      <aside className="books-lib">
        <div className="books-lib-head">
          <span>Books</span>
          <div className="books-lib-tools">
            <button
              type="button"
              className={autoHide ? 'books-tool on' : 'books-tool'}
              title={autoHide ? 'List opens when the pointer is at the left edge' : 'Hide the list until the pointer is at the left edge'}
              aria-pressed={autoHide}
              onClick={() => {
                const next = { ...prefs, autoHideShelf: !prefs.autoHideShelf };
                setPrefs(next);
                try { localStorage.setItem('jr-books-prefs', JSON.stringify(next)); } catch { /* ignore */ }
              }}
            >
              <IconHover />
            </button>
            <button type="button" className="books-tool" title="Hide book list" aria-label="Hide book list" onClick={hideLib}>
              <IconHide />
            </button>
            <label className="books-add" title="Add a book">
              <IconPlus />
              <input
                type="file"
                accept=".epub,.mobi,.azw,.azw3,.fb2,.fbz,.cbz,.pdf,.txt,.html,.htm,.docx,.rtf"
                onChange={(e) => onUpload(e.target.files)}
              />
            </label>
          </div>
        </div>
        <div
          className="books-lib-list"
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => { e.preventDefault(); onUpload(e.dataTransfer.files); }}
        >
          {books.length === 0 && <p className="books-empty">Add a book.</p>}
          {books.map((b) => (
            <div key={b.path} className={b.path === bookPath ? 'books-lib-row on' : 'books-lib-row'}>
              <button
                type="button"
                className="books-lib-open"
                title={shelfLabel(b.name)}
                onClick={() => setBookPath(b.path)}
              >
                {shelfLabel(b.name)}
              </button>
              <button
                type="button"
                className={armDelete === b.path ? 'books-lib-del arm' : 'books-lib-del'}
                title={armDelete === b.path ? 'Click again to delete' : 'Delete book'}
                aria-label="Delete book"
                onClick={(e) => { e.stopPropagation(); void deleteBook(b.path); }}
              >
                {armDelete === b.path ? '!' : '×'}
              </button>
            </div>
          ))}
        </div>
      </aside>
      {!showLib && (
        <button type="button" className="books-rail" title="Show book list" aria-label="Show book list" onClick={revealLib}>
          <IconShow />
        </button>
      )}
      </div>
      <div className="books-stage">
        {book && (
          <div className="books-chrome">
            <button type="button" className={panel === 'toc' ? 'books-tool on' : 'books-tool'} title="Chapters" onClick={() => setPanel((p) => (p === 'toc' ? 'none' : 'toc'))}>
              <IconToc />
            </button>
            <button type="button" className={panel === 'bookmarks' ? 'books-tool on' : 'books-tool'} title="Bookmarks" onClick={() => setPanel((p) => (p === 'bookmarks' ? 'none' : 'bookmarks'))}>
              <IconBookmark />
            </button>
            <button type="button" className="books-tool" title="Add bookmark (Ctrl+B)" onClick={() => void addBookmark()}>
              <IconBookmarkAdd />
            </button>
            <button type="button" className={panel === 'marks' ? 'books-tool on' : 'books-tool'} title="Highlights" onClick={() => setPanel((p) => (p === 'marks' ? 'none' : 'marks'))}>
              <IconMarks />
            </button>
            <button
              type="button"
              className="books-full"
              title={expanded ? 'Leave full screen' : 'Full screen'}
              aria-label={expanded ? 'Leave full screen' : 'Full screen'}
              onClick={toggleFull}
            >
              {expanded ? <IconExitFull /> : <IconFull />}
            </button>
          </div>
        )}
        {!book && !status && <div className="books-empty big">Choose a book. Select a passage to highlight it, or to leave a note.</div>}
        {status && <div className="books-status">{status}</div>}
        <div ref={hostRef} className="books-foliate" hidden={!book || !!plainHtml} />
        {plainHtml && (
          <div
            className="books-sheet"
            ref={sheetRef}
            onScroll={onSheetScroll}
            dangerouslySetInnerHTML={{ __html: plainHtml }}
          />
        )}
        {book && (
          <footer className="books-foot">
            <span className="books-foot-title">{title}{chapter ? ` · ${chapter}` : ''}</span>
            <span className="books-foot-pages">
              {eta && <em className="books-eta">{eta}</em>}
              {pages}
            </span>
          </footer>
        )}
        {panel !== 'none' && book && (
          <div className="books-flyout">
            <div className="books-flyout-head">
              <span>{panel === 'toc' ? 'Chapters' : panel === 'bookmarks' ? 'Bookmarks' : 'Highlights'}</span>
              <button type="button" className="books-tool" onClick={() => setPanel('none')} aria-label="Close">×</button>
            </div>
            <div className="books-flyout-body">
              {panel === 'toc' && (
                toc.length === 0
                  ? <p className="books-empty">No chapter list in this file.</p>
                  : toc.map((item) => (
                    <button
                      key={item.href + item.label}
                      type="button"
                      className="books-fly-item"
                      style={{ paddingLeft: 8 + item.depth * 12 }}
                      onClick={() => {
                        viewRef.current?.goTo(item.href).catch(() => notify('Could not open that chapter'));
                        setPanel('none');
                      }}
                    >
                      {item.label}
                    </button>
                  ))
              )}
              {panel === 'bookmarks' && (
                bookmarks.length === 0
                  ? <p className="books-empty">No bookmarks yet.</p>
                  : bookmarks.map((bm) => (
                    <div key={bm.cfi} className="books-fly-row">
                      <button type="button" className="books-fly-item" onClick={() => { goBookmark(bm); setPanel('none'); }}>
                        {bm.label}
                      </button>
                      <button type="button" className="books-lib-del" title="Remove" onClick={() => removeBookmark(bm.cfi)}>×</button>
                    </div>
                  ))
              )}
              {panel === 'marks' && (
                marks.length === 0
                  ? <p className="books-empty">No highlights yet.</p>
                  : marks.map((m) => (
                    <button
                      key={m.path}
                      type="button"
                      className="books-fly-item"
                      title={m.quote}
                      onClick={() => {
                        if (m.location && !m.location.startsWith('quote:')) {
                          viewRef.current?.goTo(m.location).catch(() => {});
                        }
                        openMenu(window.innerWidth / 2 - 120, 100, m.quote, m.location);
                      }}
                    >
                      <i style={{ background: colorValue(m.color) }} />
                      {m.quote.slice(0, 90) || 'Highlight'}
                    </button>
                  ))
              )}
            </div>
          </div>
        )}
      </div>
      {menu && (
        <div
          ref={menuRef}
          className={menu.noting ? 'book-menu noting' : 'book-menu'}
          style={{ left: menu.x, top: menu.y }}
          onMouseDown={(e) => e.preventDefault()}
        >
          <div className="book-swatches">
            {COLORS.map((c) => (
              <button
                key={c.id}
                type="button"
                className={menu.color === c.id ? 'on' : ''}
                style={{ background: c.value }}
                aria-label={c.id}
                onClick={() => {
                  setMenu({ ...menu, color: c.id });
                  if (!menu.noting) void writePassage(c.id, menu.draft);
                }}
              />
            ))}
          </div>
          {!menu.noting && (
            <>
              <button type="button" className="book-menu-note" onClick={() => setMenu({ ...menu, noting: true })}>
                {menu.existing?.note ? 'Edit note' : 'Add note'}
              </button>
              {menu.existing && (
                <button type="button" className="book-menu-note danger" onClick={() => void removePassage()}>
                  Remove
                </button>
              )}
            </>
          )}
          {menu.noting && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void writePassage(menu.color, menu.draft);
              }}
            >
              <textarea
                value={menu.draft}
                onChange={(e) => setMenu({ ...menu, draft: e.target.value })}
                placeholder="Note"
                autoFocus
                onMouseDown={(e) => e.stopPropagation()}
              />
              <div className="book-menu-row">
                {menu.existing && (
                  <button type="button" className="danger" onClick={() => void removePassage()}>Remove</button>
                )}
                <button type="button" onClick={() => setMenu(null)}>Cancel</button>
                <button type="submit">Save</button>
              </div>
            </form>
          )}
        </div>
      )}
    </div>
  );
}

function IconPlus() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

function ToolIcon({ children }: { children: ReactNode }) {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {children}
    </svg>
  );
}

function IconHide() {
  return (
    <ToolIcon>
      <rect width="18" height="18" x="3" y="3" rx="2" />
      <path d="M9 3v18" />
      <path d="m16 15-3-3 3-3" />
    </ToolIcon>
  );
}

function IconShow() {
  return (
    <ToolIcon>
      <path d="m9 18 6-6-6-6" />
    </ToolIcon>
  );
}

function IconHover() {
  return (
    <ToolIcon>
      <path d="M3 3h7v18H3z" />
      <path d="M14 8l5 4-5 4" />
    </ToolIcon>
  );
}

function IconFull() {
  return (
    <ToolIcon>
      <path d="M15 3h6v6" />
      <path d="M9 21H3v-6" />
      <path d="M21 3l-7 7" />
      <path d="M3 21l7-7" />
    </ToolIcon>
  );
}

function IconExitFull() {
  return (
    <ToolIcon>
      <path d="M9 3H3v6" />
      <path d="M15 21h6v-6" />
      <path d="M3 3l7 7" />
      <path d="M21 21l-7-7" />
    </ToolIcon>
  );
}

function IconToc() {
  return (
    <ToolIcon>
      <path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" />
    </ToolIcon>
  );
}

function IconBookmark() {
  return (
    <ToolIcon>
      <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
    </ToolIcon>
  );
}

function IconBookmarkAdd() {
  return (
    <ToolIcon>
      <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
      <path d="M12 7v6M9 10h6" />
    </ToolIcon>
  );
}

function IconMarks() {
  return (
    <ToolIcon>
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
    </ToolIcon>
  );
}
