/* Settings card: Google Drive folder links, connection test and the upload queue. */
(function () {
  'use strict';
  function $(id) { return document.getElementById(id); }
  function errText(x, status) {
    var msg;
    if (typeof x === 'string') msg = x;
    else if (x && typeof x.message === 'string') msg = x.message;
    else if (x && typeof x === 'object') { try { msg = JSON.stringify(x); } catch (e) { msg = 'unreadable error'; } }
    else msg = '';
    return (msg || 'No details returned') + (status ? ' [HTTP ' + status + ']' : '');
  }
  function say(msg, bad) { var el = $('drive-status'); if (el) { el.textContent = msg; el.style.color = bad ? '#b91c1c' : ''; } }
  async function api(url, method, body) {
    var opts = { method: method || 'GET', credentials: 'same-origin', headers: { 'X-Fuel-Role': 'admin' } };
    if (body !== undefined) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
    var r = await fetch(url, opts), j = await r.json().catch(function () { return {}; });
    return { status: r.status, body: j };
  }
  function esc(value) {
    return String(value == null ? '' : value).replace(/[&<>"]/g, function (ch) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch];
    });
  }
  function queueDetails(item) {
    var kind = item.kind, key = String(item.report_key || '');
    if (kind === 'sale') {
      var day = String(item.sales_date || key.split('|')[0] || '');
      var dateLabel = day;
      if (/^\d{4}-\d{2}-\d{2}$/.test(day)) {
        var bits = day.split('-');
        var monthNames = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
        dateLabel = monthNames[Number(bits[1]) - 1] + ' ' + String(Number(bits[2])) + ', ' + bits[0];
      }
      return {
        title: item.sales_confirmed === false ? 'Sales' : 'Confirmed sales PDF',
        meta: (item.sales_attendant || 'Attendant') + ' · ' + dateLabel
      };
    }
    return { title: kind === 'dsr' ? 'Daily Sales Report (DSR)' : 'Monthly Sales Report (MSR)', meta: key };
  }
  function addQueueStyles() {
    if ($('drive-queue-styles')) return;
    var style = document.createElement('style');
    style.id = 'drive-queue-styles';
    style.textContent = [
      '.drive-queue-list{display:grid;gap:10px}',
      '.drive-queue-row{display:flex;align-items:flex-start;justify-content:space-between;gap:14px;padding:14px 16px;border:1px solid var(--border-color,#e5e7eb);border-radius:14px;background:var(--card-bg,#fff)}',
      '.drive-queue-main{min-width:0;display:grid;gap:3px}',
      '.drive-queue-title{font-size:14px;font-weight:700;line-height:1.2;overflow-wrap:anywhere;margin:0}',
      '.drive-queue-meta{font-size:13px;line-height:1.25;color:var(--muted,#6b7280);overflow-wrap:anywhere;margin:0}',
      '.drive-queue-state{display:inline-flex;align-items:center;align-self:flex-start;max-width:100%;padding:4px 9px;border-radius:999px;font-size:11px;font-weight:700;line-height:1.35;background:#f3f4f6;color:#4b5563}',
      '.drive-queue-state.is-ready{background:#dcfce7;color:#166534}',
      '.drive-queue-state.is-waiting{background:#fef3c7;color:#92400e}',
      '.drive-queue-state.is-failed{background:#fee2e2;color:#991b1b}',
      '.drive-queue-error{font-size:12px;line-height:1.45;color:#b91c1c;overflow-wrap:anywhere}',
      '.drive-queue-action{flex:0 0 auto}',
      '@media(max-width:520px){.drive-queue-row{gap:9px;padding:12px}.drive-queue-action{font-size:12px;padding:7px 10px}}'
    ].join('');
    document.head.appendChild(style);
  }
  async function loadSettings() {
    var s = await api('/api/drive/settings');
    if (s.status !== 200) return say('Could not load Drive settings: ' + errText(s.body.error, s.status), true);
    if ($('drive-dsr-link')) $('drive-dsr-link').value = s.body.dsr_folder_id ? 'https://drive.google.com/drive/folders/' + s.body.dsr_folder_id : '';
    if ($('drive-msr-link')) $('drive-msr-link').value = s.body.msr_folder_id ? 'https://drive.google.com/drive/folders/' + s.body.msr_folder_id : '';
    if ($('drive-purchase-link')) $('drive-purchase-link').value = s.body.purchase_folder_id ? 'https://drive.google.com/drive/folders/' + s.body.purchase_folder_id : '';
    if ($('drive-sales-link')) $('drive-sales-link').value = s.body.sales_folder_id ? 'https://drive.google.com/drive/folders/' + s.body.sales_folder_id : '';
    if ($('drive-audit-link')) $('drive-audit-link').value = s.body.admin_audit_folder_id ? 'https://drive.google.com/drive/folders/' + s.body.admin_audit_folder_id : '';
    if ($('drive-audit-sheet-link')) $('drive-audit-sheet-link').value = s.body.admin_audit_sheet_id ? 'https://docs.google.com/spreadsheets/d/' + s.body.admin_audit_sheet_id + '/edit' : '';
    say('Drive links loaded.');
  }
  async function loadOAuthStatus() {
    var s = await api('/api/drive/oauth/status');
    if (s.status !== 200) return;
    var connect = $('drive-connect-btn'), disconnect = $('drive-disconnect-btn');
    if (connect) connect.textContent = s.body.connected ? 'Reconnect Google Drive' : 'Connect personal Google Drive';
    if (disconnect) disconnect.disabled = !s.body.connected;
    var p = new URLSearchParams(window.location.search), result = p.get('drive_oauth');
    if (result) {
      var messages = {
        connected: 'Personal Google Drive connected. You can now test the configured folders.',
        denied: 'Google authorization was cancelled.',
        state_error: 'Google authorization expired or could not be verified. Please connect again.',
        missing_code: 'Google did not return an authorization code. Please connect again.',
        refresh_token_missing: 'Google did not return a refresh token. Reconnect and approve access when prompted.',
        storage_error: 'Google Drive was authorized, but secure token storage failed. Check the database migration and Worker secrets.',
        oauth_error: 'Google Drive authorization failed. Check OAuth client settings and Worker secrets.',
        admin_session_required: 'Please sign in as admin and connect Google Drive again.'
      };
      say(messages[result] || 'Google Drive connection updated.', result !== 'connected');
      window.history.replaceState({}, document.title, window.location.pathname);
    } else if (s.body.connected) {
      say('Personal Google Drive is connected. DSR, MSR, confirmed shift sales, Purchases, and audit uploads will use this account.');
    } else {
      say('Connect your personal Google account before testing Drive folders.');
    }
  }
  async function saveSettings() {
    var s = await api('/api/drive/settings', 'PUT', { dsr_link: $('drive-dsr-link').value, msr_link: $('drive-msr-link').value, purchase_link: $('drive-purchase-link').value, sales_link: $('drive-sales-link').value, admin_audit_link: $('drive-audit-link').value, admin_audit_sheet_link: $('drive-audit-sheet-link').value });
    if (s.status !== 200) return say('Save failed: ' + errText(s.body.error, s.status), true);
    say('Saved. The audit log will append to the selected spreadsheet. Use "Test connection" to check folder access.');
  }
  async function testConnection() {
    say('Testing…');
    var t = await api('/api/drive/test', 'POST', {});
    if (t.body && t.body.ok) {
      if (!t.body.admin_audit_sheet_configured) return say('Folders connected. Paste and save the Admin Actions Audit spreadsheet link to enable audit logging.', true);
      return say('Connected. DSR, MSR, Sales, Purchases, and Admin Audit folders are reachable; the audit spreadsheet is configured.');
    }
    if (t.body && t.body.missing && t.body.missing.length) return say('Missing folder link for: ' + t.body.missing.join(', ').toUpperCase() + '.', true);
    say('Connection failed: ' + errText(t.body && t.body.error, t.status), true);
  }
  var reportWorkers = {};
  function maintainReportWorkers(items) {
    ['dsr', 'msr', 'sale'].forEach(function (kind) {
      var waiting = items.some(function (item) {
        return item.kind === kind && item.status === 'pending' && (item.attempts || 0) < 3;
      });
      if (waiting && !reportWorkers[kind]) {
        var frame = document.createElement('iframe');
        frame.title = 'Background ' + kind.toUpperCase() + ' PDF export';
        frame.setAttribute('aria-hidden', 'true');
        frame.tabIndex = -1;
        frame.style.cssText = 'position:fixed;left:-10000px;top:0;width:1px;height:1px;border:0;opacity:0;pointer-events:none;';
        frame.src = kind === 'dsr' ? 'admin-daily-report.html?drive-export-worker=1' : (kind === 'msr' ? 'admin-monthly-report.html?drive-export-worker=1' : 'admin-sales.html?drive-export-worker=1');
        document.body.appendChild(frame);
        reportWorkers[kind] = frame;
      } else if (!waiting && reportWorkers[kind]) {
        reportWorkers[kind].remove();
        delete reportWorkers[kind];
      }
    });
  }
  async function loadQueue() {
    var q = await api('/api/drive/queue');
    var box = $('drive-queue-list');
    if (!box) return;
    if (q.status !== 200 || !Array.isArray(q.body)) {
      var detail = q.body && (q.body.error || q.body.message);
      box.textContent = 'Queue unavailable' + (q.status ? ' (HTTP ' + q.status + ')' : '') + (detail ? ': ' + String(detail) : '.');
      return;
    }
    maintainReportWorkers(q.body);
    addQueueStyles();
    box.classList.add('drive-queue-list');
    if (!q.body.length) { box.innerHTML = '<p class="muted">Nothing waiting. Confirmed reports and handover sales are saved to Drive.</p>'; return; }
    box.innerHTML = q.body.map(function (i) {
      var details = queueDetails(i);
      var state = i.status === 'failed' ? 'Failed' :
        (i.kind === 'sale' && i.sales_confirmed === false ? 'Awaiting confirmation' :
        (i.status === 'waiting' ? 'Waiting for export readiness' : 'Ready to upload'));
      var stateClass = i.status === 'failed' ? 'is-failed' :
        (i.status === 'waiting' || (i.kind === 'sale' && i.sales_confirmed === false) ? 'is-waiting' : 'is-ready');
      var err = i.last_error ? '<div class="drive-queue-error">' + esc(i.last_error) + '</div>' : '';
      var retry = i.status === 'failed' ? '<button type="button" class="secondary drive-queue-action" data-retry="' + esc(i.id) + '">Retry</button>' : '';
      return '<div class="drive-queue-row"><div class="drive-queue-main">' +
        '<div class="drive-queue-title">' + esc(details.title) + '</div>' +
        '<div class="drive-queue-meta">' + esc(details.meta) + '</div>' +
        '<span class="drive-queue-state ' + stateClass + '">' + esc(state) + '</span>' + err +
        '</div>' + retry + '</div>';
    }).join('');
    box.querySelectorAll('[data-retry]').forEach(function (b) {
      b.addEventListener('click', async function () {
        await api('/api/drive/queue/' + encodeURIComponent(b.getAttribute('data-retry')) + '/retry', 'POST', {});
        loadQueue();
      });
    });
  }
  window.DriveSettings = { load: function () { loadSettings(); loadQueue(); }, save: saveSettings, test: testConnection };
  document.addEventListener('DOMContentLoaded', function () {
    if ($('drive-settings-section')) {
      $('drive-save-btn').addEventListener('click', saveSettings);
      $('drive-test-btn').addEventListener('click', testConnection);
      if ($('drive-connect-btn')) $('drive-connect-btn').addEventListener('click', function () { window.location.href = '/api/drive/oauth/start'; });
      if ($('drive-disconnect-btn')) $('drive-disconnect-btn').addEventListener('click', async function () {
        if (!window.confirm('Disconnect the personal Google Drive account? Future uploads will stop until you reconnect.')) return;
        var r = await api('/api/drive/oauth/disconnect', 'POST', {});
        if (r.status !== 200) return say('Could not disconnect Google Drive: ' + errText(r.body.error, r.status), true);
        await loadOAuthStatus();
      });
      window.DriveSettings.load();
      loadOAuthStatus();
      // Build confirmed sales PDFs directly in the authenticated Settings page.
      // This avoids relying on a hidden Sales-page iframe to start the sale worker.
      if (window.DriveQueue && typeof window.downloadAdminSaleHistoryDetails === 'function') {
        window.DriveQueue.start({
          sale: async function (key) {
            var parts = String(key || '').split('|');
            if (parts.length < 2 || !/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(parts[0])) return null;
            var takeoverId = parts.slice(1).join('|');
            if (!takeoverId) return null;
            return await window.downloadAdminSaleHistoryDetails(takeoverId, { uploadOnly: true, reportDate: parts[0] });
          }
        }, 10000);
      }
      // Keep queue status fresh and wake the report-page PDF builders while admin settings is open.
      window.setInterval(loadQueue, 30000);
    }
  });
})();
