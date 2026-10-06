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

  function login(role) {
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
      try { window.localStorage.setItem('fuelRole', role); } catch (_) {}
      window.location.replace(role === 'admin' ? 'admin-dashboard.html' : 'attendant-dashboard.html');
    })
    .catch(function (error) {
      showMessage(error && error.message ? error.message : 'Login failed');
    });
  }

  window.addEventListener('DOMContentLoaded', function () {
    var form = document.getElementById('login-form');
    if (!form) return;
    form.addEventListener('submit', function (event) {
      event.preventDefault();
      login(form.getAttribute('data-role'));
    });
  });

  window.fuelLoginLoaded = true;
})();