(function () {
  'use strict';

  function pageFunction() {
    var body = document.body;
    return body && body.getAttribute('data-app-page');
  }

  function run(name) {
    if (typeof window[name] === 'function') {
      try { window[name](); } catch (e) {
        var s = document.getElementById('settings-status') || document.getElementById('dashboard-status');
        if (s) s.textContent = 'Application error: ' + (e.message || e);
      }
      return true;
    }
    return false;
  }

  function loadAppAndRun(name) {
    if (run(name)) return;
    var script = document.createElement('script');
    script.src = 'assets/app.js?recovery=20261002-01';
    script.async = false;
    script.onload = function () {
      if (!run(name)) {
        var s = document.getElementById('settings-status') || document.getElementById('dashboard-status');
        if (s) s.textContent = 'Application script loaded but page functions are unavailable.';
      }
    };
    script.onerror = function () {
      var s = document.getElementById('settings-status') || document.getElementById('dashboard-status');
      if (s) s.textContent = 'Application script could not be loaded.';
    };
    document.head.appendChild(script);
  }

  window.addEventListener('DOMContentLoaded', function () {
    var name = pageFunction();
    if (name) loadAppAndRun(name);
  });
})();