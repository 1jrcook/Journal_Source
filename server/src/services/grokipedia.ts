/** Pull a Grokipedia article and keep only the reading text. */

const UA = 'JR-Journal/1.0 (private reader; +https://journal.jrcookgroup.com)';
const CACHE_MS = 10 * 60 * 1000;

type CacheHit = { at: number; title: string; html: string };
const cache = new Map<string, CacheHit>();

const SKIP = new Set(['script', 'style', 'svg', 'button', 'form', 'iframe', 'nav', 'noscript', 'template']);
const KEEP = new Set(['p', 'h1', 'h2', 'h3', 'h4', 'ol', 'ul', 'li', 'em', 'strong', 'b', 'i', 'a', 'sup', 'sub', 'br', 'blockquote', 'code', 'hr']);

export function grokSlug(title: string): string {
  const t = title.replace(/\s+/g, ' ').trim();
  if (!t || t.length > 180) throw Object.assign(new Error('bad title'), { status: 400 });
  if (/[\u0000-\u001f\\/]/.test(t)) throw Object.assign(new Error('bad title'), { status: 400 });
  return t.replace(/ /g, '_');
}

function decodeBasic(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'");
}

function attr(raw: string, name: string): string {
  const m = raw.match(new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)')`, 'i'));
  return m ? decodeBasic(m[2] ?? m[3] ?? '') : '';
}

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Wikipedia or Grokipedia URL → article title. Anything else is null. */
export function termFromHref(href: string): string | null {
  let u: URL;
  try {
    u = new URL(href, 'https://grokipedia.com');
  } catch {
    return null;
  }
  const host = u.hostname.replace(/^www\./, '');
  let raw = '';
  if (host === 'grokipedia.com' && u.pathname.startsWith('/page/')) raw = u.pathname.slice('/page/'.length);
  else if (host.endsWith('wikipedia.org')) {
    if (u.pathname.startsWith('/wiki/')) raw = u.pathname.slice('/wiki/'.length);
    else raw = u.searchParams.get('title') || '';
  } else if (href.startsWith('/page/')) raw = href.slice('/page/'.length);
  raw = decodeURIComponent(raw.split('#')[0] || '').replace(/_/g, ' ').trim();
  if (!raw || raw.length > 180) return null;
  return raw;
}

function pageTerm(href: string): string | null {
  const t = termFromHref(href.startsWith('/page/') ? `https://grokipedia.com${href}` : href);
  return t;
}

function extractArticle(html: string): { title: string; body: string } {
  const h1 = html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i);
  const title = h1 ? h1[1].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim() : '';
  const open = html.match(/<div\b[^>]*class="[^"]*\barticle-body\b[^"]*"[^>]*>/i);
  if (!open || open.index == null) return { title, body: '' };
  const from = open.index + open[0].length;
  const re = /<\/?div\b[^>]*>/gi;
  re.lastIndex = from;
  let depth = 1;
  let end = html.length;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    if (m[0].startsWith('</')) depth -= 1;
    else if (!m[0].endsWith('/>')) depth += 1;
    if (depth === 0) {
      end = m.index;
      break;
    }
  }
  return { title, body: html.slice(from, end) };
}

/** Keep headings, paragraphs, lists, and in-article Grokipedia links. */
export function sanitizeArticle(body: string): string {
  const tagRe = /<!--[\s\S]*?-->|<(\/?)([a-zA-Z][\w:-]*)([^>]*)>/g;
  let out = '';
  let last = 0;
  let skip = 0;
  const spanStack: Array<'p' | 'x'> = [];
  const linkStack: boolean[] = [];
  let m: RegExpExecArray | null;
  while ((m = tagRe.exec(body))) {
    if (!skip && m.index > last) out += body.slice(last, m.index);
    last = m.index + m[0].length;
    if (m[0].startsWith('<!--')) continue;
    const closing = m[1] === '/';
    const tag = m[2].toLowerCase();
    const attrs = m[3] || '';
    const self = /\/>\s*$/.test(m[0]) || tag === 'br' || tag === 'hr';
    if (SKIP.has(tag)) {
      if (self) continue;
      if (closing) skip = Math.max(0, skip - 1);
      else skip += 1;
      continue;
    }
    if (skip) continue;
    if (tag === 'span') {
      if (!closing) spanStack.push(/\bdata-tts-block\s*=/.test(attrs) ? 'p' : 'x');
      else if (spanStack.pop() === 'p') out += '</p>';
      if (!closing && spanStack.at(-1) === 'p') out += '<p>';
      continue;
    }
    if (tag === 'a') {
      if (!closing) {
        const term = pageTerm(attr(attrs, 'href'));
        linkStack.push(Boolean(term));
        if (term) out += `<a href="#" class="gk-link" data-grok="${esc(term)}">`;
      } else if (linkStack.pop()) out += '</a>';
      continue;
    }
    if (!KEEP.has(tag)) continue;
    if (tag === 'br' || tag === 'hr') {
      out += `<${tag}>`;
      continue;
    }
    if (closing) {
      out += `</${tag}>`;
      continue;
    }
    const id = attr(attrs, 'id');
    out += id && /^[A-Za-z0-9_-]+$/.test(id) ? `<${tag} id="${esc(id)}">` : `<${tag}>`;
  }
  if (!skip && last < body.length) out += body.slice(last);
  let prev = '';
  while (prev !== out) {
    prev = out;
    out = out.replace(/<sup>\s*<sup>/g, '<sup>').replace(/<\/sup>\s*<\/sup>/g, '</sup>');
  }
  return out.replace(/<p>\s*<\/p>/g, '').trim();
}

export async function fetchArticle(title: string): Promise<{ title: string; html: string }> {
  const slug = grokSlug(title);
  const key = slug.toLowerCase();
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return { title: hit.title, html: hit.html };
  const url = `https://grokipedia.com/page/${encodeURIComponent(slug)}`;
  const res = await fetch(url, {
    headers: { 'User-Agent': UA, Accept: 'text/html' },
    redirect: 'follow',
    signal: AbortSignal.timeout(12000),
  });
  if (res.status === 404) throw Object.assign(new Error('No Grokipedia page for this.'), { status: 404 });
  if (!res.ok) throw Object.assign(new Error('Grokipedia did not answer.'), { status: 502 });
  const raw = await res.text();
  const article = extractArticle(raw);
  const html = sanitizeArticle(article.body);
  if (!html) throw Object.assign(new Error('No Grokipedia page for this.'), { status: 404 });
  const shown = article.title || title.replace(/_/g, ' ');
  cache.set(key, { at: Date.now(), title: shown, html });
  return { title: shown, html };
}
