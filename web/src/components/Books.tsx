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
type Mark = { quote: string; location: string; color: ColorId; dir: string };
type Menu = {
  x: number;
  y: number;
  quote: string;
  location: string;
  color: ColorId;
  noting: boolean;
  draft: string;
};

type FoliateView = HTMLElement & {
  open: (file: File) => Promise<void>;
  init: (opts: { lastLocation?: string; showTextStart?: boolean }) => Promise<void>;
  goLeft: () => void;
  goRight: () => void;
  addAnnotation: (a: { value: string }) => Promise<unknown>;
  getCFI: (index: number, range: Range) => string;
  book?: { metadata?: { title?: unknown; author?: unknown } };
  renderer?: { setStyles?: (css: string) => void };
  close?: () => void;
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

export default function Books() {
  const tree = useStore((s) => s.tree);
  const loadTree = useStore((s) => s.loadTree);
  const notify = useStore((s) => s.notify);
  const [bookPath, setBookPath] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [author, setAuthor] = useState('');
  const [pages, setPages] = useState('');
  const [status, setStatus] = useState('');
  const [plainHtml, setPlainHtml] = useState('');
  const [marks, setMarks] = useState<Mark[]>([]);
  const [menu, setMenu] = useState<Menu | null>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<FoliateView | null>(null);
  const [collapsed, setCollapsed] = useState(() => storedOn('jr-books-collapsed', false));
  const [autoHide, setAutoHide] = useState(() => storedOn('jr-books-autohide', true));
  const [peek, setPeek] = useState(false);
  const [holdShut, setHoldShut] = useState(false);
  const [fill, setFill] = useState(false);
  const [full, setFull] = useState(false);
  const sheetRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const folderRef = useRef('');
  const colorRef = useRef<Map<string, string>>(new Map());
  const openMenuRef = useRef<(x: number, y: number, quote: string, location: string) => void>(() => {});
  colorRef.current = new Map(marks.map((m) => [m.location, colorValue(m.color)]));

  const books = useMemo(() => shelfBooks(tree), [tree]);
  const book = books.find((b) => b.path === bookPath) || null;
  const showLib = book && autoHide ? peek && !holdShut : !collapsed;
  const expanded = full || fill;

  useEffect(() => {
    try { localStorage.setItem('jr-books-collapsed', collapsed ? '1' : '0'); } catch { /* ignore */ }
  }, [collapsed]);
  useEffect(() => {
    try { localStorage.setItem('jr-books-autohide', autoHide ? '1' : '0'); } catch { /* ignore */ }
  }, [autoHide]);
  useEffect(() => {
    const onChange = () => setFull(document.fullscreenElement === rootRef.current);
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

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

  const loadMarks = useCallback(async (folderName: string) => {
    if (!folderName) { setMarks([]); return; }
    const node = findNode(useStore.getState().tree, `${READING}/${folderName}`);
    const files = collectFiles(node).filter((f) => /\/Highlight\.md$/i.test(f.path));
    const next: Mark[] = [];
    for (const f of files) {
      try {
        const r = await api.read(f.path);
        const content = typeof r === 'string' ? r : r.content;
        const color = fmValue(content, 'color');
        next.push({
          quote: firstQuote(content),
          location: fmValue(content, 'location'),
          color: (COLORS.some((c) => c.id === color) ? color : 'yellow') as ColorId,
          dir: f.path.replace(/\/Highlight\.md$/i, ''),
        });
      } catch { /* skip a note that moved */ }
    }
    setMarks(next);
  }, []);

  const openMenu = (x: number, y: number, quote: string, location: string) => {
    const text = quote.trim();
    if (text.length < 2) return;
    const known = marks.find((m) => m.location && m.location === location);
    setMenu({
      x: Math.max(8, Math.min(x, window.innerWidth - 300)),
      y: Math.max(8, Math.min(y + 10, window.innerHeight - 220)),
      quote: text,
      location,
      color: known?.color || 'yellow',
      noting: false,
      draft: '',
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
      setMarks([]);
      folderRef.current = '';
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
        setPages(pageFromRelocate((ev as CustomEvent).detail || {}));
        const cfi = (ev as CustomEvent).detail?.cfi as string | undefined;
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
      await view.open(file);
      if (dead) { view.close?.(); return; }
      const metaTitle = textOf(view.book?.metadata?.title) || stem;
      const metaAuthor = textOf(view.book?.metadata?.author);
      folderRef.current = safeName(metaTitle, 120);
      setTitle(metaTitle);
      setAuthor(metaAuthor);
      const saved = (() => { try { return localStorage.getItem('jr-book:' + book.path) || ''; } catch { return ''; } })();
      try {
        await view.init({ lastLocation: saved || undefined, showTextStart: !saved });
      } catch { /* the first page is already up */ }
      view.renderer?.setStyles?.('img,svg,video{max-width:100%;height:auto} p{line-height:1.65}');
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
  }, [bookPath, loadMarks]);

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
      setMenu(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setMenu(null);
        if (!document.fullscreenElement) setFill(false);
        return;
      }
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      if (e.key === 'ArrowLeft') viewRef.current?.goLeft();
      else if (e.key === 'ArrowRight') viewRef.current?.goRight();
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
    if (!el) return;
    const pagesN = Math.max(1, Math.ceil(el.scrollHeight / Math.max(1, el.clientHeight)));
    const page = Math.min(pagesN, Math.floor(el.scrollTop / Math.max(1, el.clientHeight)) + 1);
    setPages(`${page} / ${pagesN}`);
  };

  const writePassage = async (color: ColorId, note: string) => {
    if (!menu || !book) return;
    const bookTitle = title || shelfLabel(book.name);
    const bookFolder = folderRef.current || safeName(bookTitle, 120);
    const bookDir = `${READING}/${bookFolder}`;
    const { when, day, clock } = nowParts();
    const quote = menu.quote;
    const existing = marks.find((m) => m.location && m.location === menu.location);
    let dir = existing?.dir || '';
    if (!dir) {
      const head = safeName(quote.replace(/\s+/g, ' ').slice(0, 42), 42);
      let base = safeName(`${day} ${clock} ${head}`, 90);
      const taken = new Set((findNode(tree, bookDir)?.children || []).map((c) => c.name.toLowerCase()));
      for (let i = 2; taken.has(base.toLowerCase()); i++) base = safeName(`${day} ${clock} ${head} ${i}`, 90);
      dir = `${bookDir}/${base}`;
    }
    const body = (kind: 'highlight' | 'book-note', thought: string) => [
      '---',
      'tags:',
      '  - book',
      `  - book/${slug(bookTitle)}`,
      `book: ${yq(bookTitle)}`,
      author ? `author: ${yq(author)}` : null,
      `type: ${kind}`,
      `color: ${color}`,
      `created: ${when.toISOString()}`,
      `date: ${day}`,
      `source: ${yq(book.path)}`,
      menu.location ? `location: ${yq(menu.location)}` : null,
      '---',
      '',
      quote.split(/\r?\n/).map((l) => `> ${l}`).join('\n'),
      '',
      thought.trim(),
      '',
    ].filter((l) => l !== null).join('\n');
    const highlightBody = body('highlight', '');
    const noteBody = body('book-note', note);
    try {
      await api.createFolder(dir);
      await api.write(`${dir}/Highlight.md`, highlightBody);
      if (note.trim()) {
        let prev = '';
        try {
          const cur = await api.read(`${dir}/Note.md`);
          prev = typeof cur === 'string' ? cur : cur.content;
        } catch { prev = ''; }
        await api.write(`${dir}/Note.md`, prev ? prev.replace(/\s*$/, '') + `\n\n${note.trim()}\n` : noteBody);
      }
      await loadTree();
      await loadMarks(bookFolder);
      if (menu.location && !menu.location.startsWith('quote:') && viewRef.current) {
        viewRef.current.addAnnotation({ value: menu.location }).catch(() => {});
      }
      setMenu(null);
    } catch (e) {
      notify(e instanceof Error ? e.message : 'Could not save');
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

  return (
    <div ref={rootRef} className={showLib ? (fill ? 'books books-fill' : 'books') : (fill ? 'books lib-shut books-fill' : 'books lib-shut')}>
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
              onClick={() => setAutoHide((v) => !v)}
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
            <button
              key={b.path}
              type="button"
              className={b.path === bookPath ? 'on' : ''}
              title={shelfLabel(b.name)}
              onClick={() => setBookPath(b.path)}
            >
              {shelfLabel(b.name)}
            </button>
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
          <button
            type="button"
            className="books-full"
            title={expanded ? 'Leave full screen' : 'Full screen'}
            aria-label={expanded ? 'Leave full screen' : 'Full screen'}
            onClick={toggleFull}
          >
            {expanded ? <IconExitFull /> : <IconFull />}
          </button>
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
            <span className="books-foot-title">{title}</span>
            {pages && <span className="books-foot-pages">{pages}</span>}
          </footer>
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
                  if (!menu.noting) void writePassage(c.id, '');
                }}
              />
            ))}
          </div>
          {!menu.noting && (
            <button type="button" className="book-menu-note" onClick={() => setMenu({ ...menu, noting: true })}>
              Add note
            </button>
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
