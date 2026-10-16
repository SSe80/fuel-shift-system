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
    script.src = 'assets/app.js?v=20261017-attendant-session-diagnostic1';
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

  // Add safe diagnostics to the existing session-recovery banner.
  // This never clears cookies, storage, or the saved role.
  if (typeof window.fetch === 'function' && !window.__fuelSessionDiagnosticFetch) {
    window.__fuelSessionDiagnosticFetch = true;
    var originalFetch = window.fetch.bind(window);
    window.fetch = function (input, init) {
      var requestUrl = typeof input === 'string' ? input : (input && input.url) || '';
      var isMeCheck = requestUrl.indexOf('/api/me') >= 0;
      var request = originalFetch(input, init);
      if (!isMeCheck) return request;
      return request.then(function (response) {
        if (!response.ok) {
          var code = response.status;
          window.setTimeout(function () {
            var banner = document.getElementById('fuel-session-recovery-banner');
            if (!banner) return;
            var detail = document.getElementById('fuel-session-recovery-detail');
            if (!detail) {
              detail = document.createElement('div');
              detail.id = 'fuel-session-recovery-detail';
              detail.style.cssText = 'margin-top:4px;font-weight:500';
              var retry = banner.querySelector('#fuel-session-retry');
              banner.insertBefore(detail, retry || null);
            }
            if (code === 401) detail.textContent = 'Session check rejected (HTTP 401). This message does not log you out. Retry; if it persists, sign in again only after confirming the correct site.';
            else if (code === 403) detail.textContent = 'Session check denied (HTTP 403). This message does not clear your session.';
            else if (code === 503) detail.textContent = 'Server or database temporarily unable to verify the session (HTTP 503). Wait a moment and retry.';
            else detail.textContent = 'Session verification failed (HTTP ' + code + '). Retry in a moment.';
          }, 0);
        }
        return response;
      }).catch(function (error) {
        window.setTimeout(function () {
          var banner = document.getElementById('fuel-session-recovery-banner');
          if (!banner) return;
          var detail = document.getElementById('fuel-session-recovery-detail');
          if (!detail) {
            detail = document.createElement('div');
            detail.id = 'fuel-session-recovery-detail';
            detail.style.cssText = 'margin-top:4px;font-weight:500';
            var retry = banner.querySelector('#fuel-session-retry');
            banner.insertBefore(detail, retry || null);
          }
          detail.textContent = 'Network error while checking the saved session. Check your connection and retry. (' + String(error && error.message || 'request failed').slice(0, 120) + ')';
        }, 0);
        throw error;
      });
    };
  }

  window.addEventListener('DOMContentLoaded', function () {
    var name = pageFunction();
    if (name) loadAppAndRun(name);
  });
})();