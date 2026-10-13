(function () {
  'use strict';
  var role = 'admin';
  var loginPath = 'admin-logistics.html';
  var headers = { Accept: 'application/json', 'X-Fuel-Role': role };

  // Avoid briefly exposing a protected panel while the session is checked.
  document.documentElement.style.visibility = 'hidden';

  function goToLogin() {
    try { window.sessionStorage.removeItem('fuelRole'); } catch (_) {}
    var current = window.location.pathname.split('/').pop();
    window.location.replace(loginPath + '?next=' + encodeURIComponent(current || 'admin-logistics-dashboard.html'));
  }

  fetch('/api/me', { method: 'GET', credentials: 'same-origin', cache: 'no-store', headers: headers })
    .then(function (response) {
      if (!response.ok) throw new Error('Admin session is not valid.');
      return response.json();
    })
    .then(function (data) {
      if (!data || data.authenticated !== true || !data.user || data.user.role !== role) {
        throw new Error('Admin session is not valid.');
      }
      try { window.sessionStorage.setItem('fuelRole', role); } catch (_) {}
      document.documentElement.style.visibility = '';
    })
    .catch(goToLogin);

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
    }).catch(function () {}).then(function () {
      try { window.sessionStorage.removeItem('fuelRole'); } catch (_) {}
      window.location.replace(loginPath + '?signed_out=1');
    });
  });
})();