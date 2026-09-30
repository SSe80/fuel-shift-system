async function api(path, options={}) {
  const response = await fetch(path, {
    credentials: 'same-origin',
    headers: {'Content-Type': 'application/json', ...(options.headers || {})},
    ...options
  });
  const text = await response.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch (_) { data = text; }
  if (!response.ok) throw new Error(data?.error || 'Request failed');
  return data;
}

function login(role) {
  const inputs = document.querySelectorAll('input');
  const phone = inputs[0]?.value?.trim() || '';
  const pin = inputs[1]?.value || '';
  api('/api/login', {method:'POST', body:JSON.stringify({phone, pin})})
    .then(user => {
      if (role === 'admin' && user.role !== 'admin') throw new Error('This account is not an admin account');
      localStorage.setItem('fuelRole', user.role);
      location.href = user.role === 'admin' ? 'admin-dashboard.html' : 'employee-dashboard.html';
    })
    .catch(err => alert(err.message));
}

async function logout() {
  try { await api('/api/logout', {method:'POST', body:'{}'}); } catch (_) {}
  localStorage.removeItem('fuelRole');
  location.href = 'index.html';
}

async function employeeDashboard() {
  try {
    const me = await api('/api/me');
    if (me.employee.role !== 'employee') return location.href = 'admin-dashboard.html';
    document.getElementById('name').textContent = me.employee.name;
    const shifts = await api('/api/shifts');
    document.getElementById('shift').innerHTML = shifts.length
      ? shifts.map(s => `<div class="card"><div class="top"><h3>Shift ${s.id.slice(0,8)}</h3><span class="badge">${s.status}</span></div><p>Nozzle: ${s.nozzle_id || 'Not assigned'}</p><p>Opening meter: <b>${(s.opening_reading ?? 0).toLocaleString()}</b></p><a class="btn primary" href="handover.html">Start Handover</a></div>`).join('')
      : '<div class="card"><p>No shifts assigned yet.</p></div>';
  } catch (_) {
    location.href = 'employee-login.html';
  }
}

async function adminDashboard() {
  try {
    const me = await api('/api/me');
    if (me.employee.role !== 'admin') return location.href = 'employee-dashboard.html';
    const [tanks, sales] = await Promise.all([api('/api/tanks'), api('/api/sales')]);
    document.getElementById('tanks').innerHTML = tanks.map(t =>
      `<div class="stat"><b>${Number(t.current_liters || 0).toLocaleString()}</b><span>${t.tank_code} • ${t.product} L</span><small>Capacity ${Number(t.capacity_liters || 0).toLocaleString()} L</small></div>`
    ).join('');
    document.getElementById('sales').textContent = sales.length;
  } catch (_) {
    location.href = 'admin-login.html';
  }
}

async function addSale() {
  const liters = Number(document.getElementById('liters').value || 0);
  const product = document.getElementById('product').value;
  const price = Number(document.getElementById('price').value || 0);
  try {
    await api('/api/sales', {
      method:'POST',
      body:JSON.stringify({
        product,
        quantity_liters: liters,
        unit_price: price,
        payment_method: 'cash'
      })
    });
    toast('Sale recorded in Supabase');
    setTimeout(() => location.href = 'employee-dashboard.html', 700);
  } catch (err) {
    toast(err.message);
  }
}

function requireRole(role) {
  if (localStorage.getItem('fuelRole') !== role) {
    location.href = role === 'admin' ? 'admin-login.html' : 'employee-login.html';
  }
}

function resetDemo() {
  logout();
}

function toast(msg) {
  const e = document.getElementById('toast');
  if (e) {
    e.textContent = msg;
    e.style.display = 'block';
    setTimeout(() => e.style.display = 'none', 2200);
  }
}

function init() {}
init();
