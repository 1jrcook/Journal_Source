/* Same-origin dynamic import. Kept out of the app bundle so the reader can
   load without eval, which the page Content-Security-Policy forbids. */
globalThis.__jrLoadModule = function (url) {
  return import(new URL(url, document.baseURI).href);
};
