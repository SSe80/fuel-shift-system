(function () {
  'use strict';
  var role = 'admin';
  var loginPath = 'admin-logistics.html';
  var headers = { Accept: 'application/json', 'X-Fuel-Role': role };

  // Keep protected content hidden while checking the saved session.
  document.documentElement.style.visibility = 'hidden';

  function goToLogin() {
    try { window.sessionStorage.removeItem('fuelRole'); } catch (_) {}
    var current = window.location.pathname.split('/').pop();
    window.location.replace(loginPath + '?next=' + encodeURIComponent(current || 'admin-logistics-dashboard.html'));
  }

  function showRetry() {
    document.documentElement.style.visibility = '';
    var note = document.getElementById('fuel-auth-retry-note');
    if (!note) {
      note = document.createElement('div');
      note.id = 'fuel-auth-retry-note';
      note.setAttribute('role', 'status');
      note.style.cssText = 'position:fixed;z-index:99999;left:16px;right:16px;top:16px;padding:14px 16px;border:1px solid #f0c36d;border-radius:12px;background:#fff8e6;color:#713f12;font:600 14px/1.45 system-ui,sans-serif;box-shadow:0 8px 28px rgba(0,0,0,.12)';
      note.textContent = 'Could not verify your saved session. The app has not signed you out or cleared your saved login. Check your connection and retry.';
      var button = document.createElement('button');
      button.type = 'button';
      button.textContent = 'Retry';
      button.style.cssText = 'margin-left:12px;padding:7px 12px;border:0;border-radius:8px;background:#92400e;color:white;font-weight:700';
      button.addEventListener('click', function () {
        note.remove();
        document.documentElement.style.visibility = 'hidden';
        verifySession(0);
      });
      note.appendChild(button);
      document.body.appendChild(note);
    }
  }

  function verifySession(attempt) {
    fetch('/api/me', { method: 'GET', credentials: 'same-origin', cache: 'no-store', headers: headers })
      .then(function (response) {
        // Only an explicit unauthorized response should send the user back to login.
        // A server error or temporary network failure must not masquerade as logout.
        if (response.status === 401) {
          // A true 401 means this role's server session is no longer valid.
          // Keep local preferences intact, but return to sign-in instead of
          // exposing a protected page with an unusable session.
          goToLogin();
          return null;
        }
        if (!response.ok) throw new Error('Session check temporarily failed (' + response.status + ').');
        return response.json();
      })
      .then(function (data) {
        if (data === null) return;
        if (!data || data.authenticated !== true || !data.user || data.user.role !== role) {
          throw new Error('Saved session could not be verified.');
        }
        try { window.sessionStorage.setItem('fuelRole', role); } catch (_) {}
        document.documentElement.style.visibility = '';
      })
      .catch(function () {
        if (attempt < 2) {
          window.setTimeout(function () { verifySession(attempt + 1); }, 700 * (attempt + 1));
        } else {
          showRetry();
        }
      });
  }

  verifySession(0);

  document.addEventListener('click', function (event) {
    var button = event.target && event.target.closest ? event.target.closest('[data-logistics-logout]') : null;
    if (!button) return;
    event.preventDefault();
    if (button.disabled) return;
    button.disabled = true;
    button.textContent = 'Signing out…';
    fetch('/api/logout', {
      method: 'POST',
      credentials: 'same-origin',
      cache: 'no-store',
      headers: { Accept: 'application/json', 'X-Fuel-Role': role }
    }).then(function (response) {
      if (!response.ok) throw new Error('Logout request failed (HTTP ' + response.status + ').');
      return response.json();
    }).then(function (data) {
      if (!data || data.ok !== true) throw new Error('The server did not confirm logout.');
      try { window.localStorage.setItem('fuelExplicitLogout:' + role, '1'); } catch (_) {}
      try { window.localStorage.removeItem('fuelRole'); } catch (_) {}
      try { window.sessionStorage.removeItem('fuelRole'); } catch (_) {}
      window.location.replace(loginPath + '?signed_out=1');
    }).catch(function () {
      button.disabled = false;
      button.textContent = 'Log out';
      var note = document.getElementById('fuel-auth-logout-note');
      if (!note) {
        note = document.createElement('div');
        note.id = 'fuel-auth-logout-note';
        note.setAttribute('role', 'alert');
        note.style.cssText = 'position:fixed;z-index:100000;left:16px;right:16px;top:16px;padding:14px 16px;border:1px solid #f0c36d;border-radius:12px;background:#fff8e6;color:#713f12;font:600 14px/1.45 system-ui,sans-serif;box-shadow:0 8px 28px rgba(0,0,0,.12)';
        document.body.appendChild(note);
      }
      note.textContent = 'Logout could not be confirmed. Your session has been kept; check your connection and try again.';
    });
  });
})();
