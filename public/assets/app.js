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

    const [tanks, sales, shifts] = await Promise.all([
      api('/api/tanks'),
      api('/api/sales'),
      api('/api/shifts')
    ]);

    const now = new Date();
    const today = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0') + '-' + String(now.getDate()).padStart(2, '0');
    const salesToday = sales.filter(s => String(s.sale_time || s.created_at || '').slice(0, 10) === today);
    const activeShifts = shifts.filter(s => s.status === 'active');
    const lowTanks = tanks.filter(t => {
      const capacity = Number(t.capacity_liters || 0);
      const current = Number(t.current_liters || 0);
      return capacity > 0 && current / capacity <= 0.10;
    });

    document.getElementById('sales').textContent = salesToday.length;
    document.getElementById('active-shifts').textContent = activeShifts.length;
    document.getElementById('tank-count').textContent = tanks.length;
    document.getElementById('alerts').textContent = lowTanks.length;

    document.getElementById('tanks').innerHTML = tanks.length
      ? tanks.map(t => {
          const current = Number(t.current_liters || 0);
          const capacity = Number(t.capacity_liters || 0);
          const percent = capacity > 0 ? Math.max(0, Math.min(100, current / capacity * 100)) : 0;
          const warning = capacity > 0 && percent <= 10 ? ' • LOW' : '';
          return `<div class="stat"><b>${current.toLocaleString()} L</b><span>${t.tank_code} • ${t.product}${warning}</span><small>${percent.toFixed(1)}% full • Capacity ${capacity.toLocaleString()} L</small></div>`;
        }).join('')
      : '<div class="card"><p>No tanks configured yet.</p></div>';

    const status = document.getElementById('dashboard-status');
    if (status) {
      status.textContent = lowTanks.length
        ? lowTanks.length + ' tank(s) are at or below 10% capacity.'
        : 'Live data from Supabase.';
    }
  } catch (err) {
    const status = document.getElementById('dashboard-status');
    if (status) status.textContent = err.message || 'Unable to load dashboard data.';
    if (err.message === 'Unauthorized') location.href = 'admin-login.html';
  }
}

async function adminSettings() {
  try {
    const me = await api('/api/me');
    if (me.employee.role !== 'admin') return location.href = 'employee-dashboard.html';
    await loadSettingsData();
  } catch (_) {
    location.href = 'admin-login.html';
  }
}

async function loadSettingsData() {
  const [employees, tanks, nozzles] = await Promise.all([
    api('/api/employees'),
    api('/api/tanks'),
    api('/api/nozzles')
  ]);
  document.getElementById('employees').innerHTML = employees.length
    ? employees.map(e => `<div class="card"><b>${e.name}</b><br><span class="muted">${e.phone} • ${e.role} • ${e.active ? 'Active' : 'Inactive'}</span></div>`).join('')
    : '<p class="muted">No employees configured.</p>';
  document.getElementById('tanks').innerHTML = tanks.length
    ? tanks.map(t => `<div class="card"><b>${t.tank_code}</b> — ${t.product}<br><span class="muted">${Number(t.current_liters || 0).toLocaleString()} / ${Number(t.capacity_liters || 0).toLocaleString()} L</span></div>`).join('')
    : '<p class="muted">No tanks configured.</p>';
  const tankSelect = document.getElementById('nozzle-tank');
  tankSelect.innerHTML = '<option value="">Select tank</option>' +
    tanks.map(t => `<option value="${t.id}">${t.tank_code} — ${t.product}</option>`).join('');
  document.getElementById('nozzles').innerHTML = nozzles.length
    ? nozzles.map(n => `<div class="card"><b>${n.nozzle_code}</b> — ${n.product}<br><span class="muted">Tank ID: ${n.tank_id}</span></div>`).join('')
    : '<p class="muted">No nozzles configured.</p>';
}

async function createEmployee(event) {
  event.preventDefault();
  try {
    await api('/api/employees', {method:'POST', body:JSON.stringify({
      name: document.getElementById('employee-name').value.trim(),
      phone: document.getElementById('employee-phone').value.trim(),
      pin: document.getElementById('employee-pin').value,
      role: document.getElementById('employee-role').value
    })});
    event.target.reset();
    toast('Employee created');
    await loadSettingsData();
  } catch (err) { toast(err.message); }
}

async function createTank(event) {
  event.preventDefault();
  try {
    await api('/api/tanks', {method:'POST', body:JSON.stringify({
      tank_code: document.getElementById('tank-code').value.trim(),
      product: document.getElementById('tank-product').value.trim(),
      capacity_liters: Number(document.getElementById('tank-capacity').value),
      current_liters: Number(document.getElementById('tank-current').value),
      current_mm: Number(document.getElementById('tank-mm').value || 0)
    })});
    event.target.reset();
    document.getElementById('tank-current').value='0';
    document.getElementById('tank-mm').value='0';
    toast('Tank created');
    await loadSettingsData();
  } catch (err) { toast(err.message); }
}

async function createNozzle(event) {
  event.preventDefault();
  try {
    await api('/api/nozzles', {method:'POST', body:JSON.stringify({
      nozzle_code: document.getElementById('nozzle-code').value.trim(),
      product: document.getElementById('nozzle-product').value.trim(),
      tank_id: document.getElementById('nozzle-tank').value
    })});
    event.target.reset();
    toast('Nozzle created');
    await loadSettingsData();
  } catch (err) { toast(err.message); }
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
