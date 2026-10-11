/* Popups are moved to the top level of the page (direct children of <body>).
   A fixed popup nested inside a layout wrapper can be offset by that wrapper's transforms,
   filters, containment or scroll position; at the top level it is always anchored to the screen.
   Only elements with the class "modal" are moved. Their ids, classes and click handlers are unchanged. */
(function () {
  'use strict';
  function lift(el) {
    if (el && el.nodeType === 1 && el.classList.contains('modal') && el.parentElement !== document.body) {
      document.body.appendChild(el);
    }
  }
  function liftAll(root) {
    if (!root || !root.querySelectorAll) return;
    root.querySelectorAll('.modal').forEach(lift);
  }
  function start() {
    if (!document.body || !document.body.classList.contains('admin-control-ui')) return;
    liftAll(document);
    new MutationObserver(function (records) {
      records.forEach(function (r) {
        r.addedNodes.forEach(function (n) {
          if (n.nodeType !== 1) return;
          lift(n);
          liftAll(n);
        });
      });
    }).observe(document.body, { childList: true, subtree: true });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
