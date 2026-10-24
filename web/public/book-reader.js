/* Digest book reader. One book, no journal shell. Progress uses the same
   reading-state record and local keys as the Mind reader. */
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

    function bindDoc(doc) {
      if (!doc || (bound && bound.has(doc))) return;
      if (bound) bound.add(doc);
      doc.addEventListener('keydown', onKey, true);
      doc.addEventListener('click', function (e) {
        if (e.button !== 0) return;
        var sel = doc.getSelection && doc.getSelection();
        if (sel && String(sel.toString() || '').trim()) return;
        var t = e.target;
        if (t && t.closest && t.closest('a[href], button, input, textarea')) return;
        var w = doc.documentElement.clientWidth || window.innerWidth;
        if (e.clientX < w * 0.25) go(-1);
        else if (e.clientX > w * 0.75) go(1);
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
      if (moved) scheduleSave();
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
      plainBody.textContent = text || '';
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
      });
      plainEl.addEventListener('scroll', function () {
        var span = Math.max(1, plainEl.scrollHeight - plainEl.clientHeight);
        paintProgress(plainEl.scrollTop / span, '');
        cfi = '';
        scheduleSave();
      });
    }

    function openFoliate(file, remote) {
      return import('/foliate/view.js').then(function () {
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
          if (doc) bindDoc(doc);
        });
        view.addEventListener('external-link', function (ev) { ev.preventDefault(); });
        setStatus('Opening the book');
        return view.open(file).then(function () {
          var meta = textOf(view.book && view.book.metadata && view.book.metadata.title);
          if (meta) setTitle(meta);
          renderToc(flattenToc(view.book && view.book.toc));
          applyStyles();
          return view.init({ lastLocation: saved || undefined, showTextStart: !saved }).catch(function () {
            if (remoteFrac > 0.001) return view.goToFraction(remoteFrac);
          });
        }).then(function () {
          applyStyles();
          enable();
          try { stage.setAttribute('tabindex', '-1'); stage.focus({ preventScroll: true }); } catch (e) {}
        });
      });
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
