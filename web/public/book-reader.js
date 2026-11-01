/* Digest book reader. One book, no journal shell. Progress uses the same
   reading-state record and local keys as the Mind reader. A selection opens
   the same passage menu as Mind: highlight, define, explore, note, copy. */
(function () {
  var theme = 'dark';
  try {
    var asked = new URLSearchParams(location.search).get('theme');
    if (asked === 'light' || asked === 'dark') theme = asked;
  } catch (e) {}
  document.documentElement.setAttribute('data-theme', theme);

  var PARENTS = { 'https://digests.jrcookgroup.com': 1, 'https://chat.jrcookgroup.com': 1 };
  var BOOK_RE = /^Library\/Ebooks\/[^/\\]+\.(epub|pdf|txt|text|md|markdown)$/i;
  var ZONE = 'Asia/Bangkok';
  var COLORS = [
    { id: 'yellow', value: '#e6c35c' },
    { id: 'green', value: '#7dcea0' },
    { id: 'blue', value: '#7eb6ff' },
    { id: 'pink', value: '#f5a3c7' },
    { id: 'orange', value: '#f0a05a' }
  ];

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c];
    });
  }

  function slug(s) {
    var t = String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    return t || 'book';
  }

  function yq(s) { return JSON.stringify(String(s == null ? '' : s)); }

  function colorValue(id) {
    for (var i = 0; i < COLORS.length; i++) if (COLORS[i].id === id) return COLORS[i].value;
    return COLORS[0].value;
  }

  function fmValue(src, key) {
    var fence = String(src || '').match(/^---[ \t]*\r?\n([\s\S]*?)\r?\n---/);
    if (!fence) return '';
    var m = fence[1].match(new RegExp('^' + key + ':[ \\t]*(.*)$', 'm'));
    if (!m) return '';
    var v = m[1].trim();
    if ((v.charAt(0) === '"' && v.charAt(v.length - 1) === '"') || (v.charAt(0) === "'" && v.charAt(v.length - 1) === "'")) {
      try { v = JSON.parse(v.charAt(0) === "'" ? '"' + v.slice(1, -1).replace(/"/g, '\\"') + '"' : v); }
      catch (e) { v = v.slice(1, -1); }
    }
    return v;
  }

  function firstQuote(src) {
    var body = String(src || '').replace(/^---[\s\S]*?\n---\s*/, '');
    var lines = [];
    var parts = body.split(/\r?\n/);
    for (var i = 0; i < parts.length; i++) {
      if (parts[i].indexOf('>') === 0) lines.push(parts[i].replace(/^>\s?/, ''));
      else if (lines.length) break;
    }
    return lines.join('\n').trim();
  }

  function noteBodyText(src) {
    var body = String(src || '').replace(/^---[\s\S]*?\n---\s*/, '');
    var lines = body.split(/\r?\n/);
    var i = 0;
    while (i < lines.length && (lines[i].indexOf('>') === 0 || lines[i].trim() === '')) i++;
    while (i < lines.length && /^\[\[.+\]\]\s*$/.test(lines[i].trim())) i++;
    while (i < lines.length && lines[i].trim() === '') i++;
    return lines.slice(i).join('\n').trim();
  }

  function findNode(node, want) {
    if (!node) return null;
    if (node.path === want) return node;
    var kids = node.children || [];
    for (var i = 0; i < kids.length; i++) {
      var hit = findNode(kids[i], want);
      if (hit) return hit;
    }
    return null;
  }

  function collectFiles(node, out) {
    if (!node) return out;
    if (node.type === 'file') out.push(node);
    var kids = node.children || [];
    for (var i = 0; i < kids.length; i++) collectFiles(kids[i], out);
    return out;
  }

  function paintQuote(root, quote, color) {
    var needle = String(quote || '').replace(/\s+/g, ' ').trim();
    if (!root || needle.length < 2) return;
    var walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    var node = walker.nextNode();
    var raw = String(quote || '').trim();
    while (node) {
      var text = node.textContent || '';
      var idx = text.indexOf(raw);
      var len = raw.length;
      if (idx < 0) { idx = text.indexOf(needle); len = needle.length; }
      if (idx >= 0) {
        var range = document.createRange();
        range.setStart(node, idx);
        range.setEnd(node, idx + len);
        var mark = document.createElement('mark');
        mark.dataset.book = color;
        try { range.surroundContents(mark); } catch (e) { /* a quote split across tags stays plain */ }
        return;
      }
      node = walker.nextNode();
    }
  }

  function nowParts() {
    var when = new Date();
    var day = '';
    try {
      day = new Intl.DateTimeFormat('en-CA', { timeZone: ZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).format(when);
    } catch (e) {
      day = when.getFullYear() + '-' + String(when.getMonth() + 1).padStart(2, '0') + '-' + String(when.getDate()).padStart(2, '0');
    }
    return { when: when, day: day };
  }

  function cleanQuote(q) {
    var s = String(q || '').trim().replace(/^["'“‘(«\[<{]+|[)"'”’»\]>}:;,.!?]+$/g, '').trim();
    var words = s.split(/\s+/);
    if (words.length > 6) s = words.slice(0, 6).join(' ');
    return s;
  }

  function icon(name) {
    var paths = {
      dict: '<path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1-2.5-2.5Z"/><path d="M8 7h8"/><path d="M8 11h8"/>',
      globe: '<circle cx="12" cy="12" r="10"/><path d="M2 12h20"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>',
      note: '<path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>',
      copy: '<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
      trash: '<path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>'
    };
    return '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (paths[name] || '') + '</svg>';
  }

  function parentOrigin() {
    try {
      if (document.referrer) {
        var origin = new URL(document.referrer).origin;
        if (PARENTS[origin]) return origin;
      }
    } catch (e) {}
    return 'https://digests.jrcookgroup.com';
  }

  function post(msg) {
    if (window.parent === window) return;
    try { window.parent.postMessage(msg, parentOrigin()); } catch (e) {}
  }

  function $(id) { return document.getElementById(id); }

  function safeName(s, max) {
    var t = String(s || '').replace(/[\\/:*?"<>|[\]]+/g, ' ').replace(/\s+/g, ' ').trim().replace(/^\.+|\.+$/g, '');
    return (t || 'Book').slice(0, max || 80).trim();
  }

  function textOf(v) {
    if (!v) return '';
    if (typeof v === 'string') return v;
    if (Array.isArray(v)) return textOf(v[0]);
    if (typeof v === 'object') return textOf(v.en || v[''] || Object.values(v)[0]);
    return String(v);
  }

  function bookPath() {
    var raw = '';
    try { raw = new URLSearchParams(location.search).get('book') || ''; } catch (e) { raw = ''; }
    raw = raw.replace(/\\/g, '/').replace(/^\/+/, '');
    if (!BOOK_RE.test(raw) || raw.indexOf('..') !== -1) return '';
    return raw;
  }

  function localAt(path) {
    try { return Number(localStorage.getItem('jr-book-at:' + path) || '0') || 0; } catch (e) { return 0; }
  }

  function readerCss(phone) {
    var light = document.documentElement.getAttribute('data-theme') === 'light';
    var fg = light ? '#1c1916' : '#efe7d8';
    var bg = light ? '#f7f1e6' : '#161412';
    var pad = phone ? '18px' : '8%';
    var size = phone ? 18 : 19;
    var align = phone ? 'start' : 'justify';
    var hyphens = phone ? 'manual' : 'auto';
    return [
      'html { color-scheme: ' + (light ? 'light' : 'dark') + '; background: ' + bg + '; color: ' + fg + '; }',
      'body { color: ' + fg + ' !important; background: ' + bg + ' !important;',
      'font-family: Georgia, "Iowan Old Style", Palatino, "Palatino Linotype", serif !important;',
      'font-size: ' + size + 'px !important; line-height: 1.65 !important;',
      'padding: ' + (phone ? '8px' : '20px') + ' ' + pad + ' 24px !important;',
      'word-break: break-word; }',
      'p, li, blockquote, dd { line-height: 1.65 !important; text-align: ' + align + '; hyphens: ' + hyphens + '; }',
      'a, a:link, a:visited { color: inherit !important; text-decoration: none !important; cursor: text !important; pointer-events: none !important; }',
      'img, svg, video { max-width: 100%; height: auto; }',
      'pre { white-space: pre-wrap !important; }'
    ].join('\n');
  }

  function boot() {
    var path = bookPath();
    var titleEl = $('title');
    var placeEl = $('place');
    var chapterEl = $('chapter');
    var statusEl = $('status');
    var progressEl = $('progress');
    var barEl = $('progress-bar');
    var chaptersEl = $('chapters');
    var listEl = $('chapter-list');
    var plainEl = $('plain');
    var plainBody = $('plain-body');
    var stage = $('stage');
    var btnPrev = $('btn-prev');
    var btnNext = $('btn-next');
    var btnChapters = $('btn-chapters');

    var view = null;
    var plain = false;
    var ready = false;
    var dirty = false;
    var openedCfi = '';
    var openedFrac = -1;
    var fraction = 0;
    var cfi = '';
    var title = 'Book';
    var saveTimer = 0;
    var pending = null;
    var lastSent = '';
    var lastPageAt = 0;
    var beatTimer = 0;
    var toc = [];
    var bound = typeof WeakSet === 'function' ? new WeakSet() : null;
    var marks = [];
    var marksGen = 0;
    var folderFiles = [];
    var menu = null;
    var author = '';
    var plainSource = '';
    var Highlight = null;
    var saving = false;
    var lookupMode = '';
    var toastTimer = 0;
    var plainSelTimer = 0;
    var menuWired = false;

    function setStatus(text) {
      statusEl.textContent = text || '';
      statusEl.hidden = !text;
    }

    function setTitle(next) {
      title = next || 'Book';
      titleEl.textContent = title;
      document.title = title;
      post({ type: 'jr-modal-title', title: title.slice(0, 80) });
    }

    function paintProgress(frac, pageLabel) {
      if (typeof frac === 'number' && isFinite(frac)) fraction = Math.max(0, Math.min(1, frac));
      var pct = Math.round(fraction * 100);
      barEl.style.width = pct + '%';
      progressEl.setAttribute('aria-valuenow', String(pct));
      placeEl.textContent = (pageLabel ? pageLabel + ' · ' : '') + pct + '%';
    }

    function pageLabel(detail) {
      var label = textOf(detail && detail.pageItem && detail.pageItem.label);
      if (label) return label;
      var loc = detail && detail.location;
      if (loc && typeof loc.current === 'number' && typeof loc.total === 'number' && loc.total > 0) {
        return (loc.current + 1) + ' / ' + loc.total;
      }
      return '';
    }

    function tellParent() {
      post({
        type: 'jr-reader',
        book: {
          path: path,
          title: title,
          fraction: fraction,
          folder: 'Reading/' + safeName(title, 120)
        }
      });
    }

    function patchBody() {
      if (!path) return null;
      if (plain) return { cfi: 'scroll:' + fraction.toFixed(6), fraction: fraction };
      if (!cfi || cfi.indexOf('epubcfi(') !== 0) return null;
      return { cfi: cfi, fraction: fraction };
    }

    function saveNow() {
      if (!dirty) return Promise.resolve();
      var body = patchBody();
      if (!body) return Promise.resolve();
      var key = JSON.stringify(body);
      if (key === lastSent) return pending || Promise.resolve();
      if (pending) return pending;
      var at = Date.now();
      try {
        localStorage.setItem('jr-book-at:' + path, String(at));
        if (!plain && body.cfi) localStorage.setItem('jr-book:' + path, body.cfi);
        if (plain) localStorage.setItem('jr-book-scroll:' + path, String(plainEl.scrollTop || 0));
      } catch (e) {}
      pending = fetch('/api/reading-state', {
        method: 'PUT',
        credentials: 'include',
        keepalive: true,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: path, cfi: body.cfi, fraction: body.fraction, updatedAt: at })
      }).then(function (r) {
        if (r.ok) lastSent = key;
      }).catch(function () {}).then(function () { pending = null; });
      tellParent();
      return pending;
    }

    function scheduleSave() {
      dirty = true;
      clearTimeout(saveTimer);
      saveTimer = setTimeout(saveNow, 800);
    }

    function closeChapters() {
      chaptersEl.classList.remove('open');
      btnChapters.setAttribute('aria-expanded', 'false');
    }

    function toggleChapters() {
      var open = !chaptersEl.classList.contains('open');
      chaptersEl.classList.toggle('open', open);
      btnChapters.setAttribute('aria-expanded', open ? 'true' : 'false');
    }

    function markChapter(label) {
      var nodes = listEl.querySelectorAll('button');
      for (var i = 0; i < nodes.length; i++) {
        var on = label && nodes[i].textContent === label;
        if (on) nodes[i].setAttribute('aria-current', 'true');
        else nodes[i].removeAttribute('aria-current');
      }
    }

    function renderToc(items) {
      toc = items || [];
      listEl.replaceChildren();
      if (!toc.length) {
        var empty = document.createElement('p');
        empty.className = 'empty';
        empty.textContent = 'This book has no chapter list.';
        listEl.appendChild(empty);
        return;
      }
      toc.forEach(function (item) {
        var b = document.createElement('button');
        b.type = 'button';
        b.textContent = item.label;
        b.style.paddingLeft = (12 + item.depth * 14) + 'px';
        b.addEventListener('click', function () {
          if (view) view.goTo(item.href).catch(function () {});
          closeChapters();
        });
        listEl.appendChild(b);
      });
    }

    function flattenToc(items, depth, out) {
      out = out || [];
      depth = depth || 0;
      (items || []).forEach(function (it) {
        var label = String(it.label || '').trim();
        if (label && it.href) out.push({ label: label, href: it.href, depth: depth });
        if (it.subitems && it.subitems.length) flattenToc(it.subitems, depth + 1, out);
      });
      return out;
    }

    function phone() {
      return window.matchMedia('(max-width: 640px)').matches;
    }

    function applyStyles() {
      if (!view || !view.renderer) return;
      if (view.renderer.setStyles) view.renderer.setStyles(readerCss(phone()));
      if (view.renderer.setAttribute) view.renderer.setAttribute('flow', 'paginated');
    }

    function go(dir) {
      if (plain) {
        var delta = Math.max(120, plainEl.clientHeight * 0.88) * dir;
        plainEl.scrollBy({ top: delta, behavior: 'auto' });
        return;
      }
      if (!view) return;
      if (dir < 0) view.goLeft();
      else view.goRight();
    }

    function onEscape() {
      if (lookupOpen()) { closeLookup(); return; }
      if (menu) { closeMenu(); return; }
      if (chaptersEl.classList.contains('open')) {
        closeChapters();
        return;
      }
      saveNow();
      post({ type: 'jr-modal-esc' });
    }

    function onKey(e) {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        onEscape();
        return;
      }
      if (e.altKey || e.metaKey || e.ctrlKey) return;
      var tag = e.target && e.target.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      if (e.key === 'ArrowLeft' || e.key === 'PageUp') { e.preventDefault(); go(-1); }
      else if (e.key === 'ArrowRight' || e.key === 'PageDown' || e.key === ' ') { e.preventDefault(); go(1); }
    }

    var TAP_EDGE = 0.15;

    function textSelected(sel) {
      return !!(sel && !sel.isCollapsed && String(sel.toString() || '').trim());
    }

    // The iframe is as wide as the chapter. clientX is from that iframe, not
    // from the page on screen, so the edge is measured against the clip.
    function tapFraction(doc, clientX, clientY) {
      var frame = doc.defaultView && doc.defaultView.frameElement;
      var viewEl = frame && frame.parentElement;
      var container = viewEl && viewEl.parentElement;
      if (!frame || !container || !container.getBoundingClientRect) {
        var w0 = (doc.documentElement && doc.documentElement.clientWidth) || window.innerWidth || 1;
        return clientX / w0;
      }
      var frameRect = frame.getBoundingClientRect();
      var clipRect = container.getBoundingClientRect();
      var vertical = !!(container.parentElement && container.parentElement.classList.contains('vertical'));
      if (vertical) {
        var h = clipRect.height || 1;
        return (clientY - (clipRect.top - frameRect.top)) / h;
      }
      var w = clipRect.width || 1;
      return (clientX - (clipRect.left - frameRect.left)) / w;
    }

    function bindDoc(doc, index) {
      if (!doc || (bound && bound.has(doc))) return;
      if (bound) bound.add(doc);
      var dismissClick = false;
      var hadSelection = false;
      var touchHadSelection = false;
      var selTimer = 0;
      doc.addEventListener('keydown', onKey, true);
      doc.addEventListener('touchstart', function () {
        touchHadSelection = textSelected(doc.getSelection && doc.getSelection());
      }, true);
      doc.addEventListener('mousedown', function (e) {
        if (e.button !== 0) return;
        hadSelection = textSelected(doc.getSelection && doc.getSelection());
        if (menu || lookupOpen()) { dismissClick = true; closeMenu(); }
      }, true);
      doc.addEventListener('mouseup', function (e) {
        if (e.button !== 0) return;
        selectionIn(doc, index, e.clientX, e.clientY);
      });
      doc.addEventListener('contextmenu', function (e) {
        if (selectionIn(doc, index, e.clientX, e.clientY)) e.preventDefault();
      });
      doc.addEventListener('selectionchange', function () {
        var sel = doc.getSelection && doc.getSelection();
        if (!sel || String(sel.toString() || '').trim().length < 2) return;
        clearTimeout(selTimer);
        selTimer = setTimeout(function () { selectionIn(doc, index); }, 220);
      });
      doc.addEventListener('touchend', function (e) {
        var t = e.changedTouches && e.changedTouches[0];
        setTimeout(function () {
          selectionIn(doc, index, t ? t.clientX : undefined, t ? t.clientY : undefined);
        }, 60);
      });
      doc.addEventListener('click', function (e) {
        if (e.button !== 0) return;
        if (dismissClick) { dismissClick = false; e.preventDefault(); return; }
        if (hadSelection || touchHadSelection) {
          hadSelection = false;
          touchHadSelection = false;
          return;
        }
        var sel = doc.getSelection && doc.getSelection();
        if (textSelected(sel)) return;
        var t = e.target;
        if (t && t.closest && t.closest('a[href], button, input, textarea')) return;
        var frac = tapFraction(doc, e.clientX, e.clientY);
        if (!(frac < TAP_EDGE || frac > 1 - TAP_EDGE)) return;
        var dir = frac < TAP_EDGE ? -1 : 1;
        setTimeout(function () {
          if (menu || lookupOpen()) return;
          go(dir);
        }, 0);
      }, true);
      var acc = 0;
      var at = 0;
      doc.addEventListener('wheel', function (e) {
        if (e.ctrlKey || plain) return;
        e.preventDefault();
        var now = Date.now();
        if (now - at < 350) return;
        acc += e.deltaY;
        if (Math.abs(acc) < 40) return;
        at = now;
        var dir = acc > 0 ? 1 : -1;
        acc = 0;
        go(dir);
      }, { passive: false });
    }

    function beat(active) {
      if (!path || document.visibilityState !== 'visible') return;
      if (Date.now() - lastPageAt > 2 * 60 * 1000) return;
      var localDate = '';
      var localHour = new Date().getHours();
      try {
        var parts = {};
        new Intl.DateTimeFormat('en-CA', {
          timeZone: ZONE, year: 'numeric', month: '2-digit', day: '2-digit', hour: 'numeric', hour12: false
        }).formatToParts(new Date()).forEach(function (p) { parts[p.type] = p.value; });
        localDate = parts.year + '-' + parts.month + '-' + parts.day;
        localHour = Number(parts.hour);
      } catch (e) {
        var n = new Date();
        localDate = n.getFullYear() + '-' + String(n.getMonth() + 1).padStart(2, '0') + '-' + String(n.getDate()).padStart(2, '0');
      }
      fetch('/api/reading/heartbeat', {
        method: 'POST',
        credentials: 'include',
        keepalive: true,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          path: path,
          title: title,
          fraction: fraction,
          localDate: localDate,
          localHour: localHour,
          active: active !== false
        })
      }).catch(function () {});
    }

    function startBeat() {
      // The first beat waits one interval, so opening the book does not record time by itself.
      lastPageAt = Date.now();
      clearInterval(beatTimer);
      beatTimer = setInterval(function () { beat(true); }, 15000);
    }

    function onRelocate(ev) {
      var detail = (ev && ev.detail) || {};
      lastPageAt = Date.now();
      if (typeof detail.fraction === 'number') paintProgress(detail.fraction, pageLabel(detail));
      else paintProgress(fraction, pageLabel(detail));
      var ch = detail.tocItem && detail.tocItem.label;
      if (ch) {
        chapterEl.textContent = String(ch);
        markChapter(String(ch));
      }
      if (detail.cfi) cfi = String(detail.cfi);
      if (!ready) return;
      var moved = false;
      if (!openedCfi && cfi) {
        openedCfi = cfi;
        openedFrac = fraction;
      } else if ((cfi && openedCfi && cfi !== openedCfi) || (openedFrac >= 0 && Math.abs(fraction - openedFrac) > 0.001)) {
        moved = true;
        openedCfi = cfi;
        openedFrac = fraction;
      }
      if (moved) {
        scheduleSave();
        if (menu && !menu.noting) closeMenu();
      }
      tellParent();
    }

    function fail(msg) {
      setStatus(msg || 'This book did not open.');
      btnPrev.disabled = true;
      btnNext.disabled = true;
    }

    function enable() {
      setStatus('');
      btnPrev.disabled = false;
      btnNext.disabled = false;
      ready = true;
      openedCfi = cfi;
      openedFrac = fraction;
      startBeat();
      tellParent();
    }

    function toast(msg) {
      var el = $('toast');
      if (!el) return;
      el.textContent = msg || '';
      el.classList.toggle('on', !!msg);
      clearTimeout(toastTimer);
      if (!msg) return;
      toastTimer = setTimeout(function () { el.classList.remove('on'); }, 2400);
    }

    function lookupOpen() {
      var root = $('lookup');
      return !!(root && !root.hidden);
    }

    function closeLookup() {
      var root = $('lookup');
      if (!root) return;
      root.classList.remove('in');
      root.hidden = true;
      lookupMode = '';
      var body = $('lookup-body');
      if (body) body.innerHTML = '';
    }

    function showLookup(mode, titleText, html, status) {
      var root = $('lookup');
      if (!root) return;
      lookupMode = mode;
      root.hidden = false;
      var badge = $('lookup-badge');
      var heading = $('lookup-title');
      if (badge) badge.textContent = mode === 'dictionary' ? 'Dictionary' : 'Grokipedia';
      if (heading) heading.textContent = titleText || '';
      root.setAttribute('aria-label', titleText || 'Lookup');
      var body = $('lookup-body');
      if (!body) return;
      if (status === 'ok') body.innerHTML = html || '';
      else if (status === 'miss') body.textContent = mode === 'dictionary' ? 'No dictionary definition found.' : 'No Grokipedia page for this.';
      else if (status === 'error') body.textContent = mode === 'dictionary' ? 'Could not load definition.' : 'Could not open that page.';
      else body.textContent = mode === 'dictionary' ? 'Looking up…' : 'Opening…';
      if (!root.classList.contains('in')) requestAnimationFrame(function () { root.classList.add('in'); });
    }

    function openDict(raw) {
      var term = cleanQuote(raw);
      if (!term) return;
      showLookup('dictionary', term, '', 'loading');
      apiSend('/api/dictionary?word=' + encodeURIComponent(term)).then(function (r) {
        if (!r.ok) { showLookup('dictionary', term, '', r.status === 404 ? 'miss' : 'error'); return; }
        return r.json().then(function (j) {
          showLookup('dictionary', (j && j.word) || term, (j && j.html) || '', j && j.html ? 'ok' : 'miss');
        });
      }).catch(function () { showLookup('dictionary', term, '', 'error'); });
    }

    function openGrok(raw) {
      var term = cleanQuote(raw);
      if (!term) return;
      showLookup('grokipedia', term, '', 'loading');
      apiSend('/api/grokipedia?title=' + encodeURIComponent(term)).then(function (r) {
        if (!r.ok) {
          return r.json().catch(function () { return {}; }).then(function (j) {
            var msg = (j && j.error) || '';
            showLookup('grokipedia', term, '', /no grokipedia/i.test(msg) ? 'miss' : 'error');
          });
        }
        return r.json().then(function (j) {
          showLookup('grokipedia', (j && j.title) || term, (j && j.html) || '', j && j.html ? 'ok' : 'miss');
        });
      }).catch(function () { showLookup('grokipedia', term, '', 'error'); });
    }

    function apiSend(url, opt) {
      opt = opt || {};
      var headers = Object.assign({}, opt.headers || {});
      if (opt.body && !headers['Content-Type']) headers['Content-Type'] = 'application/json';
      return fetch(url, {
        method: opt.method || 'GET',
        credentials: 'include',
        headers: headers,
        body: opt.body || undefined
      }).then(function (r) {
        if (r.status === 401) {
          var err = new Error('Sign in on the Mind tab, then try again.');
          err.code = 401;
          throw err;
        }
        return r;
      });
    }

    function closeMenu() {
      menu = null;
      var el = $('book-menu');
      if (!el) return;
      el.hidden = true;
      el.classList.remove('noting');
      el.removeAttribute('style');
      el.innerHTML = '';
    }

    function placeMenu() {
      var el = $('book-menu');
      if (!el || el.hidden || !menu) return;
      var margin = 10;
      var gap = 10;
      var vw = window.innerWidth;
      var vh = window.innerHeight;
      el.style.maxWidth = (vw - 2 * margin) + 'px';
      if (el.classList.contains('noting') && window.matchMedia('(max-width: 640px)').matches) return;
      el.style.bottom = 'auto';
      var box = el.getBoundingClientRect();
      var left = Math.max(margin, Math.min(menu.x - box.width / 2, vw - box.width - margin));
      var above = menu.y - gap - box.height;
      var below = menu.y + gap + 24;
      var top = above >= margin + 44 ? above : (below + box.height <= vh - margin ? below : Math.max(margin + 44, vh - box.height - margin));
      el.style.left = left + 'px';
      el.style.top = top + 'px';
    }

    function menuButton(act, glyph, label, title, extra) {
      return '<button type="button" class="book-menu-btn' + (extra ? ' ' + extra : '') + '" data-act="' + act + '" title="' + esc(title) + '">' + icon(glyph) + '<span>' + esc(label) + '</span></button>';
    }

    function swatches() {
      return COLORS.map(function (c) {
        var on = menu && menu.color === c.id ? ' on' : '';
        return '<button type="button" data-act="color" data-color="' + c.id + '" class="' + on.trim() + '" style="background:' + c.value + '" aria-label="Highlight ' + c.id + '" title="Highlight ' + c.id + '"></button>';
      }).join('');
    }

    function renderMenu() {
      var el = $('book-menu');
      if (!el || !menu) return;
      el.classList.toggle('noting', !!menu.noting);
      if (menu.noting) {
        var shown = menu.quote.length > 140 ? menu.quote.slice(0, 140) + '…' : menu.quote;
        el.innerHTML = '<div class="book-swatches">' + swatches() + '</div>'
          + '<div class="book-noting-box"><p class="book-note-quote">“' + esc(shown) + '”</p><form>'
          + '<textarea id="note-draft" placeholder="Write a note...">' + esc(menu.draft || '') + '</textarea>'
          + '<div class="book-menu-row">'
          + (menu.existing ? '<button type="button" class="danger" data-act="remove">Delete</button>' : '')
          + '<button type="button" data-act="close">Cancel</button>'
          + '<button type="submit" class="primary">Save</button></div></form></div>';
      } else {
        var noted = menu.existing && menu.existing.note;
        el.innerHTML = '<div class="book-swatches">' + swatches() + '</div><div class="book-menu-sep"></div>'
          + menuButton('define', 'dict', 'Define', 'Define in Dictionary')
          + menuButton('explore', 'globe', 'Explore', 'Explore in Grokipedia')
          + menuButton('note', 'note', noted ? 'Edit Note' : 'Note', noted ? 'Edit note' : 'Add note')
          + menuButton('copy', 'copy', 'Copy', 'Copy quote')
          + (menu.existing ? menuButton('remove', 'trash', 'Remove', 'Remove highlight', 'danger') : '')
          + '<button type="button" class="book-menu-btn dismiss" data-act="close" title="Close" aria-label="Close">×</button>';
      }
      el.hidden = false;
      el.style.visibility = 'hidden';
      placeMenu();
      el.style.visibility = 'visible';
      if (menu.noting) {
        var ta = el.querySelector('#note-draft');
        if (ta) setTimeout(function () { try { ta.focus(); } catch (e) {} }, 30);
      }
    }

    function openMenu(x, y, quote, location) {
      if (lookupOpen()) return;
      var text = String(quote || '').trim();
      if (text.length < 2 && !location) return;
      var known = null;
      for (var i = 0; i < marks.length; i++) {
        var m = marks[i];
        var sameLoc = !!(m.location && location && m.location === location);
        var sameQuote = !!(m.quote && text && m.quote.replace(/\s+/g, ' ') === text.replace(/\s+/g, ' '));
        if (sameLoc || sameQuote) { known = m; break; }
      }
      menu = {
        x: x,
        y: y,
        quote: text || (known && known.quote) || '',
        location: location || (known && known.location) || '',
        color: (known && known.color) || 'yellow',
        noting: !!(known && known.note),
        draft: (known && known.note) || '',
        existing: known
      };
      closeChapters();
      renderMenu();
    }

    function selectionIn(doc, index, clientX, clientY) {
      if (!doc || lookupOpen()) return false;
      var sel = doc.getSelection && doc.getSelection();
      var quote = sel ? String(sel.toString() || '') : '';
      if (!sel || !sel.rangeCount || quote.trim().length < 2) return false;
      var anchor = sel.anchorNode;
      var el = anchor && (anchor.nodeType === 1 ? anchor : anchor.parentElement);
      if (doc === document) {
        if (!el || !plainEl.contains(el)) return false;
      }
      if (el && el.closest && el.closest('#book-menu, #lookup, textarea, input')) return false;
      var location = '';
      var rect = null;
      try {
        var range = sel.getRangeAt(0);
        if (view && typeof index === 'number' && view.getCFI) location = view.getCFI(index, range) || '';
        rect = range.getBoundingClientRect();
      } catch (e) { location = ''; }
      if (!location) location = 'quote:' + quote.trim().slice(0, 240);
      var frame = null;
      try { frame = doc.defaultView && doc.defaultView.frameElement; } catch (e2) { frame = null; }
      var box = frame ? frame.getBoundingClientRect() : { left: 0, top: 0 };
      var x = box.left + (typeof clientX === 'number' ? clientX : window.innerWidth / 2);
      var y = box.top + (typeof clientY === 'number' ? clientY : 80);
      if (rect && rect.width > 0 && rect.height > 0) {
        x = box.left + rect.left + rect.width / 2;
        y = box.top + rect.top;
      }
      openMenu(x, y, quote, location);
      return true;
    }

    function applyAnnotations() {
      if (plain) {
        plainBody.textContent = plainSource;
        marks.forEach(function (m) { if (m.quote) paintQuote(plainBody, m.quote, m.color); });
        return;
      }
      if (!view || !view.addAnnotation) return;
      marks.forEach(function (m) {
        if (m.location && m.location.indexOf('quote:') !== 0) view.addAnnotation({ value: m.location }).catch(function () {});
      });
    }

    function loadMarks(folder) {
      var gen = ++marksGen;
      folderFiles = [];
      if (!folder) { marks = []; applyAnnotations(); return Promise.resolve(); }
      return apiSend('/api/files/').then(function (r) {
        if (!r.ok) return null;
        return r.json();
      }).then(function (tree) {
        if (gen !== marksGen || !tree) return null;
        var files = collectFiles(findNode(tree, 'Reading/' + folder), []);
        folderFiles = files.map(function (f) { return f.name || ''; });
        var md = files.filter(function (f) { return /\.md$/i.test(f.path || ''); });
        return Promise.all(md.map(function (f) {
          return apiSend('/api/files/content?path=' + encodeURIComponent(f.path)).then(function (r) {
            if (!r.ok) return null;
            return r.json().then(function (j) {
              var content = j && typeof j.content === 'string' ? j.content : '';
              var kind = fmValue(content, 'type');
              if (kind === 'book') return null;
              var isMark = kind === 'highlight' || kind === 'book-note' || /\/Highlight\.md$/i.test(f.path) || firstQuote(content);
              if (!isMark) return null;
              var color = fmValue(content, 'color');
              if (!COLORS.some(function (c) { return c.id === color; })) color = 'yellow';
              return {
                quote: firstQuote(content),
                location: fmValue(content, 'location'),
                color: color,
                path: f.path,
                note: noteBodyText(content)
              };
            });
          }).catch(function () { return null; });
        }));
      }).then(function (list) {
        if (gen !== marksGen || !list) return;
        marks = list.filter(Boolean);
        applyAnnotations();
      }).catch(function () {});
    }

    function ensureBookHub(bookTitle, bookAuthor, sourcePath) {
      var hubPath = 'Reading/' + safeName(bookTitle, 120) + '.md';
      return apiSend('/api/files/content?path=' + encodeURIComponent(hubPath)).then(function (r) {
        if (r.ok) return hubPath;
        var parts = nowParts();
        var body = [
          '---',
          'tags:',
          '  - book',
          '  - book/' + slug(bookTitle),
          'type: book',
          'book: ' + yq(bookTitle),
          bookAuthor ? 'author: ' + yq(bookAuthor) : null,
          'created: ' + parts.when.toISOString(),
          'date: ' + parts.day,
          'source: ' + yq(sourcePath),
          '---',
          '',
          '# ' + bookTitle,
          '',
          bookAuthor ? 'By ' + bookAuthor : null,
          '',
          'Highlights and notes from this book link here for the graph.',
          ''
        ].filter(function (l) { return l !== null; }).join('\n');
        return apiSend('/api/files/folder', { method: 'POST', body: JSON.stringify({ path: 'Reading' }) }).then(function () {
          return apiSend('/api/files/content', { method: 'PUT', body: JSON.stringify({ path: hubPath, content: body }) });
        }).then(function (w) {
          if (!w.ok) throw new Error('Could not save');
          return hubPath;
        });
      });
    }

    function uniqueHighlightPath(bookDir, quote) {
      var head = safeName(String(quote || '').replace(/\s+/g, ' ').slice(0, 72), 72) || 'Passage';
      var taken = {};
      folderFiles.forEach(function (name) { taken[String(name || '').toLowerCase()] = 1; });
      var name = head + '.md';
      for (var i = 2; taken[name.toLowerCase()]; i++) name = safeName(head + ' ' + i, 72) + '.md';
      return bookDir + '/' + name;
    }

    function writePassage(color, note) {
      if (!menu || !path || saving) return;
      saving = true;
      var quote = menu.quote;
      var location = menu.location;
      var existing = menu.existing;
      var bookTitle = title || 'Book';
      var bookDir = 'Reading/' + safeName(bookTitle, 120);
      var parts = nowParts();
      var filePath = (existing && existing.path) || '';
      var oldPath = filePath;
      if (filePath && /\/Highlight\.md$/i.test(filePath)) filePath = '';
      var thought = String(note || '').trim();
      var body = [
        '---',
        'tags:',
        '  - book',
        '  - book/' + slug(bookTitle),
        'book: ' + yq(bookTitle),
        author ? 'author: ' + yq(author) : null,
        'type: ' + (thought ? 'book-note' : 'highlight'),
        'color: ' + color,
        'created: ' + parts.when.toISOString(),
        'date: ' + parts.day,
        'source: ' + yq(path),
        location ? 'location: ' + yq(location) : null,
        '---',
        '',
        String(quote || '').split(/\r?\n/).map(function (l) { return '> ' + l; }).join('\n'),
        '',
        '[[' + bookTitle + ']]',
        '',
        thought,
        ''
      ].filter(function (l) { return l !== null; }).join('\n');
      ensureBookHub(bookTitle, author, path).then(function () {
        if (filePath) return;
        return apiSend('/api/files/folder', { method: 'POST', body: JSON.stringify({ path: 'Reading' }) }).then(function () {
          return apiSend('/api/files/folder', { method: 'POST', body: JSON.stringify({ path: bookDir }) });
        }).then(function () { filePath = uniqueHighlightPath(bookDir, quote); });
      }).then(function () {
        return apiSend('/api/files/content', { method: 'PUT', body: JSON.stringify({ path: filePath, content: body }) });
      }).then(function (r) {
        if (!r || !r.ok) throw new Error('Could not save');
        if (oldPath && /\/Highlight\.md$/i.test(oldPath) && oldPath !== filePath) {
          var oldDir = oldPath.replace(/\/Highlight\.md$/i, '');
          return apiSend('/api/files/?path=' + encodeURIComponent(oldDir + '/Note.md'), { method: 'DELETE' }).catch(function () {}).then(function () {
            return apiSend('/api/files/?path=' + encodeURIComponent(oldPath), { method: 'DELETE' });
          }).catch(function () {}).then(function () {
            return apiSend('/api/files/?path=' + encodeURIComponent(oldDir), { method: 'DELETE' });
          }).catch(function () {});
        }
      }).then(function () {
        if (location && location.indexOf('quote:') !== 0 && view && view.addAnnotation) {
          view.addAnnotation({ value: location }).catch(function () {});
        }
        closeMenu();
        return loadMarks(safeName(bookTitle, 120));
      }).catch(function (e) {
        toast((e && e.message) || 'Could not save');
      }).then(function () { saving = false; });
    }

    function removePassage() {
      if (!menu || !menu.existing || saving) return;
      saving = true;
      var mark = menu.existing;
      var loc = mark.location;
      var chain;
      if (/\/Highlight\.md$/i.test(mark.path)) {
        var dir = mark.path.replace(/\/Highlight\.md$/i, '');
        chain = apiSend('/api/files/?path=' + encodeURIComponent(dir + '/Note.md'), { method: 'DELETE' }).catch(function () {}).then(function () {
          return apiSend('/api/files/?path=' + encodeURIComponent(mark.path), { method: 'DELETE' });
        }).then(function (r) {
          if (r && !r.ok) throw new Error('Could not remove');
          return apiSend('/api/files/?path=' + encodeURIComponent(dir), { method: 'DELETE' }).catch(function () {});
        });
      } else {
        chain = apiSend('/api/files/?path=' + encodeURIComponent(mark.path), { method: 'DELETE' }).then(function (r) {
          if (!r.ok) throw new Error('Could not remove');
        });
      }
      chain.then(function () {
        if (loc && loc.indexOf('quote:') !== 0 && view && view.deleteAnnotation) view.deleteAnnotation({ value: loc }).catch(function () {});
        closeMenu();
        return loadMarks(safeName(title, 120));
      }).catch(function (e) {
        toast((e && e.message) || 'Could not remove');
      }).then(function () { saving = false; });
    }

    function copyQuote(text) {
      var done = function () { toast('Passage copied to clipboard'); };
      var fail = function () { toast('Could not copy to clipboard'); };
      var fallback = function () {
        try {
          var ta = document.createElement('textarea');
          ta.value = text;
          ta.setAttribute('readonly', '');
          ta.style.position = 'fixed';
          ta.style.opacity = '0';
          document.body.appendChild(ta);
          ta.focus();
          ta.select();
          var ok = document.execCommand('copy');
          ta.remove();
          if (ok) done(); else fail();
        } catch (e) { fail(); }
      };
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, fallback);
      else fallback();
    }

    function onMenuClick(e) {
      var b = e.target && e.target.closest && e.target.closest('[data-act]');
      if (!b || !menu) return;
      var act = b.getAttribute('data-act');
      if (act === 'color') {
        menu.color = b.getAttribute('data-color') || 'yellow';
        var dots = $('book-menu').querySelectorAll('.book-swatches button');
        for (var i = 0; i < dots.length; i++) dots[i].classList.toggle('on', dots[i] === b);
        if (!menu.noting) writePassage(menu.color, menu.draft);
        return;
      }
      if (act === 'define') { var q1 = menu.quote; closeMenu(); openDict(q1); return; }
      if (act === 'explore') { var q2 = menu.quote; closeMenu(); openGrok(q2); return; }
      if (act === 'note') { menu.noting = true; renderMenu(); return; }
      if (act === 'copy') { var q3 = menu.quote; closeMenu(); copyQuote(q3); return; }
      if (act === 'remove') { removePassage(); return; }
      if (act === 'close') closeMenu();
    }

    function wireChrome() {
      if (menuWired) return;
      menuWired = true;
      var el = $('book-menu');
      var lookup = $('lookup');
      if (el) {
        el.addEventListener('mousedown', function (e) {
          if (e.target.closest && e.target.closest('textarea, input')) return;
          e.preventDefault();
        });
        el.addEventListener('contextmenu', function (e) { e.preventDefault(); });
        el.addEventListener('click', onMenuClick);
        el.addEventListener('input', function (e) {
          if (e.target && e.target.id === 'note-draft' && menu) menu.draft = e.target.value;
        });
        el.addEventListener('submit', function (e) {
          e.preventDefault();
          if (!menu) return;
          var draft = el.querySelector('#note-draft');
          if (draft) menu.draft = draft.value;
          writePassage(menu.color, menu.draft);
        });
      }
      if (lookup) {
        lookup.addEventListener('mousedown', function (e) { if (e.target === lookup) closeLookup(); });
        lookup.addEventListener('contextmenu', function (e) { e.preventDefault(); });
      }
      var x = $('lookup-x');
      if (x) x.addEventListener('click', closeLookup);
      var body = $('lookup-body');
      if (body) body.addEventListener('click', function (e) {
        if (lookupMode !== 'grokipedia') return;
        var a = e.target && e.target.closest && e.target.closest('.gk-link[data-grok]');
        if (!a) return;
        e.preventDefault();
        openGrok(a.getAttribute('data-grok') || '');
      });
      document.addEventListener('mousedown', function (e) {
        if (e.button !== 0) return;
        if (e.target.closest && e.target.closest('#book-menu, #lookup')) return;
        closeMenu();
      });
      document.addEventListener('mouseup', function (e) {
        if (e.button !== 0 || !plain) return;
        if (e.target.closest && e.target.closest('#book-menu, #lookup')) return;
        selectionIn(document, null, e.clientX, e.clientY);
      });
      document.addEventListener('contextmenu', function (e) {
        if (!plain) return;
        if (e.target.closest && e.target.closest('#book-menu, #lookup')) return;
        if (selectionIn(document, null, e.clientX, e.clientY)) e.preventDefault();
      });
      document.addEventListener('selectionchange', function () {
        if (!plain || lookupOpen() || (menu && menu.noting)) return;
        var sel = document.getSelection();
        if (!sel || String(sel.toString() || '').trim().length < 2) return;
        clearTimeout(plainSelTimer);
        plainSelTimer = setTimeout(function () { selectionIn(document, null); }, 220);
      });
      window.addEventListener('resize', function () { if (menu) placeMenu(); });
    }

    wireChrome();

    btnPrev.addEventListener('click', function () { go(-1); });
    btnNext.addEventListener('click', function () { go(1); });
    btnChapters.addEventListener('click', toggleChapters);
    document.addEventListener('keydown', onKey, true);
    window.addEventListener('pagehide', function () { saveNow(); beat(false); });
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'visible') lastPageAt = Date.now();
    });
    progressEl.addEventListener('click', function (e) {
      if (!view || plain) return;
      var r = progressEl.getBoundingClientRect();
      var frac = r.width ? (e.clientX - r.left) / r.width : 0;
      frac = Math.max(0, Math.min(1, frac));
      view.goToFraction(frac).catch(function () {});
    });
    var resizeT = 0;
    window.addEventListener('resize', function () {
      clearTimeout(resizeT);
      resizeT = setTimeout(applyStyles, 150);
    });
    window.addEventListener('message', function (e) {
      if (!PARENTS[e.origin] || !e.data || e.data.type !== 'jr-modal-flush') return;
      var id = e.data.id;
      saveNow().then(function () {
        post({ type: 'jr-modal-flushed', id: id, ok: true, changed: dirty });
      });
    });

    if (!path) {
      fail('This page only opens one book from the shelf.');
      return;
    }

    setTitle(safeName(decodeURIComponent(path.split('/').pop() || 'Book').replace(/\.[^.]+$/, '').split(' -- ')[0], 120));
    renderToc([]);

    fetch('/api/reading-state?path=' + encodeURIComponent(path), { credentials: 'include' })
      .then(function (r) {
        if (r.status === 401) throw Object.assign(new Error('sign-in'), { code: 401 });
        return r.ok ? r.json() : null;
      })
      .then(function (remote) { return openFile(remote || null); })
      .catch(function (err) {
        if (err && err.code === 401) fail('Sign in on the Mind tab, then open the book again.');
        else fail((err && err.message) || 'This book did not open.');
      });

    function openFile(remote) {
      var name = path.split('/').pop() || 'book';
      var textish = /\.(txt|text|md|markdown)$/i.test(name);
      return fetch('/api/files/content?path=' + encodeURIComponent(path), { credentials: 'include' })
        .then(function (r) {
          if (r.status === 401) throw Object.assign(new Error('sign-in'), { code: 401 });
          if (!r.ok) throw new Error('The book file did not load.');
          var ct = r.headers.get('content-type') || '';
          if (ct.indexOf('application/json') !== -1 || textish && ct.indexOf('text/html') === -1 && ct.indexOf('octet-stream') === -1 && ct.indexOf('pdf') === -1) {
            return r.json().then(function (j) { return { text: j && typeof j.content === 'string' ? j.content : '' }; });
          }
          return r.blob().then(function (blob) {
            if (textish) return blob.text().then(function (t) { return { text: t }; });
            return { file: new File([blob], name, { type: blob.type || 'application/octet-stream' }) };
          });
        })
        .then(function (got) {
          if (got.text != null) return openPlain(got.text, remote);
          return openFoliate(got.file, remote);
        });
    }

    function openPlain(text, remote) {
      plain = true;
      plainEl.hidden = false;
      plainSource = text || '';
      plainBody.textContent = plainSource;
      var savedTop = 0;
      try { savedTop = Number(localStorage.getItem('jr-book-scroll:' + path) || '0') || 0; } catch (e) {}
      var useFrac = remote && typeof remote.fraction === 'number' && (remote.updatedAt || 0) > localAt(path);
      requestAnimationFrame(function () {
        if (useFrac) {
          var span = Math.max(0, plainEl.scrollHeight - plainEl.clientHeight);
          plainEl.scrollTop = span * remote.fraction;
        } else {
          plainEl.scrollTop = savedTop;
        }
        var span2 = Math.max(1, plainEl.scrollHeight - plainEl.clientHeight);
        paintProgress(plainEl.scrollTop / span2, '');
        enable();
        loadMarks(safeName(title, 120));
      });
      plainEl.addEventListener('scroll', function () {
        var span = Math.max(1, plainEl.scrollHeight - plainEl.clientHeight);
        paintProgress(plainEl.scrollTop / span, '');
        cfi = '';
        scheduleSave();
        if (menu && !menu.noting) closeMenu();
      });
    }

    function openFoliate(file, remote) {
      return import('/foliate/view.js').then(function () {
        return import('/foliate/overlayer.js').then(function (over) {
          Highlight = over && over.Overlayer && over.Overlayer.highlight;
        }).catch(function () { Highlight = null; });
      }).then(function () {
        var saved = '';
        try { saved = localStorage.getItem('jr-book:' + path) || ''; } catch (e) { saved = ''; }
        if (saved.indexOf('epubcfi(') !== 0) saved = '';
        var remoteFrac = remote && typeof remote.fraction === 'number' ? remote.fraction : 0;
        if (remote && typeof remote.cfi === 'string' && remote.cfi.indexOf('epubcfi(') === 0 && (remote.updatedAt || 0) > localAt(path)) {
          saved = remote.cfi;
        }
        view = document.createElement('foliate-view');
        stage.appendChild(view);
        view.addEventListener('relocate', onRelocate);
        view.addEventListener('load', function (ev) {
          var doc = ev.detail && ev.detail.doc;
          var index = ev.detail && ev.detail.index;
          if (doc) bindDoc(doc, index);
        });
        view.addEventListener('draw-annotation', function (ev) {
          var detail = (ev && ev.detail) || {};
          var value = detail.annotation && detail.annotation.value;
          if (!detail.draw || !Highlight) return;
          var color = COLORS[0].value;
          for (var i = 0; i < marks.length; i++) {
            if (marks[i].location === value) color = colorValue(marks[i].color);
          }
          detail.draw(Highlight, { color: color });
        });
        view.addEventListener('show-annotation', function (ev) {
          var value = ev.detail && ev.detail.value;
          var hit = null;
          for (var i = 0; i < marks.length; i++) if (marks[i].location === value) hit = marks[i];
          openMenu(window.innerWidth / 2, 88, (hit && hit.quote) || '', value || '');
        });
        view.addEventListener('external-link', function (ev) { ev.preventDefault(); });
        setStatus('Opening the book');
        return view.open(file).then(function () {
          var meta = textOf(view.book && view.book.metadata && view.book.metadata.title);
          if (meta) setTitle(meta);
          author = textOf(view.book && view.book.metadata && view.book.metadata.author);
          renderToc(flattenToc(view.book && view.book.toc));
          applyStyles();
          return view.init({ lastLocation: saved || undefined, showTextStart: !saved }).catch(function () {
            if (remoteFrac > 0.001) return view.goToFraction(remoteFrac);
          });
        }).then(function () {
          applyStyles();
          enable();
          try { stage.setAttribute('tabindex', '-1'); stage.focus({ preventScroll: true }); } catch (e) {}
          return loadMarks(safeName(title, 120));
        });
      });
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
