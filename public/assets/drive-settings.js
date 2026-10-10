/* Settings card: Google Drive folder links, connection test and the upload queue. */
(function () {
  'use strict';
  function $(id) { return document.getElementById(id); }
  function say(msg, bad) { var el = $('drive-status'); if (el) { el.textContent = msg; el.style.color = bad ? '#b91c1c' : ''; } }
  async function api(url, method, body) {
    var opts = { method: method || 'GET', credentials: 'same-origin', headers: { 'X-Fuel-Role': 'admin' } };
    if (body !== undefined) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
    var r = await fetch(url, opts), j = await r.json().catch(function () { return {}; });
    return { status: r.status, body: j };
  }
  function label(kind, key) {
    return (kind === 'dsr' ? 'DSR ' : 'MSR ') + key;
  }
  async function loadSettings() {
    var s = await api('/api/drive/settings');
    if (s.status !== 200) return say('Could not load Drive settings (' + s.status + ').', true);
    if ($('drive-dsr-link')) $('drive-dsr-link').value = s.body.dsr_folder_id ? 'https://drive.google.com/drive/folders/' + s.body.dsr_folder_id : '';
    if ($('drive-msr-link')) $('drive-msr-link').value = s.body.msr_folder_id ? 'https://drive.google.com/drive/folders/' + s.body.msr_folder_id : '';
    say('Folder links loaded.');
  }
  async function saveSettings() {
    var s = await api('/api/drive/settings', 'PUT', { dsr_link: $('drive-dsr-link').value, msr_link: $('drive-msr-link').value });
    if (s.status !== 200) return say(s.body.error || 'Save failed (' + s.status + ').', true);
    say('Saved. Use "Test connection" to check access.');
  }
  async function testConnection() {
    say('Testing…');
    var t = await api('/api/drive/test', 'POST', {});
    if (t.body && t.body.ok) return say('Connected. DSR and MSR folders are reachable and writable.');
    if (t.body && t.body.missing && t.body.missing.length) return say('Missing folder link for: ' + t.body.missing.join(', ').toUpperCase() + '.', true);
    say((t.body && t.body.error) || 'Connection failed (' + t.status + ').', true);
  }
  async function loadQueue() {
    var q = await api('/api/drive/queue');
    var box = $('drive-queue-list');
    if (!box) return;
    if (q.status !== 200 || !Array.isArray(q.body)) { box.textContent = 'Queue unavailable.'; return; }
    if (!q.body.length) { box.innerHTML = '<p class="muted">Nothing waiting. Every confirmed report is saved to Drive.</p>'; return; }
    box.innerHTML = q.body.map(function (i) {
      var state = i.status === 'failed' ? 'Failed' : 'Waiting';
      var err = i.last_error ? '<small class="muted"> · ' + String(i.last_error).replace(/[<>&]/g, '') + '</small>' : '';
      var retry = i.status === 'failed' ? ' <button type="button" class="secondary" data-retry="' + i.id + '">Retry</button>' : '';
      return '<div class="drive-queue-row"><span><b>' + label(i.kind, i.report_key) + '</b> · ' + state + err + '</span>' + retry + '</div>';
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
      window.DriveSettings.load();
    }
  });
})();
