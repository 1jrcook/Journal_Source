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
