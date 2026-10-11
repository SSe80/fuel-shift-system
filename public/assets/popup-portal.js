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
  function installScopedDetailModalLayout() {
    if (document.getElementById('scoped-detail-modal-layout')) return;
    var style = document.createElement('style');
    style.id = 'scoped-detail-modal-layout';
    style.textContent = [
      /* Only the four requested dialogs: the card follows the backdrop in the real DOM. */
      'body.attendant-dashboard-page #takeover-details-modal.modal.open, body.attendant-dashboard-page #admin-sale-history-details.modal.open, body.admin-sales-page #admin-sale-review-modal.modal.open, body.admin-sales-page #admin-sale-history-details.modal.open, body.admin-sales-history-page #admin-sale-history-details.modal.open { position:fixed!important; inset:0!important; width:100vw!important; height:100vh!important; height:100dvh!important; max-width:100vw!important; max-height:100dvh!important; margin:0!important; padding:max(8px,env(safe-area-inset-top)) 8px max(8px,env(safe-area-inset-bottom))!important; display:flex!important; flex-direction:row!important; align-items:flex-start!important; justify-content:center!important; gap:0!important; overflow-x:hidden!important; overflow-y:auto!important; box-sizing:border-box!important; overscroll-behavior:contain!important; -webkit-overflow-scrolling:touch!important; }',
      'body.attendant-dashboard-page #takeover-details-modal.modal.open > .modal-backdrop, body.attendant-dashboard-page #admin-sale-history-details.modal.open > .modal-backdrop, body.admin-sales-page #admin-sale-review-modal.modal.open > .modal-backdrop, body.admin-sales-page #admin-sale-history-details.modal.open > .modal-backdrop, body.admin-sales-history-page #admin-sale-history-details.modal.open > .modal-backdrop { position:fixed!important; inset:0!important; z-index:0!important; }',
      'body.attendant-dashboard-page #takeover-details-modal.modal.open > .modal-backdrop + .modal-card, body.attendant-dashboard-page #admin-sale-history-details.modal.open > .modal-backdrop + .modal-card, body.admin-sales-page #admin-sale-review-modal.modal.open > .modal-backdrop + .modal-card, body.admin-sales-page #admin-sale-history-details.modal.open > .modal-backdrop + .modal-card, body.admin-sales-history-page #admin-sale-history-details.modal.open > .modal-backdrop + .modal-card { position:relative!important; inset:auto!important; top:auto!important; right:auto!important; bottom:auto!important; left:auto!important; transform:none!important; z-index:1!important; flex:0 0 auto!important; align-self:center!important; width:min(620px,100%)!important; min-width:0!important; max-width:620px!important; height:auto!important; min-height:0!important; max-height:calc(100dvh - max(16px,env(safe-area-inset-top) + env(safe-area-inset-bottom)))!important; margin:0!important; padding:0!important; display:flex!important; flex-direction:column!important; overflow:hidden!important; box-sizing:border-box!important; }',
      'body.attendant-dashboard-page #takeover-details-modal.modal.open > .modal-backdrop + .modal-card > .top, body.attendant-dashboard-page #admin-sale-history-details.modal.open > .modal-backdrop + .modal-card > .top, body.admin-sales-page #admin-sale-review-modal.modal.open > .modal-backdrop + .modal-card > .top, body.admin-sales-page #admin-sale-history-details.modal.open > .modal-backdrop + .modal-card > .top, body.admin-sales-history-page #admin-sale-history-details.modal.open > .modal-backdrop + .modal-card > .top { position:relative!important; top:auto!important; flex:0 0 auto!important; min-width:0!important; }',
      'body.attendant-dashboard-page #takeover-details-modal.modal.open #takeover-details-content, body.attendant-dashboard-page #admin-sale-history-details.modal.open #admin-sale-history-details-content, body.admin-sales-page #admin-sale-review-modal.modal.open #admin-sale-review-content, body.admin-sales-page #admin-sale-history-details.modal.open #admin-sale-history-details-content, body.admin-sales-history-page #admin-sale-history-details.modal.open #admin-sale-history-details-content { flex:1 1 auto!important; min-height:0!important; max-height:none!important; overflow-x:hidden!important; overflow-y:auto!important; -webkit-overflow-scrolling:touch!important; overscroll-behavior:contain!important; box-sizing:border-box!important; }',
      'body.attendant-dashboard-page #takeover-details-modal.modal.open > .modal-backdrop + .modal-card > .row, body.admin-sales-page #admin-sale-review-modal.modal.open > .modal-backdrop + .modal-card > .row { flex:0 0 auto!important; }',
      '@media(max-width:640px){ body.attendant-dashboard-page #takeover-details-modal.modal.open, body.attendant-dashboard-page #admin-sale-history-details.modal.open, body.admin-sales-page #admin-sale-review-modal.modal.open, body.admin-sales-page #admin-sale-history-details.modal.open, body.admin-sales-history-page #admin-sale-history-details.modal.open { padding:max(8px,env(safe-area-inset-top)) 8px max(8px,env(safe-area-inset-bottom))!important; } body.attendant-dashboard-page #takeover-details-modal.modal.open > .modal-backdrop + .modal-card, body.attendant-dashboard-page #admin-sale-history-details.modal.open > .modal-backdrop + .modal-card, body.admin-sales-page #admin-sale-review-modal.modal.open > .modal-backdrop + .modal-card, body.admin-sales-page #admin-sale-history-details.modal.open > .modal-backdrop + .modal-card, body.admin-sales-history-page #admin-sale-history-details.modal.open > .modal-backdrop + .modal-card { width:100%!important; max-width:620px!important; max-height:calc(100dvh - max(16px,env(safe-area-inset-top) + env(safe-area-inset-bottom)))!important; } }'
    ].join('\\n');
    document.head.appendChild(style);
  }
  function start() {
    if (!document.body || !document.body.classList.contains('admin-control-ui')) return;
    liftAll(document);
    installScopedDetailModalLayout();
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
