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
      'body.attendant-dashboard-page #takeover-details-modal.modal.open, body.attendant-dashboard-page #takeover-sale-confirm-modal.modal.open, body.attendant-dashboard-page #admin-sale-history-details.modal.open, body.admin-sales-page #admin-sale-review-modal.modal.open, body.admin-sales-page #admin-sale-history-details.modal.open, body.admin-sales-history-page #admin-sale-history-details.modal.open { position:fixed!important; inset:0!important; width:100vw!important; height:100vh!important; height:100dvh!important; max-width:100vw!important; max-height:100dvh!important; margin:0!important; padding:max(8px,env(safe-area-inset-top)) 8px max(8px,env(safe-area-inset-bottom))!important; display:flex!important; flex-direction:row!important; align-items:flex-start!important; justify-content:center!important; gap:0!important; overflow-x:hidden!important; overflow-y:auto!important; box-sizing:border-box!important; overscroll-behavior:contain!important; -webkit-overflow-scrolling:touch!important; }',
      'body.attendant-dashboard-page #takeover-details-modal.modal.open > .modal-backdrop, body.attendant-dashboard-page #takeover-sale-confirm-modal.modal.open > .modal-backdrop, body.attendant-dashboard-page #admin-sale-history-details.modal.open > .modal-backdrop, body.admin-sales-page #admin-sale-review-modal.modal.open > .modal-backdrop, body.admin-sales-page #admin-sale-history-details.modal.open > .modal-backdrop, body.admin-sales-history-page #admin-sale-history-details.modal.open > .modal-backdrop { position:fixed!important; inset:0!important; z-index:0!important; }',
      'body.attendant-dashboard-page #takeover-details-modal.modal.open > .modal-backdrop + .modal-card, body.attendant-dashboard-page #takeover-sale-confirm-modal.modal.open > .modal-backdrop + .modal-card, body.attendant-dashboard-page #admin-sale-history-details.modal.open > .modal-backdrop + .modal-card, body.admin-sales-page #admin-sale-review-modal.modal.open > .modal-backdrop + .modal-card, body.admin-sales-page #admin-sale-history-details.modal.open > .modal-backdrop + .modal-card, body.admin-sales-history-page #admin-sale-history-details.modal.open > .modal-backdrop + .modal-card { position:relative!important; inset:auto!important; top:auto!important; right:auto!important; bottom:auto!important; left:auto!important; transform:none!important; z-index:1!important; flex:0 0 auto!important; align-self:flex-start!important; width:min(620px,100%)!important; min-width:0!important; max-width:620px!important; height:auto!important; min-height:0!important; max-height:calc(100dvh - max(16px,env(safe-area-inset-top) + env(safe-area-inset-bottom)))!important; margin:0!important; padding:0!important; display:flex!important; flex-direction:column!important; overflow:hidden!important; box-sizing:border-box!important; }',
      'body.attendant-dashboard-page #takeover-details-modal.modal.open > .modal-backdrop + .modal-card > .top, body.attendant-dashboard-page #takeover-sale-confirm-modal.modal.open > .modal-backdrop + .modal-card > .top, body.attendant-dashboard-page #admin-sale-history-details.modal.open > .modal-backdrop + .modal-card > .top, body.admin-sales-page #admin-sale-review-modal.modal.open > .modal-backdrop + .modal-card > .top, body.admin-sales-page #admin-sale-history-details.modal.open > .modal-backdrop + .modal-card > .top, body.admin-sales-history-page #admin-sale-history-details.modal.open > .modal-backdrop + .modal-card > .top { position:relative!important; top:auto!important; flex:0 0 auto!important; min-width:0!important; }',
      'body.attendant-dashboard-page #takeover-details-modal.modal.open #takeover-details-content, body.attendant-dashboard-page #takeover-sale-confirm-modal.modal.open #takeover-sale-confirm-content, body.attendant-dashboard-page #admin-sale-history-details.modal.open #admin-sale-history-details-content, body.admin-sales-page #admin-sale-review-modal.modal.open #admin-sale-review-content, body.admin-sales-page #admin-sale-history-details.modal.open #admin-sale-history-details-content, body.admin-sales-history-page #admin-sale-history-details.modal.open #admin-sale-history-details-content { flex:1 1 auto!important; min-height:0!important; max-height:none!important; overflow-x:hidden!important; overflow-y:auto!important; -webkit-overflow-scrolling:touch!important; overscroll-behavior:contain!important; box-sizing:border-box!important; }',
      'body.attendant-dashboard-page #takeover-details-modal.modal.open > .modal-backdrop + .modal-card > .row, body.attendant-dashboard-page #takeover-sale-confirm-modal.modal.open > .modal-backdrop + .modal-card > .row, body.admin-sales-page #admin-sale-review-modal.modal.open > .modal-backdrop + .modal-card > .row { flex:0 0 auto!important; }',
      '@media(max-width:640px){ body.attendant-dashboard-page #takeover-details-modal.modal.open, body.attendant-dashboard-page #takeover-sale-confirm-modal.modal.open, body.attendant-dashboard-page #admin-sale-history-details.modal.open, body.admin-sales-page #admin-sale-review-modal.modal.open, body.admin-sales-page #admin-sale-history-details.modal.open, body.admin-sales-history-page #admin-sale-history-details.modal.open { padding:max(8px,env(safe-area-inset-top)) 8px max(8px,env(safe-area-inset-bottom))!important; } body.attendant-dashboard-page #takeover-details-modal.modal.open > .modal-backdrop + .modal-card, body.attendant-dashboard-page #takeover-sale-confirm-modal.modal.open > .modal-backdrop + .modal-card, body.attendant-dashboard-page #admin-sale-history-details.modal.open > .modal-backdrop + .modal-card, body.admin-sales-page #admin-sale-review-modal.modal.open > .modal-backdrop + .modal-card, body.admin-sales-page #admin-sale-history-details.modal.open > .modal-backdrop + .modal-card, body.admin-sales-history-page #admin-sale-history-details.modal.open > .modal-backdrop + .modal-card { width:100%!important; max-width:620px!important; max-height:calc(100dvh - max(16px,env(safe-area-inset-top) + env(safe-area-inset-bottom)))!important; } }',
      /* The shift-history dialog has legacy card-level centering rules. Anchor this card directly to the viewport so parent flex/transform rules cannot push it halfway down. */
      'body.attendant-dashboard-page #takeover-details-modal.modal.open > .modal-backdrop + .modal-card.takeover-details-modal { position:fixed!important; top:max(8px,env(safe-area-inset-top))!important; right:auto!important; bottom:auto!important; left:50%!important; transform:translateX(-50%)!important; margin:0!important; width:min(620px,calc(100vw - 16px))!important; max-width:620px!important; max-height:calc(100dvh - max(16px,env(safe-area-inset-top) + env(safe-area-inset-bottom)))!important; }',
      'body.attendant-dashboard-page #takeover-details-modal.modal.open > .modal-backdrop + .modal-card.takeover-details-modal > #takeover-details-content { min-height:0!important; max-height:none!important; overflow-x:hidden!important; overflow-y:auto!important; }',
      /* The attendant's View Details action also renders through admin-sale-history-details; pin that card to the viewport too. */
      'body.attendant-dashboard-page #admin-sale-history-details.modal.open > .modal-backdrop + .modal-card { position:fixed!important; top:max(8px,env(safe-area-inset-top))!important; right:auto!important; bottom:auto!important; left:50%!important; transform:translateX(-50%)!important; margin:0!important; width:min(620px,calc(100vw - 16px))!important; max-width:620px!important; max-height:calc(100dvh - max(16px,env(safe-area-inset-top) + env(safe-area-inset-bottom)))!important; }',
      'body.attendant-dashboard-page #admin-sale-history-details.modal.open > .modal-backdrop + .modal-card { display:block!important; height:auto!important; min-height:0!important; max-height:calc(100dvh - max(16px,env(safe-area-inset-top) + env(safe-area-inset-bottom)))!important; overflow-x:hidden!important; overflow-y:auto!important; -webkit-overflow-scrolling:touch!important; }',
      'body.attendant-dashboard-page #admin-sale-history-details.modal.open > .modal-backdrop + .modal-card > #admin-sale-history-details-content { display:block!important; flex:none!important; height:auto!important; min-height:0!important; max-height:none!important; overflow:visible!important; touch-action:auto!important; }',
    ].join('\n');
    document.head.appendChild(style);

    /* Unified notification and confirmation popup design across Admin and Attendant panels. */
    var notificationStyle = document.createElement('style');
    notificationStyle.id = 'fuel-shift-unified-popup-theme';
    notificationStyle.textContent = [
      'body.admin-control-ui .modal > .modal-card { border:1px solid #dbe4ef!important; border-radius:20px!important; background:#fff!important; box-shadow:0 28px 80px rgba(15,23,42,.24),0 6px 20px rgba(15,23,42,.08)!important; color:#172b46!important; overflow:hidden!important; }',
      'body.admin-control-ui .modal > .modal-card > .top { padding:18px 20px 15px!important; border-bottom:1px solid #e8edf4!important; background:linear-gradient(135deg,#f8fafc 0%,#fff 72%)!important; gap:14px!important; }',
      'body.admin-control-ui .modal > .modal-card > .top h2, body.admin-control-ui .modal > .modal-card > .top h3 { color:#142238!important; font-weight:800!important; letter-spacing:-.025em!important; line-height:1.25!important; }',
      'body.admin-control-ui .modal > .modal-card .modal-close { display:inline-flex!important; align-items:center!important; justify-content:center!important; flex:0 0 38px!important; width:38px!important; height:38px!important; min-height:38px!important; border:1px solid #dce4ee!important; border-radius:12px!important; background:#fff!important; color:#526277!important; font-size:24px!important; font-weight:500!important; box-shadow:0 2px 5px rgba(16,24,40,.04)!important; }',
      'body.admin-control-ui .modal > .modal-card .modal-close:hover { background:#f1f5f9!important; color:#172b46!important; }',
      'body.admin-control-ui .modal > .modal-card .row:last-child { gap:10px!important; padding:16px 20px 20px!important; }',
      'body.admin-control-ui .modal > .modal-card .row:last-child button, body.admin-control-ui .modal > .modal-card .popup-actions button { min-height:44px!important; padding:11px 17px!important; border-radius:12px!important; font-size:14px!important; font-weight:800!important; letter-spacing:.005em!important; transition:transform .16s ease,box-shadow .16s ease,background .16s ease!important; }',
      'body.admin-control-ui .modal > .modal-card .row:last-child button:active, body.admin-control-ui .modal > .modal-card .popup-actions button:active { transform:scale(.985)!important; }',
      'body.admin-control-ui .modal > .modal-backdrop { background:rgba(15,23,42,.56)!important; -webkit-backdrop-filter:blur(4px)!important; backdrop-filter:blur(4px)!important; }',
      'body.admin-control-ui .toast { z-index:20000!important; box-sizing:border-box!important; width:min(420px,calc(100vw - 28px))!important; max-width:calc(100vw - 28px)!important; padding:15px 17px!important; border:1px solid #d8e2ef!important; border-left:5px solid #2563eb!important; border-radius:16px!important; background:#fff!important; color:#172b46!important; box-shadow:0 18px 48px rgba(15,23,42,.2)!important; font-size:14px!important; font-weight:650!important; line-height:1.5!important; }',
      'body.admin-control-ui .toast.success, body.admin-control-ui .toast.toast-success, body.admin-control-ui .toast.is-success { border-left-color:#16a34a!important; }',
      'body.admin-control-ui .toast.error, body.admin-control-ui .toast.toast-error, body.admin-control-ui .toast.is-error { border-left-color:#dc2626!important; }',
      'body.admin-control-ui .toast.warning, body.admin-control-ui .toast.toast-warning, body.admin-control-ui .toast.is-warning { border-left-color:#d97706!important; }',
      'body.admin-control-ui .toast.info, body.admin-control-ui .toast.toast-info, body.admin-control-ui .toast.is-info { border-left-color:#2563eb!important; }',
      'body.admin-control-ui .station-notification-row { border-radius:13px!important; transition:background .16s ease,border-color .16s ease,transform .16s ease!important; }',
      'body.admin-control-ui .station-notification-row:hover { background:#f8fafc!important; }',
      '@media(max-width:640px) { body.admin-control-ui .modal > .modal-card { border-radius:17px!important; } body.admin-control-ui .modal > .modal-card > .top { padding:15px 15px 13px!important; } body.admin-control-ui .modal > .modal-card .row:last-child { padding:13px 15px 15px!important; gap:8px!important; } body.admin-control-ui .modal > .modal-card .row:last-child button, body.admin-control-ui .modal > .modal-card .popup-actions button { min-height:44px!important; padding:10px 12px!important; font-size:13px!important; } body.admin-control-ui .toast { width:calc(100vw - 24px)!important; max-width:calc(100vw - 24px)!important; padding:13px 14px!important; border-radius:14px!important; } }'
    ].join('\n');
    document.head.appendChild(notificationStyle);

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
