/* Marks the document before paint when this tab is the JR Shell client.
   The inline version of this check cannot run: script-src has no unsafe-inline. */
(function () {
  var jr = /[?&]jr=1(?:&|$)/.test(location.search);
  var electron = /\bElectron\b/.test(navigator.userAgent);
  var cookie = /(?:^|; )jr_pane=1(?:;|$)/.test(document.cookie);
  if (!jr && !electron && !cookie) return;
  document.documentElement.setAttribute("data-jr-pane", "1");
  document.cookie = "jr_pane=1; Path=/; Max-Age=31536000; SameSite=Lax";
})();

/* Samsung swipe and voice commit with a composition key. Enter-to-send must not cancel it. */
(function () {
  var css = document.createElement("style");
  css.textContent = "@media (hover:none) and (pointer:coarse),(max-width:900px){" +
    "textarea,input,select,.cm-content,[contenteditable=true]{font-size:16px!important;}" +
    "textarea,input,.cm-editor,.cm-content,.cm-scroller,[contenteditable=true]{" +
    "backdrop-filter:none!important;-webkit-backdrop-filter:none!important;}}";
  (document.head || document.documentElement).appendChild(css);
  document.addEventListener("keydown", function (e) {
    if (!(e.isComposing || e.keyCode === 229)) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    var el = e.target;
    if (!el || (el.tagName !== "TEXTAREA" && el.tagName !== "INPUT")) return;
    e.stopImmediatePropagation();
  }, true);
})();
