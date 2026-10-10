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

  /* Dispenser cards: turn the one-line summary into status + chips.
     Source text (from app.js) looks like:
       "Active • 2 nozzle(s) • Shift active — Mohammed"  */
  function enhanceDispensers(root) {
    var cards = root.querySelectorAll('.activated-dispenser-card:not([data-ui])');
    for (var i = 0; i < cards.length; i++) {
      var card = cards[i];
      card.setAttribute('data-ui', '1');
      var small = card.querySelector('small');
      if (!small) continue;
      var parts = small.textContent.split(' • ').map(function (x) { return x.trim(); });
      var status = (parts[0] || '').toLowerCase();
      var nozzles = parts[1] || '';
      var shift = parts.slice(2).join(' • ');
      var active = status.indexOf('active') === 0;
      var state = active ? 'active' : 'idle';
      var shiftOn = /shift active/i.test(shift);
      var who = shiftOn ? shift.replace(/^.*—\s*/, '') : 'No shift';

      var pill = document.createElement('span');
      pill.className = 'ac-status ac-status--' + state;
      pill.textContent = active ? 'Online' : 'Offline';
      card.insertBefore(pill, card.firstChild);

      var chips = document.createElement('div');
      chips.className = 'ac-chips';
      var nz = parseInt(nozzles, 10);
      chips.appendChild(chip(isNaN(nz) ? nozzles : (nz + (nz === 1 ? ' nozzle' : ' nozzles'))));
      var sc = chip(who, shiftOn ? 'on' : 'off');
      chips.appendChild(sc);
      small.style.display = 'none';
      card.appendChild(chips);
    }
  }
  function chip(text, mod) {
    var c = document.createElement('span');
    c.className = 'ac-chip' + (mod ? ' ac-chip--' + mod : '');
    c.textContent = text;
    return c;
  }

  function hexToRgb(hex) {
    var m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
    if (!m) return null;
    var n = parseInt(m[1], 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  function luminance(hex) {
    var c = hexToRgb(hex);
    if (!c) return 0;
    return (0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]) / 255;
  }
  function darken(hex, f) {
    var c = hexToRgb(hex);
    if (!c) return null;
    return '#' + c.map(function (v) {
      return ('0' + Math.round(v * f).toString(16)).slice(-2);
    }).join('');
  }

  /* Dispenser graphs: add a soft area under each line and emphasise the latest point. */
  var SVGNS = 'http://www.w3.org/2000/svg';
  function enhanceCharts(root) {
    var svgs = root.querySelectorAll('.activated-dispenser-graph svg:not([data-ui])');
    for (var i = 0; i < svgs.length; i++) {
      var svg = svgs[i];
      svg.setAttribute('data-ui', '1');
      var poly = svg.querySelector('polyline');
      if (!poly) continue;
      var pts = (poly.getAttribute('points') || '').trim().split(/\s+/).filter(Boolean);
      if (pts.length < 2) continue;
      var axis = svg.querySelector('.activated-dispenser-graph-axis');
      var base = axis ? parseFloat(axis.getAttribute('y1')) : null;
      if (base === null || isNaN(base)) continue;
      var first = pts[0].split(','), last = pts[pts.length - 1].split(',');
      var d = 'M' + first[0] + ',' + base;
      for (var j = 0; j < pts.length; j++) d += ' L' + pts[j];
      d += ' L' + last[0] + ',' + base + ' Z';
      var area = document.createElementNS(SVGNS, 'path');
      area.setAttribute('d', d);
      area.setAttribute('class', 'ac-area');
      area.setAttribute('fill', poly.getAttribute('stroke') || '#2563eb');
      poly.parentNode.insertBefore(area, poly);
      poly.setAttribute('stroke-width', '2.6');
      /* Pale product colours (e.g. yellow) vanish on white: draw the line in a
         darker shade of the same hue. The area keeps the original colour. */
      var stroke = poly.getAttribute('stroke') || '';
      var dark = darken(stroke, 0.72);
      if (dark && luminance(stroke) > 0.6) {
        poly.setAttribute('stroke', dark);
        var sdots = svg.querySelectorAll('circle');
        for (var k = 0; k < sdots.length; k++) sdots[k].setAttribute('fill', dark);
      }
      var dots = svg.querySelectorAll('circle');
      if (dots.length) {
        var lastDot = dots[dots.length - 1];
        lastDot.setAttribute('r', '4.5');
        lastDot.setAttribute('class', 'ac-last-dot');
        lastDot.setAttribute('stroke', '#ffffff');
        lastDot.setAttribute('stroke-width', '2');
      }
    }
  }

  /* ---- Admin settings: section accents, counts, summary, item avatars and status ---- */
  var SETTINGS_ACCENT = {
    'ACCESS': '#2563eb', 'FUEL CATALOG': '#d97706', 'STORAGE': '#0891b2',
    'FORECOURT': '#059669', 'SALES': '#7c3aed'
  };
  function settingsInitials(name) {
    var parts = String(name || '').trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return '?';
    var a = parts[0].charAt(0), b = parts.length > 1 ? parts[parts.length - 1].charAt(0) : '';
    return (a + b).toUpperCase();
  }
  function enhanceSettings(root) {
    if (!document.body || !document.body.classList.contains('admin-settings-page')) return;
    var sections = root.querySelectorAll('.settings-section');
    var summary = [];
    for (var i = 0; i < sections.length; i++) {
      var sec = sections[i];
      if (sec.classList.contains('operational-reset-card')) continue;
      var kickerEl = sec.querySelector('.section-kicker');
      var kicker = kickerEl ? kickerEl.textContent.trim().toUpperCase() : '';
      var accent = SETTINGS_ACCENT[kicker];
      if (accent && sec.style.getPropertyValue('--accent') !== accent) sec.style.setProperty('--accent', accent);
      var items = sec.querySelectorAll('.settings-item-card');
      var n = items.length;
      var titleEl = sec.querySelector('.section-heading h2');
      var title = titleEl ? titleEl.textContent.trim() : kicker;
      // count badge next to the section title
      if (titleEl) {
        var chip = titleEl.parentNode.querySelector('.si-count');
        if (!chip) { chip = document.createElement('span'); chip.className = 'si-count'; (kickerEl || titleEl).insertAdjacentElement('afterend', chip); }
        var label = n + (n === 1 ? ' item' : ' items');
        if (chip.textContent !== label) chip.textContent = label;
      }
      summary.push({ title: title, n: n, accent: accent || '#2563eb' });
      // items: initials avatar and status chip
      for (var j = 0; j < items.length; j++) {
        var it = items[j];
        if (it.getAttribute('data-si') === '1') continue;
        it.setAttribute('data-si', '1');
        var nameEl = it.querySelector('.top b');
        var top = it.querySelector('.top');
        if (top && nameEl) {
          var av = document.createElement('span');
          av.className = 'si-avatar';
          av.setAttribute('aria-hidden', 'true');
          av.textContent = settingsInitials(nameEl.textContent);
          top.insertBefore(av, top.firstChild);
        }
        var details = it.querySelector('.settings-card-details');
        if (details && top) {
          var m = /Status:\s*([A-Za-z]+)/.exec(details.textContent || '');
          if (m) {
            var on = /^activ/i.test(m[1]);
            var st = document.createElement('span');
            st.className = 'si-status' + (on ? ' is-on' : '');
            st.textContent = on ? 'Active' : 'Inactive';
            top.appendChild(st);
          }
        }
      }
    }
    // summary strip above the first section
    var first = sections[0];
    if (first && first.parentNode) {
      var strip = first.parentNode.querySelector('.si-summary');
      if (!strip) {
        strip = document.createElement('div');
        strip.className = 'si-summary';
        first.parentNode.insertBefore(strip, first);
      }
      var html = summary.map(function (x) {
        return '<span class="si-summary-chip"><i style="--accent:' + x.accent + '"></i>' + x.title.replace(/</g, '&lt;') + ' <b style="--accent:' + x.accent + '">' + x.n + '</b></span>';
      }).join('');
      if (strip.getAttribute('data-html') !== html) { strip.innerHTML = html; strip.setAttribute('data-html', html); }
    }
  }

  var scheduled = false;
  function run() {
    scheduled = false;
    tagGauges(document);
    addAvatars(document);
    enhanceDispensers(document);
    enhanceCharts(document);
    enhanceSettings(document);
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
