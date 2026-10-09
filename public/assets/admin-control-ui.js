/* Admin Control UI enhancements (presentation only).
   - Tags fill gauges with a status level (ok / warning / critical) from the
     value the existing renderer already writes to aria-valuenow.
   - Adds initials avatars to attendant cards.
   It never changes data and is safe to run repeatedly. */
(function () {
  'use strict';

  function level(pct) {
    if (pct <= 10) return 'critical';
    if (pct <= 25) return 'warning';
    return 'ok';
  }

  function initials(name) {
    var parts = String(name || '').trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return '?';
    var first = parts[0].charAt(0);
    var last = parts.length > 1 ? parts[parts.length - 1].charAt(0) : '';
    return (first + last).toUpperCase();
  }

  function tagGauges(root) {
    var bars = root.querySelectorAll('[role="progressbar"]');
    for (var i = 0; i < bars.length; i++) {
      var b = bars[i];
      var v = parseFloat(b.getAttribute('aria-valuenow'));
      if (isNaN(v)) continue;
      var l = level(v);
      if (b.getAttribute('data-level') !== l) b.setAttribute('data-level', l);
    }
  }

  function addAvatars(root) {
    var cards = root.querySelectorAll('.attendant-admin-card');
    for (var i = 0; i < cards.length; i++) {
      var card = cards[i];
      var row = card.querySelector('.attendant-content-row');
      if (!row || row.querySelector('.ac-avatar')) continue;
      var nameEl = row.querySelector('.attendant-content-main b');
      var av = document.createElement('span');
      av.className = 'ac-avatar';
      av.setAttribute('aria-hidden', 'true');
      av.textContent = initials(nameEl && nameEl.textContent);
      row.insertBefore(av, row.firstChild);
    }
  }

  var scheduled = false;
  function run() {
    scheduled = false;
    tagGauges(document);
    addAvatars(document);
  }
  function schedule() {
    if (scheduled) return;
    scheduled = true;
    window.requestAnimationFrame(run);
  }

  var observer = new MutationObserver(schedule);
  function start() {
    run();
    observer.observe(document.body, { childList: true, subtree: true });
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
})();
