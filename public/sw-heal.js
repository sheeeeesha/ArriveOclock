/* Self-heal stale code: an old build's service worker can keep serving cached
   JS inside the WebView even after the APK updates. This runs before the
   bundle — if any SW exists, unregister it, wipe caches, and reload once so
   the fresh bundled code loads. No-op (and no reload) when none exist.

   Kept as a same-origin FILE rather than inline: the site's CSP is
   script-src 'self', which blocks inline execution and logged an error on
   every web page load. */
(function () {
  try {
    if (!('serviceWorker' in navigator)) return;
    navigator.serviceWorker.getRegistrations().then(function (regs) {
      if (!regs || !regs.length) return;
      Promise.all(regs.map(function (r) { return r.unregister(); })).then(function () {
        if (window.caches && caches.keys) {
          caches.keys().then(function (ks) {
            return Promise.all(ks.map(function (k) { return caches.delete(k); }));
          }).then(function () { location.reload(); });
        } else { location.reload(); }
      });
    }).catch(function () {});
  } catch (e) {}
})();
