(function () {
  'use strict';

  function pageFunction() {
    var body = document.body;
    return body && body.getAttribute('data-app-page');
  }

  function status(message) {
    var s = document.getElementById('settings-status') ||
            document.getElementById('dashboard-status') ||
            document.getElementById('sales-confirmation-status');
    if (s) s.textContent = message;
  }

  function run(name) {
    var fn = window[name];
    if (typeof fn === 'function') {
      try {
        var result = fn();
        if (result && typeof result.catch === 'function') {
          result.catch(function (e) {
            status('Application error: ' + (e && e.message ? e.message : e));
          });
        }
      } catch (e) {
        status('Application error: ' + (e && e.message ? e.message : e));
      }
      return true;
    }
    return false;
  }

  function loadAppAndRun(name) {
    if (run(name)) return;

    var script = document.createElement('script');
    script.src = 'assets/app.js?v=20261007-04';
    script.async = false;

    script.onload = function () {
      if (!run(name)) {
        status('Application loaded, but "' + name + '" is not available. Check the browser console for a JavaScript error.');
      }
    };

    script.onerror = function () {
      status('Application script could not be loaded.');
    };

    document.head.appendChild(script);
  }

  window.addEventListener('DOMContentLoaded', function () {
    var name = pageFunction();
    if (name) loadAppAndRun(name);
  });
})();