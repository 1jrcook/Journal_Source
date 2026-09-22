import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../lib/api';
import type { TreeNode } from '../lib/api';
import { useStore } from '../lib/store';
import { findNode } from '../lib/tree';
import { renderMarkdown } from '../lib/markdown';
import Editor from './Editor';
import Icon from './Icon';

const BOOK_EXT = /\.(epub|mobi|azw3?|fb2|fbz|cbz|pdf|txt|text|html?|docx|rtf|md|markdown)$/i;
const FOLIATE_EXT = /\.(epub|mobi|azw3?|fb2|fbz|cbz|pdf)$/i;
const LIBRARY = 'Library/Ebooks';
const NOTES = 'Notes/Books and Resources';

type BookFile = { path: string; name: string };
type NoteCard = { path: string; title: string; quote: string; location: string };
type TocItem = { label: string; href: string };
type Pop = { x: number; y: number; quote: string; location: string };

type FoliateView = HTMLElement & {
  open: (file: File) => Promise<void>;
  init: (opts: { lastLocation?: string; showTextStart?: boolean }) => Promise<void>;
  goLeft: () => void;
  goRight: () => void;
  goTo: (target: string) => Promise<unknown>;
  goToFraction: (n: number) => Promise<void>;
  addAnnotation: (a: { value: string }) => Promise<unknown>;
  getCFI: (index: number, range: Range) => string;
  clearSearch: () => void;
  search: (opts: { query: string }) => AsyncIterable<{ subitems?: { cfi: string; excerpt: string }[]; label?: string }>;
  book?: { metadata?: { title?: unknown; author?: unknown }; toc?: unknown; dir?: string };
  renderer?: { setStyles?: (css: string) => void };
  close?: () => void;
};

function loadModule(url: string): Promise<Record<string, unknown>> {
  return (new Function('u', 'return import(u)') as (u: string) => Promise<Record<string, unknown>>)(url);
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
  return (t || 'Note').slice(0, max).trim();
}

function slug(s: string): string {
  const t = s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return t || 'book';
}

function yq(s: string): string {
  return JSON.stringify(s);
}

function walk(node: TreeNode | null, out: BookFile[]) {
  if (!node) return;
  if (node.type === 'file' && BOOK_EXT.test(node.name) && !node.path.split('/').some((p) => p.startsWith('.') || p === '.trash')) {
    out.push({ path: node.path, name: node.name });
  }
  node.children?.forEach((c) => walk(c, out));
}

function flattenToc(items: unknown, out: TocItem[] = []): TocItem[] {
  if (!Array.isArray(items)) return out;
  for (const raw of items) {
    if (!raw || typeof raw !== 'object') continue;
    const it = raw as { label?: unknown; href?: unknown; subitems?: unknown };
    const href = typeof it.href === 'string' ? it.href : '';
    const label = textOf(it.label) || 'Section';
    if (href) out.push({ label, href });
    flattenToc(it.subitems, out);
  }
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
  const paras = text.split(/\n+/).map((p) => p.trim()).filter(Boolean);
  return paras.map((p) => `<p>${p.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c] || c))}</p>`).join('');
}

export default function Books() {
  const tree = useStore((s) => s.tree);
  const loadTree = useStore((s) => s.loadTree);
  const openFile = useStore((s) => s.openFile);
  const setBooksOpen = useStore((s) => s.setBooksOpen);
  const setGraph = useStore((s) => s.setGraph);
  const activePath = useStore((s) => s.activePath);
  const notify = useStore((s) => s.notify);
  const [bookPath, setBookPath] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [author, setAuthor] = useState('');
  const [progress, setProgress] = useState(0);
  const [toc, setToc] = useState<TocItem[]>([]);
  const [status, setStatus] = useState('');
  const [plainHtml, setPlainHtml] = useState('');
  const [notes, setNotes] = useState<NoteCard[]>([]);
  const [editing, setEditing] = useState(false);
  const [pop, setPop] = useState<Pop | null>(null);
  const [comment, setComment] = useState('');
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<{ cfi: string; excerpt: string }[]>([]);
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<FoliateView | null>(null);
  const notesRef = useRef<NoteCard[]>([]);
  const sheetRef = useRef<HTMLDivElement>(null);
  notesRef.current = notes;

  const books = useMemo(() => {
    const all: BookFile[] = [];
    walk(tree, all);
    all.sort((a, b) => a.name.localeCompare(b.name));
    return all;
  }, [tree]);

  const book = books.find((b) => b.path === bookPath) || null;

  const refreshNotes = useCallback(async (bookTitle: string) => {
    if (!bookTitle) { setNotes([]); return; }
    const dir = `${NOTES}/${safeName(bookTitle)}`;
    const node = findNode(useStore.getState().tree, dir);
    const files = (node?.children || []).filter((c) => c.type === 'file' && /\.md$/i.test(c.name));
    const cards: NoteCard[] = [];
    for (const f of files) {
      try {
        const r = await api.read(f.path);
        const content = typeof r === 'string' ? r : r.content;
        cards.push({
          path: f.path,
          title: f.name.replace(/\.md$/i, ''),
          quote: firstQuote(content),
          location: fmValue(content, 'location'),
        });
      } catch { /* skip */ }
    }
    setNotes(cards);
  }, []);

  const openNote = useCallback(async (path: string) => {
    await openFile(path);
    setEditing(true);
    setPop(null);
  }, [openFile]);

  useEffect(() => {
    const host = hostRef.current;
    if (!book) {
      setTitle('');
      setPlainHtml('');
      setToc([]);
      setNotes([]);
      return;
    }
    let dead = false;
    const stem = book.name.replace(BOOK_EXT, '');
    setTitle(stem);
    setAuthor('');
    setPlainHtml('');
    setStatus('Opening…');
    setHits([]);
    setPop(null);
    viewRef.current?.close?.();
    viewRef.current = null;
    if (host) host.replaceChildren();

    const showPop = (x: number, y: number, quote: string, location: string) => {
      if (quote.trim().length < 2) return;
      setComment('');
      setPop({ x: Math.min(x, window.innerWidth - 340), y: Math.min(y, window.innerHeight - 220), quote: quote.trim(), location });
    };

    (async () => {
      const res = await fetch(api.rawUrl(book.path), { credentials: 'include' });
      if (!res.ok) throw new Error('Could not read the file');
      const blob = await res.blob();
      const file = new File([blob], book.name);
      if (dead) return;
      if (!FOLIATE_EXT.test(book.name)) {
        let html = '';
        if (/\.docx$/i.test(book.name)) html = await docxToHtml(file);
        else if (/\.(html?)$/i.test(book.name)) html = (await file.text()).replace(/<script[\s\S]*?<\/script>/gi, '');
        else if (/\.(md|markdown)$/i.test(book.name)) html = await renderMarkdown(await file.text(), { rawUrl: api.rawUrl });
        else if (/\.rtf$/i.test(book.name)) html = `<pre>${rtfToText(await file.text()).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c] || c))}</pre>`;
        else html = `<pre>${(await file.text()).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c] || c))}</pre>`;
        if (dead) return;
        setPlainHtml(html);
        setStatus('');
        await refreshNotes(stem);
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
        const d = (ev as CustomEvent).detail || {};
        if (typeof d.fraction === 'number') setProgress(d.fraction);
        if (d.cfi) {
          try { localStorage.setItem('jr-book:' + book.path, d.cfi); } catch { /* ignore */ }
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
          showPop((box?.left || 0) + me.clientX, (box?.top || 0) + me.clientY + 8, quote, location);
        });
        doc.addEventListener('keydown', (e) => {
          if (e.key === 'ArrowLeft') { e.preventDefault(); view.goLeft(); }
          else if (e.key === 'ArrowRight') { e.preventDefault(); view.goRight(); }
        });
      });
      view.addEventListener('draw-annotation', (ev) => {
        const draw = (ev as CustomEvent).detail?.draw as ((fn: unknown, opts: { color: string }) => void) | undefined;
        draw?.(Highlight, { color: '#e6c35c' });
      });
      view.addEventListener('create-overlay', () => {
        for (const n of notesRef.current) {
          if (n.location) view.addAnnotation({ value: n.location }).catch(() => {});
        }
      });
      view.addEventListener('show-annotation', (ev) => {
        const value = (ev as CustomEvent).detail?.value as string;
        const hit = notesRef.current.find((n) => n.location && n.location === value);
        if (hit) openNote(hit.path);
      });
      await view.open(file);
      if (dead) { view.close?.(); return; }
      const metaTitle = textOf(view.book?.metadata?.title) || stem;
      const metaAuthor = textOf(view.book?.metadata?.author);
      setTitle(metaTitle);
      setAuthor(metaAuthor);
      setToc(flattenToc(view.book?.toc).slice(0, 400));
      const saved = (() => { try { return localStorage.getItem('jr-book:' + book.path) || ''; } catch { return ''; } })();
      try {
        await view.init({ lastLocation: saved || undefined, showTextStart: !saved });
      } catch { /* the first page is already up */ }
      view.renderer?.setStyles?.('img,svg,video{max-width:100%} p{line-height:1.55}');
      setStatus('');
      await refreshNotes(metaTitle);
    })().catch((e: Error) => {
      if (!dead) setStatus(e?.message || 'Could not open this book');
    });
    return () => {
      dead = true;
      viewRef.current?.close?.();
      viewRef.current = null;
    };
    // bookPath only: saving a note reloads the tree and must not reopen the file.
  }, [bookPath, openNote, refreshNotes]);

  useEffect(() => {
    const onUp = (e: MouseEvent) => {
      const root = sheetRef.current;
      if (!root || !root.contains(e.target as Node)) return;
      const sel = document.getSelection();
      const quote = sel?.toString() || '';
      if (quote.trim().length < 2) return;
      setComment('');
      setPop({ x: e.clientX, y: e.clientY + 8, quote: quote.trim(), location: 'quote:' + quote.trim().slice(0, 240) });
    };
    document.addEventListener('mouseup', onUp);
    return () => document.removeEventListener('mouseup', onUp);
  }, []);

  const saveNote = async () => {
    if (!pop || !book) return;
    const bookTitle = title || book.name.replace(BOOK_EXT, '');
    const dir = `${NOTES}/${safeName(bookTitle)}`;
    const hub = `${NOTES}/${safeName(bookTitle)}.md`;
    const when = new Date();
    const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit' }).format(when);
    const clock = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Bangkok', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(when).replace(':', '');
    const head = safeName(pop.quote.replace(/\s+/g, ' ').slice(0, 42));
    let name = `${day} ${clock} ${head}.md`;
    let path = `${dir}/${name}`;
    const taken = new Set((findNode(tree, dir)?.children || []).map((c) => c.name.toLowerCase()));
    for (let i = 2; taken.has(name.toLowerCase()); i++) {
      name = `${day} ${clock} ${head} ${i}.md`;
      path = `${dir}/${name}`;
    }
    const tag = `book/${slug(bookTitle)}`;
    const quote = pop.quote.split(/\r?\n/).map((l) => `> ${l}`).join('\n');
    const body = [
      '---',
      'tags:',
      '  - book',
      `  - ${tag}`,
      `book: ${yq(bookTitle)}`,
      author ? `author: ${yq(author)}` : null,
      'type: book-note',
      `created: ${when.toISOString()}`,
      `date: ${day}`,
      `source: ${yq(book.path)}`,
      pop.location ? `location: ${yq(pop.location)}` : null,
      '---',
      '',
      quote,
      '',
      comment.trim(),
      '',
      `[[${safeName(bookTitle, 180)}]]`,
      '',
    ].filter((l) => l !== null).join('\n');
    try {
      await api.createFolder(NOTES).catch(() => {});
      await api.createFolder(dir).catch(() => {});
      await api.write(path, body);
      let hubBody = '';
      try {
        const cur = await api.read(hub);
        hubBody = typeof cur === 'string' ? cur : cur.content;
      } catch { hubBody = ''; }
      const link = `[[${name.replace(/\.md$/i, '')}]]`;
      if (!hubBody) {
        hubBody = [
          '---',
          'tags:',
          '  - book',
          `  - ${tag}`,
          `book: ${yq(bookTitle)}`,
          'type: book',
          `source: ${yq(book.path)}`,
          '---',
          '',
          `# ${bookTitle}`,
          '',
          author ? author : null,
          '',
          'Each highlight is its own note. Open one to elaborate and link it.',
          '',
          `- ${link}`,
          '',
        ].filter((l) => l !== null).join('\n');
      } else if (!hubBody.includes(link)) {
        hubBody = hubBody.replace(/\s*$/, '') + `\n- ${link}\n`;
      }
      await api.write(hub, hubBody);
      await loadTree();
      setPop(null);
      setComment('');
      await refreshNotes(bookTitle);
      if (pop.location && viewRef.current) {
        viewRef.current.addAnnotation({ value: pop.location }).catch(() => {});
      }
      await openNote(path);
      notify('Saved to the journal');
    } catch (e) {
      notify(e instanceof Error ? e.message : 'Could not save the note');
    }
  };

  const onUpload = async (list: FileList | null) => {
    const file = list?.[0];
    if (!file) return;
    if (!BOOK_EXT.test(file.name)) {
      notify('Use EPUB, PDF, MOBI, AZW, FB2, CBZ, DOCX, HTML, or text');
      return;
    }
    setStatus('Adding…');
    try {
      await api.createFolder('Library').catch(() => {});
      await api.createFolder(LIBRARY).catch(() => {});
      const up = await api.upload(file, LIBRARY);
      await loadTree();
      setBookPath(up.path);
      setStatus('');
    } catch (e) {
      setStatus('');
      notify(e instanceof Error ? e.message : 'Upload failed');
    }
  };

  const runSearch = async () => {
    const view = viewRef.current;
    const q = query.trim();
    if (!view || !q) return;
    setHits([]);
    setStatus('Searching…');
    const found: { cfi: string; excerpt: string }[] = [];
    try {
      for await (const chunk of view.search({ query: q })) {
        for (const hit of chunk.subitems || []) {
          found.push({ cfi: hit.cfi, excerpt: hit.excerpt });
          if (found.length >= 12) break;
        }
        if (found.length >= 12) break;
      }
    } catch { /* search can miss a section */ }
    setHits(found);
    setStatus(found.length ? '' : 'No matches');
  };

  return (
    <div className="books">
      <div className="books-bar">
        <strong>{title || 'Books'}</strong>
        {author && <span className="books-author">{author}</span>}
        <span className="grow" />
        {book && FOLIATE_EXT.test(book.name) && (
          <>
            <button type="button" onClick={() => viewRef.current?.goLeft()} title="Previous page">Prev</button>
            <button type="button" onClick={() => viewRef.current?.goRight()} title="Next page">Next</button>
            <label className="books-progress">
              <input
                type="range" min={0} max={1000} value={Math.round(progress * 1000)}
                onChange={(e) => viewRef.current?.goToFraction(Number(e.target.value) / 1000)}
              />
            </label>
            {toc.length > 0 && (
              <select value="" onChange={(e) => { if (e.target.value) viewRef.current?.goTo(e.target.value); }}>
                <option value="">Chapter</option>
                {toc.map((t) => <option key={t.href + t.label} value={t.href}>{t.label}</option>)}
              </select>
            )}
            <form onSubmit={(e) => { e.preventDefault(); runSearch(); }}>
              <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Find" aria-label="Find in book" />
            </form>
          </>
        )}
        <button type="button" onClick={() => { setBooksOpen(false); setGraph(true); }} title="Graph">Graph</button>
        <button type="button" onClick={() => setBooksOpen(false)}>Journal</button>
      </div>
      <div className="books-body">
        <aside className="books-lib">
          <div className="books-lib-head">
            <span>Library</span>
            <label className="books-add" title="Add a book">
              <Icon name="plus" size={16} />
              <input type="file" accept=".epub,.mobi,.azw,.azw3,.fb2,.fbz,.cbz,.pdf,.txt,.html,.htm,.docx,.rtf,.md" onChange={(e) => onUpload(e.target.files)} />
            </label>
          </div>
          <div
            className="books-lib-list"
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => { e.preventDefault(); onUpload(e.dataTransfer.files); }}
          >
            {books.length === 0 && <p className="books-empty">Add an EPUB, PDF, Kindle, FB2, comic, Word, or text file. Files in Library / Ebooks show up here too.</p>}
            {books.map((b) => (
              <button key={b.path} type="button" className={b.path === bookPath ? 'on' : ''} onClick={() => { setBookPath(b.path); setEditing(false); }}>
                {b.name.replace(BOOK_EXT, '')}
              </button>
            ))}
          </div>
        </aside>
        <div className="books-stage">
          {!book && <div className="books-empty big">Pick a book, or add one. Highlight a passage to save it as its own journal note.</div>}
          {status && <div className="books-status">{status}</div>}
          <div ref={hostRef} className="books-foliate" hidden={!book || !!plainHtml} />
          {plainHtml && (
            <div className="books-sheet" ref={sheetRef} dangerouslySetInnerHTML={{ __html: plainHtml }} />
          )}
          {hits.length > 0 && (
            <div className="books-hits">
              {hits.map((h) => (
                <button key={h.cfi} type="button" onClick={() => viewRef.current?.goTo(h.cfi)}>{h.excerpt}</button>
              ))}
            </div>
          )}
        </div>
        <aside className="books-side">
          {editing && activePath && /\.md$/i.test(activePath) ? (
            <div className="books-note">
              <div className="books-note-bar">
                <button type="button" onClick={() => setEditing(false)}>Notes</button>
                <span className="grow" />
                <button type="button" onClick={() => setBooksOpen(false)}>Open in journal</button>
              </div>
              <div className="books-note-editor editor-area">
                <Editor />
              </div>
            </div>
          ) : (
            <div className="books-notes">
              <div className="books-lib-head"><span>Notes</span></div>
              {!book && <p className="books-empty">Notes for the open book land in the journal, tagged with the book, and show up on the graph.</p>}
              {book && notes.length === 0 && <p className="books-empty">Select a passage and save it. Each one becomes its own note you can extend and link.</p>}
              {notes.map((n) => (
                <button key={n.path} type="button" className="books-note-card" onClick={() => openNote(n.path)}>
                  <strong>{n.title}</strong>
                  {n.quote && <span>{n.quote.slice(0, 180)}</span>}
                </button>
              ))}
            </div>
          )}
        </aside>
      </div>
      {pop && (
        <div className="book-pop" style={{ left: Math.max(8, pop.x), top: Math.max(8, pop.y) }}>
          <q>{pop.quote.slice(0, 280)}</q>
          <textarea
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder="Add a thought. You can keep writing in the note."
            autoFocus
          />
          <div className="book-pop-row">
            <button type="button" onClick={() => setPop(null)}>Cancel</button>
            <button type="button" className="primary" onClick={saveNote}>Save note</button>
          </div>
        </div>
      )}
    </div>
  );
}
