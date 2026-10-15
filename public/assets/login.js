(function () {
  'use strict';

  function showMessage(message) {
    var box = document.getElementById('toast');
    if (box) {
      box.textContent = String(message || 'Request failed');
      box.style.display = 'block';
      window.setTimeout(function () { box.style.display = 'none'; }, 3000);
    } else {
      window.alert(String(message || 'Request failed'));
    }
  }

  function login(role, successUrl) {
    var operator = document.getElementById('operator-id');
    var pin = document.getElementById('pin');
    if (!operator || !pin) return;
    var operator_id = operator.value.trim();
    var pinValue = pin.value;
    fetch(role === 'admin' ? '/api/admin-login' : '/api/attendant-login', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ operator_id: operator_id, pin: pinValue })
    })
    .then(function (response) {
      return response.text().then(function (text) {
        var data;
        try { data = text ? JSON.parse(text) : {}; } catch (_) { data = {}; }
        if (!response.ok) throw new Error(data.error || 'Login failed');
        return data;
      });
    })
    .then(function (user) {
      if (user.role !== role) {
        throw new Error('This account is not valid for the selected login');
      }
      // Persist the role selector across browser restarts. The role itself is not
      // an authentication credential; the HttpOnly server cookie remains authoritative.
      try { window.localStorage.setItem('fuelRole', role); } catch (_) {}
      try { window.sessionStorage.setItem('fuelRole', role); } catch (_) {}
      var destination = successUrl || (role === 'admin' ? 'admin-dashboard.html' : 'attendant-dashboard.html');
      // The logistics guard may return users to the page they originally requested.
      // Only accept a small allowlist of same-origin logistics pages.
      if (window.location.pathname.split('/').pop() === 'admin-logistics.html') {
        var requested = '';
        try { requested = new URLSearchParams(window.location.search).get('next') || ''; } catch (_) {}
        var allowed = ['admin-logistics-dashboard.html', 'admin-logistics-settings.html', 'admin-logistics-truck.html'];
        if (allowed.indexOf(requested) !== -1) destination = requested;
      }
      window.location.replace(destination);
    })
    .catch(function (error) {
      showMessage(error && error.message ? error.message : 'Login failed');
    });
  }

  function resumeExistingSession(role) {
    if (role !== 'admin' && role !== 'attendant') return;
    // If the PWA/browser opens the login URL after a phone restart, first
    // check the existing HttpOnly session cookie instead of making the user
    // sign in again. A failed/network check never clears the cookie or role.
    fetch('/api/me', {
      method: 'GET',
      credentials: 'same-origin',
      cache: 'no-store',
      headers: { 'X-Fuel-Role': role, 'Accept': 'application/json' }
    }).then(function (response) {
      if (!response.ok) return null;
      return response.json();
    }).then(function (data) {
      if (!data || data.authenticated !== true || !data.user || data.user.role !== role) return;
      try { window.localStorage.setItem('fuelRole', role); } catch (_) {}
      var destination = role === 'admin' ? 'admin-dashboard.html' : 'attendant-dashboard.html';
      if (role === 'admin' && window.location.pathname.split('/').pop() === 'admin-logistics.html') {
        var requested = '';
        try { requested = new URLSearchParams(window.location.search).get('next') || ''; } catch (_) {}
        var allowed = ['admin-logistics-dashboard.html', 'admin-logistics-settings.html', 'admin-logistics-truck.html'];
        if (allowed.indexOf(requested) !== -1) destination = requested;
      }
      window.location.replace(destination);
    }).catch(function () {
      // Keep the login form available during network outages; never log out.
    });
  }

  window.addEventListener('DOMContentLoaded', function () {
    var form = document.getElementById('login-form');
    if (!form) return;
    resumeExistingSession(form.getAttribute('data-role'));
    form.addEventListener('submit', function (event) {
      event.preventDefault();
      login(form.getAttribute('data-role'), form.getAttribute('data-success-url'));
    });
  });

  window.fuelLoginLoaded = true;
})();