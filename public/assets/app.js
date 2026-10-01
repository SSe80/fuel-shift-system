async function api(path, options={}) {
  const response = await fetch(path, {
    credentials: 'same-origin',
    ...options,
    headers: {'Content-Type':'application/json', ...(options.headers || {})}
  });
  const text = await response.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch (_) { data = text; }
  if (!response.ok) {
    const msg = typeof data === 'object' && data ? (typeof data.error === 'string' ? data.error : JSON.stringify(data.error || data)) : String(data || 'Request failed');
    throw new Error(msg);
  }
  return data;
}
const h = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const money = value => Number(value || 0).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2});
const liters = value => Number(value || 0).toLocaleString(undefined,{maximumFractionDigits:2});

async function login(role) {
  const operator_id=document.getElementById('operator-id').value.trim(), pin=document.getElementById('pin').value;
  try {
    const user=await api('/api/login',{method:'POST',body:JSON.stringify({operator_id,pin})});
    if(role==='admin' && user.role!=='admin') throw new Error('This account is not an admin account');
    localStorage.setItem('fuelRole',user.role);
    location.href=user.role==='admin'?'admin-dashboard.html':'employee-dashboard.html';
  } catch(e) { toast(e.message); }
}
async function logout(){try{await api('/api/logout',{method:'POST',body:'{}'});}catch(_){} localStorage.removeItem('fuelRole');location.href='index.html';}
async function currentUser(){return (await api('/api/me')).employee;}

async function employeeDashboard(){
  try{
    const me=await currentUser();
    if(me.role!=='employee')return location.href='admin-dashboard.html';
    document.getElementById('name').textContent=me.name;
    const [shifts,nozzles]=await Promise.all([api('/api/shifts'),api('/api/nozzles')]);
    const nn=Object.fromEntries(nozzles.map(n=>[n.id,n.nozzle_code+' — '+n.product]));
    const mine=shifts.filter(s=>s.employee_id===me.id);
    document.getElementById('shift').innerHTML=mine.length?mine.map(s=>s.status==='assigned'
      ?`<div class="card"><div class="top"><h3>Shift ${h(s.id.slice(0,8))}</h3><span class="badge">${h(s.status)}</span></div><p>Nozzle: <b>${h(nn[s.nozzle_id]||s.nozzle_id)}</b></p><form class="form" onsubmit="startShift(event,'${s.id}')"><input id="opening-${s.id}" type="number" min="0" step="0.01" placeholder="Opening meter reading" required><input id="opening-mm-${s.id}" type="number" min="0" step="0.01" placeholder="Opening dip (mm)" required><input id="opening-liters-${s.id}" type="number" min="0" step="0.01" placeholder="Opening tank liters" required><button class="primary">Start Shift</button></form></div>`
      :s.status==='active'
      ?`<div class="card"><div class="top"><h3>Active Shift</h3><span class="badge">${h(s.status)}</span></div><p>Nozzle: <b>${h(nn[s.nozzle_id]||s.nozzle_id)}</b></p><p>Opening meter: <b>${liters(s.opening_reading)}</b></p><div class="row"><a class="btn primary" href="sales.html">Record Sale</a><a class="btn" href="handover.html">Handover</a></div><form class="form" onsubmit="closeShift(event,'${s.id}')"><input id="close-reading-${s.id}" type="number" min="0" step="0.01" placeholder="Closing meter reading" required><input id="close-mm-${s.id}" type="number" min="0" step="0.01" placeholder="Closing dip (mm)" required><input id="close-liters-${s.id}" type="number" min="0" step="0.01" placeholder="Closing tank liters" required><button class="primary">Close Shift</button></form></div>`
      :`<div class="card"><div class="top"><h3>Shift ${h(s.id.slice(0,8))}</h3><span class="badge">${h(s.status)}</span></div><p>Nozzle: ${h(nn[s.nozzle_id]||s.nozzle_id)}</p><p>Opening: ${liters(s.opening_reading)} • Closing: ${liters(s.closing_reading)}</p></div>`).join(''):'<div class="card"><p>No shifts assigned.</p></div>';
  }catch(e){if(e.message==='Unauthorized')location.href='employee-login.html';}
}
async function startShift(event,id){
  event.preventDefault();
  try{await api('/api/shifts/'+id+'/start',{method:'POST',body:JSON.stringify({opening_reading:Number(document.getElementById('opening-'+id).value),opening_mm:Number(document.getElementById('opening-mm-'+id).value),opening_liters:Number(document.getElementById('opening-liters-'+id).value)})});toast('Shift started');await employeeDashboard();}
  catch(e){toast(e.message);}
}
async function closeShift(event,id){
  event.preventDefault();
  try{
    await api('/api/shifts/'+id+'/close',{method:'POST',body:JSON.stringify({
      closing_reading:Number(document.getElementById('close-reading-'+id).value),
      closing_mm:Number(document.getElementById('close-mm-'+id).value),
      closing_liters:Number(document.getElementById('close-liters-'+id).value)
    })});
    toast('Shift closed');
    await employeeDashboard();
  }catch(e){toast(e.message);}
}

async function adminDashboard(){
  try{
    const me=await currentUser(); if(me.role!=='admin')return location.href='employee-dashboard.html';
    const [tanks,sales,shifts]=await Promise.all([api('/api/tanks'),api('/api/sales'),api('/api/shifts')]);
    const today=new Date().toISOString().slice(0,10);
    const todaySales=sales.filter(s=>String(s.sale_time||'').slice(0,10)===today);
    const total=todaySales.reduce((a,s)=>a+Number(s.amount||0),0);
    const active=shifts.filter(s=>s.status==='active');
    const low=tanks.filter(t=>Number(t.capacity_liters)>0&&Number(t.current_liters)/Number(t.capacity_liters)<=.1);
    document.getElementById('sales').textContent=todaySales.length;
    document.getElementById('active-shifts').textContent=active.length;
    document.getElementById('tank-count').textContent=tanks.length;
    document.getElementById('alerts').textContent=low.length;
    const totalEl=document.getElementById('sales-total');if(totalEl)totalEl.textContent=money(total);
    document.getElementById('tanks').innerHTML=tanks.length?tanks.map(t=>{
      const pct=Number(t.capacity_liters)>0?Math.max(0,Math.min(100,Number(t.current_liters)/Number(t.capacity_liters)*100)):0;
      return `<div class="stat"><b>${liters(t.current_liters)} L</b><span>${h(t.tank_code)} • ${h(t.product)}</span><small>${pct.toFixed(1)}% full • Capacity ${liters(t.capacity_liters)} L</small></div>`;
    }).join(''):'<div class="card"><p>No tanks configured.</p></div>';
    document.getElementById('dashboard-status').textContent=low.length?low.length+' tank(s) are at or below 10% capacity.':'Live data from Supabase.';
  }catch(e){const s=document.getElementById('dashboard-status');if(s)s.textContent=e.message;if(e.message==='Unauthorized')location.href='admin-login.html';}
}

async function adminSettings(){
  try{const me=await currentUser();if(me.role!=='admin')return location.href='employee-dashboard.html';await loadSettingsData();}
  catch(e){location.href='admin-login.html';}
}
async function loadSettingsData(){
  const [employees,tanks,nozzles,shifts]=await Promise.all([api('/api/employees'),api('/api/tanks'),api('/api/nozzles'),api('/api/shifts')]);
  document.getElementById('employees').innerHTML=employees.length?employees.map(e=>`<div class="card"><div class="top"><div><b>${h(e.name)}</b><br><span class="muted">Operator ID: <b>${h(e.operator_id)}</b> • ${h(e.phone)} • ${h(e.role)}</span></div><div class="row"><button type="button" onclick="openEmployeeEdit('${e.id}')">Edit</button><button type="button" onclick="toggleEmployee('${e.id}',${e.active})">${e.active?'Deactivate':'Activate'}</button></div></div></div>`).join(''):'<p class="muted">No employees.</p>';
  window.employeeRecords=employees;
  document.getElementById('tanks').innerHTML=tanks.length?tanks.map(t=>`<div class="card"><b>${h(t.tank_code)} — ${h(t.product)}</b><p>${liters(t.current_liters)} / ${liters(t.capacity_liters)} L • Dip ${liters(t.current_mm)} mm</p><button onclick="adjustTank('${t.id}','${h(t.tank_code)}',${Number(t.current_liters)},${Number(t.current_mm)})">Adjust inventory</button></div>`).join(''):'<p class="muted">No tanks.</p>';
  document.getElementById('nozzles').innerHTML=nozzles.length?nozzles.map(n=>`<div class="card"><div class="top"><div><b>${h(n.nozzle_code)} — ${h(n.product)}</b><br><span class="muted">Tank: ${h((tanks.find(t=>t.id===n.tank_id)||{}).tank_code||n.tank_id)}</span></div><button onclick="toggleNozzle('${n.id}',${n.active})">${n.active?'Deactivate':'Activate'}</button></div></div>`).join(''):'<p class="muted">No nozzles.</p>';
  const es=document.getElementById('shift-employee'),ns=document.getElementById('shift-nozzle');
  es.innerHTML='<option value="">Select employee</option>'+employees.filter(e=>e.active&&e.role==='employee').map(e=>`<option value="${e.id}">${h(e.name)} — ID ${h(e.operator_id)}</option>`).join('');
  ns.innerHTML='<option value="">Select nozzle</option>'+nozzles.filter(n=>n.active).map(n=>`<option value="${n.id}">${h(n.nozzle_code)} — ${h(n.product)}</option>`).join('');
  const en=Object.fromEntries(employees.map(e=>[e.id,e.name])),nn=Object.fromEntries(nozzles.map(n=>[n.id,n.nozzle_code]));
  document.getElementById('shifts').innerHTML=shifts.slice(0,20).map(s=>`<div class="card"><b>${h(en[s.employee_id]||s.employee_id)}</b> • ${h(nn[s.nozzle_id]||s.nozzle_id)}<br><span class="muted">${h(s.status)} • ${s.start_time?new Date(s.start_time).toLocaleString():'not started'}</span></div>`).join('')||'<p class="muted">No shifts.</p>';
}
function openEmployeeEdit(id){
  const e=(window.employeeRecords||[]).find(x=>x.id===id);
  if(!e)return;
  document.getElementById('edit-employee-id').value=e.id;
  document.getElementById('edit-employee-name').value=e.name||'';
  document.getElementById('edit-employee-phone').value=e.phone||'';
  document.getElementById('edit-employee-role').value=e.role||'employee';
  document.getElementById('edit-employee-pin').value='';
  document.getElementById('employee-edit-form').style.display='grid';
  document.getElementById('employee-edit-form').scrollIntoView({behavior:'smooth',block:'start'});
}
function closeEmployeeEdit(){document.getElementById('employee-edit-form').style.display='none';document.getElementById('employee-edit-form').reset();}
async function saveEmployeeEdit(event){
  event.preventDefault();
  const id=document.getElementById('edit-employee-id').value;
  const body={
    name:document.getElementById('edit-employee-name').value.trim(),
    phone:document.getElementById('edit-employee-phone').value.trim(),
    role:document.getElementById('edit-employee-role').value
  };
  const pin=document.getElementById('edit-employee-pin').value.trim();
  if(pin)body.pin=pin;
  try{
    await api('/api/employees/'+id,{method:'PATCH',body:JSON.stringify(body)});
    closeEmployeeEdit();
    toast('Employee updated');
    await loadSettingsData();
  }catch(e){toast(e.message);}
}
async function createEmployee(e){e.preventDefault();try{await api('/api/employees',{method:'POST',body:JSON.stringify({name:document.getElementById('employee-name').value.trim(),phone:document.getElementById('employee-phone').value.trim(),pin:document.getElementById('employee-pin').value,role:document.getElementById('employee-role').value})});e.target.reset();toast('Employee created');await loadSettingsData();}}
async function toggleEmployee(id,active){try{await api('/api/employees/'+id,{method:'PATCH',body:JSON.stringify({active:!active})});await loadSettingsData();}catch(e){toast(e.message);}}
async function createTank(e){e.preventDefault();try{await api('/api/tanks',{method:'POST',body:JSON.stringify({tank_code:document.getElementById('tank-code').value.trim(),product:document.getElementById('tank-product').value.trim(),capacity_liters:Number(document.getElementById('tank-capacity').value),current_liters:Number(document.getElementById('tank-current').value),current_mm:Number(document.getElementById('tank-mm').value||0)})});e.target.reset();document.getElementById('tank-current').value='0';document.getElementById('tank-mm').value='0';toast('Tank created');await loadSettingsData();}catch(x){toast(x.message);}}
async function adjustTank(id,code,current,mm){const n=prompt('New liters for '+code,current);if(n===null)return;const m=prompt('New dip in mm',mm);if(m===null)return;const notes=prompt('Reason','Inventory adjustment')||'Inventory adjustment';try{await api('/api/tanks/'+id,{method:'PATCH',body:JSON.stringify({current_liters:Number(n),current_mm:Number(m),notes})});toast('Inventory updated');await loadSettingsData();}catch(e){toast(e.message);}}
async function createNozzle(e){e.preventDefault();try{await api('/api/nozzles',{method:'POST',body:JSON.stringify({nozzle_code:document.getElementById('nozzle-code').value.trim(),product:document.getElementById('nozzle-product').value.trim(),tank_id:document.getElementById('nozzle-tank').value})});e.target.reset();toast('Nozzle created');await loadSettingsData();}catch(x){toast(x.message);}}
async function toggleNozzle(id,active){try{await api('/api/nozzles/'+id,{method:'PATCH',body:JSON.stringify({active:!active})});await loadSettingsData();}catch(e){toast(e.message);}}
async function createShift(e){e.preventDefault();try{await api('/api/shifts',{method:'POST',body:JSON.stringify({employee_id:document.getElementById('shift-employee').value,nozzle_id:document.getElementById('shift-nozzle').value})});e.target.reset();toast('Shift assigned');await loadSettingsData();}}

async function loadSaleContext(){
  try{
    const [shifts,nozzles]=await Promise.all([api('/api/shifts'),api('/api/nozzles')]);
    const active=shifts.find(s=>s.status==='active'), box=document.getElementById('sale-context'),product=document.getElementById('product'),button=document.getElementById('sale-button');
    if(!active){box.textContent='No active shift. Start a shift first.';return;}
    const n=nozzles.find(x=>x.id===active.nozzle_id);if(!n){box.textContent='Assigned nozzle not found.';return;}
    box.innerHTML='Active nozzle: <b>'+h(n.nozzle_code)+' — '+h(n.product)+'</b>';
    product.innerHTML='<option value="'+h(n.product)+'">'+h(n.product)+'</option>';product.disabled=false;button.disabled=false;
  }catch(e){document.getElementById('sale-context').textContent=e.message;}
}
async function addSale(){
  const litersSold=Number(document.getElementById('liters').value),price=Number(document.getElementById('price').value);
  if(!(litersSold>0)||price<0)return toast('Enter valid quantity and price');
  try{const r=await api('/api/sales',{method:'POST',body:JSON.stringify({product:document.getElementById('product').value,quantity_liters:litersSold,unit_price:price,payment_method:document.getElementById('payment').value})});toast('Sale recorded: '+liters(r.sale?.quantity_liters||litersSold)+' L');document.getElementById('liters').value='';await loadSalesHistory();}catch(e){toast(e.message);}
}
async function loadSalesHistory(){
  const box=document.getElementById('sales-history');
  if(!box)return;
  try{
    const rows=await api('/api/sales');
    box.innerHTML=rows.length?rows.slice(0,20).map(s=>`<div class="card"><b>${h(s.product)}</b> — ${liters(s.quantity_liters)} L × ${money(s.unit_price)}<br><span class="muted">${money(s.amount)} • ${h(s.payment_method)} • ${new Date(s.sale_time).toLocaleString()}</span></div>`).join(''):'No sales recorded yet.';
  }catch(e){box.textContent=e.message;}
}

async function loadHandover(){
  try{
    const me=await currentUser(),[shifts,employees]=await Promise.all([api('/api/shifts'),api('/api/employees').catch(()=>[])]);
    const active=shifts.find(s=>s.status==='active');
    if(!active){document.getElementById('handover-status').textContent='No active shift.';return;}
    document.getElementById('handover-shift').value=active.id;
    document.getElementById('handover-status').textContent='Active shift on nozzle '+active.nozzle_id;
    document.getElementById('to-employee').innerHTML='<option value="">Select receiving employee</option>'+employees.filter(e=>e.active&&e.id!==me.id&&e.role==='employee').map(e=>`<option value="${e.id}">${h(e.name)} — ID ${h(e.operator_id)}</option>`).join('');
  }catch(e){document.getElementById('handover-status').textContent=e.message;}
}
async function submitHandover(e){e.preventDefault();try{await api('/api/handovers',{method:'POST',body:JSON.stringify({shift_id:document.getElementById('handover-shift').value,to_employee_id:document.getElementById('to-employee').value,closing_reading:Number(document.getElementById('closing-reading').value),closing_mm:Number(document.getElementById('closing-mm').value),closing_liters:Number(document.getElementById('closing-liters').value)})});toast('Handover submitted');setTimeout(()=>location.href='pending-handovers.html',700);}catch(x){toast(x.message);}}
async function loadPendingHandovers(){
  try{
    const [hs,emps]=await Promise.all([api('/api/handovers'),api('/api/employees').catch(()=>[])]);
    const names=Object.fromEntries(emps.map(e=>[e.id,e.name]));
    const pending=hs.filter(x=>x.status==='pending');
    document.getElementById('pending-list').innerHTML=pending.length?pending.map(x=>`<div class="card"><h3>Handover ${h(x.id.slice(0,8))}</h3><p>From: <b>${h(names[x.from_employee_id]||x.from_employee_id)}</b><br>To: <b>${h(names[x.to_employee_id]||x.to_employee_id)}</b></p><p>Closing meter: ${liters(x.closing_reading)} • Tank: ${liters(x.closing_liters)} L</p><form class="form" onsubmit="confirmHandover(event,'${x.id}')"><input id="confirm-reading-${x.id}" type="number" min="0" step="0.01" placeholder="Opening meter" required><input id="confirm-mm-${x.id}" type="number" min="0" step="0.01" placeholder="Opening dip (mm)" required><input id="confirm-liters-${x.id}" type="number" min="0" step="0.01" placeholder="Opening tank liters" required><button class="primary">Confirm & Start Shift</button></form></div>`).join(''):'<div class="card"><p>No pending handovers.</p></div>';
  }catch(e){document.getElementById('pending-list').textContent=e.message;}
}
async function confirmHandover(e,id){e.preventDefault();try{await api('/api/handovers/'+id+'/confirm',{method:'POST',body:JSON.stringify({opening_reading:Number(document.getElementById('confirm-reading-'+id).value),opening_mm:Number(document.getElementById('confirm-mm-'+id).value),opening_liters:Number(document.getElementById('confirm-liters-'+id).value)})});toast('Handover confirmed');setTimeout(()=>location.href='employee-dashboard.html',700);}catch(x){toast(x.message);}}

async function loadPurchases(){
  try{
    const [tanks,purchases]=await Promise.all([api('/api/tanks'),api('/api/purchases')]);
    document.getElementById('purchase-tank').innerHTML='<option value="">Select tank</option>'+tanks.map(t=>`<option value="${t.id}">${h(t.tank_code)} — ${h(t.product)}</option>`).join('');
    const products=[...new Map(tanks.map(t=>[String(t.product).toLowerCase(),t.product])).values()];
    document.getElementById('purchase-product').innerHTML='<option value="">Select product</option>'+products.map(p=>`<option value="${h(p)}">${h(p)}</option>`).join('');
    document.getElementById('purchase-tank').onchange=()=>{const t=tanks.find(x=>x.id===document.getElementById('purchase-tank').value);if(t)document.getElementById('purchase-product').value=t.product;};
    document.getElementById('purchase-list').innerHTML=purchases.length?purchases.map(p=>`<div class="card"><b>${h(p.product)}</b> — ${liters(p.quantity_liters)} L<br><span class="muted">${h(p.supplier||'No supplier')} • ${new Date(p.purchase_date).toLocaleString()}</span></div>`).join(''):'<div class="card"><p>No purchases yet.</p></div>';
  }catch(e){document.getElementById('purchase-status').textContent=e.message;}
}
async function createPurchase(e){e.preventDefault();try{await api('/api/purchases',{method:'POST',body:JSON.stringify({product:document.getElementById('purchase-product').value,tank_id:document.getElementById('purchase-tank').value,quantity_liters:Number(document.getElementById('purchase-liters').value),supplier:document.getElementById('purchase-supplier').value.trim(),invoice_number:document.getElementById('purchase-invoice').value.trim()})});e.target.reset();toast('Purchase recorded and tank updated');await loadPurchases();}catch(x){toast(x.message);}}

async function loadDailyReport(){
  try{
    const d=document.getElementById('report-date').value||new Date().toISOString().slice(0,10),r=await api('/api/reports/daily?date='+encodeURIComponent(d));
    document.getElementById('report-summary').innerHTML=`<div class="statgrid"><div class="stat"><b>${liters(r.summary.sales_liters)} L</b><span>Sales volume</span></div><div class="stat"><b>${money(r.summary.sales_amount)}</b><span>Sales amount</span></div><div class="stat"><b>${liters(r.summary.purchases_liters)} L</b><span>Purchases</span></div></div>`;
    const rows=Object.entries(r.summary.by_product).map(([p,v])=>`<tr><td>${h(p)}</td><td>${liters(v.liters)}</td><td>${money(v.amount)}</td></tr>`).join('');
    document.getElementById('report-table').innerHTML=rows||'<tr><td colspan="3">No sales</td></tr>';
  }catch(e){document.getElementById('report-status').textContent=e.message;}
}
async function saveDailyReport(){try{await api('/api/reports/daily',{method:'POST',body:JSON.stringify({date:document.getElementById('report-date').value})});toast('Daily report saved');}catch(e){toast(e.message);}}

function toast(msg){const e=document.getElementById('toast');if(e){e.textContent=msg;e.style.display='block';setTimeout(()=>e.style.display='none',3000);}else alert(msg);}
