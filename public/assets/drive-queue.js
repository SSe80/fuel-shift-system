/* Google Drive upload queue (browser side).
   The Worker keeps a queue of DSR and MSR PDFs waiting to be saved to Drive. An admin page
   builds the PDF for the report it has open and uploads it. Only the open report can be built,
   so a queued report waits until its page is opened (the Settings page shows what is waiting). */
(function () {
  'use strict';
  var MAX_ATTEMPTS = 3, running = false;
  function b64(buf) {
    var u = new Uint8Array(buf), s = '';
    for (var i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000));
    return btoa(s);
  }
  function note(msg) { if (typeof window.toast === 'function') window.toast(msg); }
  async function run(builders) {
    if (running) return; running = true;
    try {
      var r = await fetch('/api/drive/queue', { credentials: 'same-origin' });
      if (!r.ok) return;
      var items = await r.json();
      var todo = (Array.isArray(items) ? items : []).filter(function (i) { return i.status === 'pending' && (i.attempts || 0) < MAX_ATTEMPTS; });
      for (var k = 0; k < todo.length; k++) {
        var item = todo[k], build = builders[item.kind];
        if (!build) continue;
        var out = await build(item.report_key);           // null when this page does not have that report open
        if (!out || !out.blob) continue;
        var buf = await out.blob.arrayBuffer();
        var up = await fetch('/api/drive/queue/' + encodeURIComponent(item.id) + '/upload', {
          method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ pdf_base64: b64(buf) })
        });
        var body = await up.json().catch(function () { return {}; });
        if (body.ok) note('Saved to Google Drive: ' + (body.path || item.report_key));
        else note('Drive upload failed: ' + (body.error || up.status));
      }
    } catch (e) {
      /* offline or not signed in: the queue is kept and retried on the next run */
    } finally { running = false; }
  }
  window.DriveQueue = {
    run: run,
    start: function (builders, everyMs) {
      run(builders);
      return setInterval(function () { run(builders); }, everyMs || 30000);
    }
  };
})();
