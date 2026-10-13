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

/* Samsung swipe and voice commit with a composition key. Enter-to-send must not
   cancel it. Stopping the key before it reaches the field also drops the word. */
(function () {
  var css = document.createElement("style");
  css.textContent = "@media (hover:none) and (pointer:coarse),(max-width:900px){" +
    "textarea,input,select,.cm-content,[contenteditable=true]{font-size:16px!important;}" +
    "textarea,input,.cm-editor,.cm-content,.cm-scroller,[contenteditable=true]{" +
    "backdrop-filter:none!important;-webkit-backdrop-filter:none!important;opacity:1!important;}}";
  (document.head || document.documentElement).appendChild(css);
  function plainField(el) {
    if (!el) return false;
    if (el.tagName === "TEXTAREA") return true;
    if (el.tagName !== "INPUT") return false;
    var t = el.type || "text";
    return t === "text" || t === "search" || t === "email" || t === "url";
  }
  function letImeThrough(e) {
    if (!(e.isComposing || e.keyCode === 229)) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (!plainField(e.target) && !(e.target && e.target.isContentEditable)) return;
    e.preventDefault = function () {};
  }
  document.addEventListener("keydown", letImeThrough, true);
  document.addEventListener("keyup", letImeThrough, true);
  document.addEventListener("beforeinput", function (e) {
    var t = e.inputType || "";
    if (t !== "insertCompositionText" && t !== "insertFromComposition" && t !== "deleteCompositionText" && t !== "insertReplacementText") return;
    if (!plainField(e.target)) return;
    e.preventDefault = function () {};
  }, true);
  document.addEventListener("focusin", function (e) {
    var el = e.target;
    if (!plainField(el)) return;
    if (!window.matchMedia("(hover: none) and (pointer: coarse), (max-width: 900px)").matches) return;
    el.spellcheck = true;
    el.setAttribute("autocorrect", "on");
    if (!el.getAttribute("autocapitalize") || el.getAttribute("autocapitalize") === "off") {
      el.setAttribute("autocapitalize", "sentences");
    }
    if (el.getAttribute("autocomplete") === "off") el.setAttribute("autocomplete", "on");
  }, true);
})();
