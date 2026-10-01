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
    const [shifts,nozzles,products]=await Promise.all([api('/api/shifts'),api('/api/nozzles'),api('/api/products')]);
    const productCodes=Object.fromEntries(products.map(p=>[String(p.name).toLowerCase(),p.code_name]));
    const codeForProduct=product=>productCodes[String(product||'').toLowerCase()]||product;
    const nn=Object.fromEntries(nozzles.map(n=>[n.id,n.nozzle_code+' — '+codeForProduct(n.product)]));
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
    const [tanks,sales,shifts,products]=await Promise.all([api('/api/tanks'),api('/api/sales'),api('/api/shifts'),api('/api/products')]);
    const productCodes=Object.fromEntries(products.map(p=>[String(p.name).toLowerCase(),p.code_name]));
    const codeForProduct=product=>productCodes[String(product||'').toLowerCase()]||product;
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
      return `<div class="stat"><b>${liters(t.current_liters)} L</b><span>${h(t.tank_code)} • ${h(codeForProduct(t.product))}</span><small>${pct.toFixed(1)}% full • Capacity ${liters(t.capacity_liters)} L</small></div>`;
    }).join(''):'<div class="card"><p>No tanks configured.</p></div>';
    document.getElementById('dashboard-status').textContent=low.length?low.length+' tank(s) are at or below 10% capacity.':'Live data from Supabase.';
  }catch(e){const s=document.getElementById('dashboard-status');if(s)s.textContent=e.message;if(e.message==='Unauthorized')location.href='admin-login.html';}
}

async function adminSettings(){
  try{
    const me=await currentUser();
    if(me.role!=='admin')return location.href='employee-dashboard.html';
    await loadSettingsData();
  }catch(e){
    const box=document.getElementById('settings-status');
    if(box)box.textContent='Settings error: '+e.message;
    toast('Settings error: '+e.message);
  }
}
async function loadSettingsData(){
  const [employees,tanks,dispensers,shifts,products]=await Promise.all([api('/api/employees'),api('/api/tanks'),api('/api/nozzles'),api('/api/shifts'),api('/api/products')]);
  const productByName=Object.fromEntries(products.map(p=>[String(p.name).toLowerCase(),p]));
  const codeForProduct=product=>productByName[String(product||'').toLowerCase()]?.code_name||product;
  document.getElementById('products').innerHTML=products.length?products.map(p=>`<div class="card"><div class="top"><div><b><span style="display:inline-block;width:14px;height:14px;border-radius:50%;background:${h(p.color)};vertical-align:-1px;margin-right:6px"></span>${h(p.code_name)}</b><br><span class="muted">Name: ${h(p.name)} • ${p.active?'Active':'Inactive'}</span></div><div class="row"><button type="button" onclick="openProductEdit('${p.id}')">Edit</button><button type="button" onclick="toggleProduct('${p.id}',${p.active})">${p.active?'Deactivate':'Activate'}</button></div></div></div>`).join(''):'<p class="muted">No products.</p>';
  window.productRecords=products;
  document.getElementById('employees').innerHTML=employees.length?employees.map(e=>`<div class="card"><div class="top"><div><b>${h(e.name)}</b><br><span class="muted">Operator ID: <b>${h(e.operator_id)}</b> • ${h(e.phone)} • ${h(e.role)}</span></div><div class="row"><button type="button" onclick="openEmployeeEdit('${e.id}')">Edit</button><button type="button" onclick="toggleEmployee('${e.id}',${e.active})">${e.active?'Deactivate':'Activate'}</button></div></div></div>`).join(''):'<p class="muted">No employees.</p>';
  window.employeeRecords=employees;
  document.getElementById('tanks').innerHTML=tanks.length?tanks.map(t=>`<div class="card"><div class="top"><div><b>${h(t.tank_code)} — ${h(codeForProduct(t.product))}</b><p>${liters(t.capacity_liters)} L capacity • ${t.active===false?'Inactive':'Active'}</p></div><div class="row"><button type="button" onclick="openTankEdit('${t.id}')">Edit</button><button type="button" onclick="toggleTank('${t.id}',${t.active!==false})">${t.active===false?'Activate':'Deactivate'}</button><button type="button" onclick="removeTank('${t.id}')">Remove</button></div></div></div>`).join(''):'<p class="muted">No tanks.</p>';
  window.tankRecords=tanks;
  document.getElementById('dispensers').innerHTML=dispensers.length?dispensers.map(n=>`<div class="card"><div class="top"><div><b>${h(n.nozzle_code)} — ${h(codeForProduct(n.product))}</b><br><span class="muted">Tank: ${h((tanks.find(t=>t.id===n.tank_id)||{}).tank_code||n.tank_id)} • ${h(n.nozzle_count||1)} nozzle(s) • ${n.active?'Active':'Inactive'}</span><div class="muted" style="margin-top:6px"><b>Nozzle IDs:</b> ${(n.nozzle_ids||[]).map(id=>`<span style="display:inline-block;margin:2px 4px 2px 0">${h(id)}</span>`).join('')}</div></div><div class="row"><button type="button" onclick="openDispenserEdit('${n.id}')">Edit</button><button type="button" onclick="toggleNozzle('${n.id}',${n.active})">${n.active?'Deactivate':'⚠️ Activate'}</button><button type="button" onclick="removeDispenser('${n.id}')">Remove</button></div></div></div>`).join(''):'<p class="muted">No dispensers.</p>';
window.dispenserRecords=dispensers;
  const es=document.getElementById('shift-employee'),ns=document.getElementById('shift-nozzle');
  es.innerHTML='<option value="">Select employee</option>'+employees.filter(e=>e.active&&e.role==='employee').map(e=>`<option value="${e.id}">${h(e.name)} — ID ${h(e.operator_id)}</option>`).join('');
  document.getElementById('tank-product').innerHTML='<option value="">Select product</option>'+products.filter(p=>p.active).map(p=>`<option value="${h(p.name)}">${h(p.code_name)}</option>`).join('');
  document.getElementById('dispenser-product').innerHTML='<option value="">Select product</option>'+products.filter(p=>p.active).map(p=>`<option value="${h(p.name)}">${h(p.code_name)}</option>`).join('');
  document.getElementById('dispenser-tank').innerHTML='<option value="">Select tank</option>'+tanks.filter(t=>t.active!==false).map(t=>`<option value="${t.id}">${h(t.tank_code)} — ${h(codeForProduct(t.product))}</option>`).join('');
  ns.innerHTML='<option value="">Select dispenser</option>'+dispensers.filter(n=>n.active).map(n=>`<option value="${n.id}">${h(n.nozzle_code)} — ${h(codeForProduct(n.product))}</option>`).join('');
  const en=Object.fromEntries(employees.map(e=>[e.id,e.name])),nn=Object.fromEntries(dispensers.map(n=>[n.id,n.nozzle_code]));
  document.getElementById('shifts').innerHTML=shifts.slice(0,20).map(s=>`<div class="card"><b>${h(en[s.employee_id]||s.employee_id)}</b> • ${h(nn[s.nozzle_id]||s.nozzle_id)}<br><span class="muted">${h(s.status)} • ${s.start_time?new Date(s.start_time).toLocaleString():'not started'}</span></div>`).join('')||'<p class="muted">No shifts.</p>';
  const dispenserProductSelect=document.getElementById('dispenser-product');
  const dispenserTankSelect=document.getElementById('dispenser-tank');
  if(dispenserProductSelect&&dispenserTankSelect){
    dispenserProductSelect.onchange=()=>{
      const product=dispenserProductSelect.value;
      dispenserTankSelect.innerHTML='<option value="">Select tank</option>'+tanks.filter(t=>t.active!==false&&String(t.product||'').toLowerCase()===String(product||'').toLowerCase()).map(t=>'<option value="'+t.id+'">'+h(t.tank_code)+' — '+h(codeForProduct(t.product))+'</option>').join('');
    };
  }
}
function openProductEdit(id){
  const p=(window.productRecords||[]).find(x=>x.id===id);
  if(!p)return;
  document.getElementById('edit-product-id').value=p.id;
  document.getElementById('edit-product-name').value=p.name||'';
  document.getElementById('edit-product-code').value=p.code_name||'';
  document.getElementById('edit-product-color').value=p.color||'#1264d8';
  const modal=document.getElementById('product-edit-modal');
  modal.classList.add('open');
  modal.setAttribute('aria-hidden','false');
  document.getElementById('edit-product-name').focus();
}
function closeProductEdit(){
  const modal=document.getElementById('product-edit-modal');
  modal.classList.remove('open');
  modal.setAttribute('aria-hidden','true');
  document.getElementById('product-edit-form').reset();
}
async function saveProductEdit(event){
  event.preventDefault();
  const id=document.getElementById('edit-product-id').value;
  try{
    await api('/api/products/'+id,{method:'PATCH',body:JSON.stringify({
      name:document.getElementById('edit-product-name').value.trim(),
      code_name:document.getElementById('edit-product-code').value.trim(),
      color:document.getElementById('edit-product-color').value
    })});
    closeProductEdit();
    toast('Product updated');
    await loadSettingsData();
  }catch(e){toast(e.message);}
}
async function createProduct(event){
  event.preventDefault();
  try{
    await api('/api/products',{method:'POST',body:JSON.stringify({
      name:document.getElementById('product-name').value.trim(),
      code_name:document.getElementById('product-code').value.trim(),
      color:document.getElementById('product-color').value
    })});
    event.target.reset();
    document.getElementById('product-color').value='#1264d8';
    toast('Product created');
    await loadSettingsData();
  }catch(e){toast(e.message);}
}
async function toggleProduct(id,active){
  try{await api('/api/products/'+id,{method:'PATCH',body:JSON.stringify({active:!active})});await loadSettingsData();}
  catch(e){toast(e.message);}
}

function openEmployeeEdit(id){
  const e=(window.employeeRecords||[]).find(x=>x.id===id);
  if(!e)return;
  document.getElementById('edit-employee-id').value=e.id;
  document.getElementById('edit-employee-name').value=e.name||'';
  document.getElementById('edit-employee-phone').value=e.phone||'';
  document.getElementById('edit-employee-role').value=e.role||'employee';
  document.getElementById('edit-employee-pin').value='';
  const modal=document.getElementById('employee-edit-modal');
  modal.classList.add('open');
  modal.setAttribute('aria-hidden','false');
  document.getElementById('edit-employee-name').focus();
}
function closeEmployeeEdit(){const modal=document.getElementById('employee-edit-modal');modal.classList.remove('open');modal.setAttribute('aria-hidden','true');document.getElementById('employee-edit-form').reset();}
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
async function createEmployee(e){e.preventDefault();try{await api('/api/employees',{method:'POST',body:JSON.stringify({name:document.getElementById('employee-name').value.trim(),phone:document.getElementById('employee-phone').value.trim(),pin:document.getElementById('employee-pin').value,role:document.getElementById('employee-role').value})});e.target.reset();toast('Employee created');await loadSettingsData();}catch(x){toast(x.message);}}
async function toggleEmployee(id,active){try{await api('/api/employees/'+id,{method:'PATCH',body:JSON.stringify({active:!active})});await loadSettingsData();}catch(e){toast(e.message);}}
function openTankEdit(id){
  const t=(window.tankRecords||[]).find(x=>x.id===id);
  if(!t)return;
  const match=String(t.tank_code||'').match(/•TANK (\d+)$/);
  const currentOrder=match?Number(match[1]):1;
  const productKey=String(t.product||'').toLowerCase();
  const sameProduct=(window.tankRecords||[]).filter(x=>String(x.product||'').toLowerCase()===productKey);
  const orders=sameProduct.map(x=>String(x.tank_code||'').match(/•TANK (\d+)$/)).filter(Boolean).map(m=>Number(m[1])).sort((a,b)=>a-b);
  const orderSelect=document.getElementById('edit-tank-order');
  orderSelect.innerHTML=orders.map(n=>'<option value="'+n+'">'+n+'</option>').join('');
  orderSelect.value=String(currentOrder);
  document.getElementById('edit-tank-id').value=t.id;
  document.getElementById('edit-tank-capacity').value=t.capacity_liters||'';
  const modal=document.getElementById('tank-edit-modal');
  modal.classList.add('open');
  modal.setAttribute('aria-hidden','false');
  document.getElementById('edit-tank-order').focus();
}
function closeTankEdit(){
  const modal=document.getElementById('tank-edit-modal');
  modal.classList.remove('open');
  modal.setAttribute('aria-hidden','true');
  document.getElementById('tank-edit-form').reset();
}
async function saveTankEdit(event){
  event.preventDefault();
  const id=document.getElementById('edit-tank-id').value;
  try{
    await api('/api/tanks/'+id,{method:'PATCH',body:JSON.stringify({
      tank_order:Number(document.getElementById('edit-tank-order').value),
      capacity_liters:Number(document.getElementById('edit-tank-capacity').value)
    })});
    closeTankEdit();
    toast('Tank updated');
    await loadSettingsData();
  }catch(e){toast(e.message);}
}
async function toggleTank(id,active){
  try{
    await api('/api/tanks/'+id,{method:'PATCH',body:JSON.stringify({active:!active})});
    toast(active?'Tank deactivated':'Tank activated');
    await loadSettingsData();
  }catch(e){toast(e.message);}
}
async function removeTank(id){
  if(!confirm('Remove this tank? This cannot be undone.'))return;
  try{
    await api('/api/tanks/'+id,{method:'DELETE'});
    toast('Tank removed');
    await loadSettingsData();
  }catch(e){toast(e.message);}
}
async function createTank(e){
  e.preventDefault();
  try{
    await api('/api/tanks',{method:'POST',body:JSON.stringify({
      product:document.getElementById('tank-product').value,
      capacity_liters:Number(document.getElementById('tank-capacity').value)
    })});
    e.target.reset();
    toast('Tank created');
    await loadSettingsData();
  }catch(x){toast(x.message);}
}
function openDispenserEdit(id){
  const d=(window.dispenserRecords||[]).find(x=>x.id===id);
  if(!d)return;
  const products=window.productRecords||[];
  const tanks=window.tankRecords||[];
  const productSelect=document.getElementById('edit-dispenser-product');
  productSelect.innerHTML='<option value="">Select product</option>'+products.filter(p=>p.active).map(p=>'<option value="'+h(p.name)+'">'+h(p.code_name)+'</option>').join('');
  productSelect.value=d.product||'';
  const fillTanks=()=>{
    const product=productSelect.value;
    document.getElementById('edit-dispenser-tank').innerHTML='<option value="">Select tank</option>'+tanks.filter(t=>t.active!==false&&String(t.product||'').toLowerCase()===String(product||'').toLowerCase()).map(t=>'<option value="'+t.id+'">'+h(t.tank_code)+' — '+h(t.capacity_liters)+' L</option>').join('');
  };
  fillTanks();
  document.getElementById('edit-dispenser-tank').value=d.tank_id||'';
  productSelect.onchange=()=>{fillTanks();document.getElementById('edit-dispenser-order').innerHTML='';};
  const productKey=String(d.product||'').toLowerCase();
  const same=(window.dispenserRecords||[]).filter(x=>String(x.product||'').toLowerCase()===productKey);
  const orders=same.map(x=>String(x.nozzle_code||'').match(/•DISPENSER (\d+)$/)).filter(Boolean).map(m=>Number(m[1])).sort((a,b)=>a-b);
  document.getElementById('edit-dispenser-order').innerHTML=orders.map(n=>'<option value="'+n+'">'+n+'</option>').join('');
  const m=String(d.nozzle_code||'').match(/•DISPENSER (\d+)$/);
  document.getElementById('edit-dispenser-order').value=m?m[1]:'';
  document.getElementById('edit-dispenser-nozzle-count').value=String(d.nozzle_count||1);
  document.getElementById('edit-dispenser-id').value=d.id;
  const modal=document.getElementById('dispenser-edit-modal');
  modal.classList.add('open');modal.setAttribute('aria-hidden','false');
  document.getElementById('edit-dispenser-product').focus();
}
function closeDispenserEdit(){
  const modal=document.getElementById('dispenser-edit-modal');
  modal.classList.remove('open');modal.setAttribute('aria-hidden','true');
  document.getElementById('dispenser-edit-form').reset();
}
async function saveDispenserEdit(event){
  event.preventDefault();
  const id=document.getElementById('edit-dispenser-id').value;
  try{
    await api('/api/nozzles/'+id,{method:'PATCH',body:JSON.stringify({
      product:document.getElementById('edit-dispenser-product').value,
      tank_id:document.getElementById('edit-dispenser-tank').value,
      tank_order:Number(document.getElementById('edit-dispenser-order').value),
      nozzle_count:Number(document.getElementById('edit-dispenser-nozzle-count').value)
    })});
    closeDispenserEdit();toast('Dispenser updated');await loadSettingsData();
  }catch(e){toast(e.message);}
}
let pendingDispenserActivationId=null;

function openDispenserActivation(id){
  const d=(window.dispenserRecords||[]).find(x=>x.id===id);
  if(!d)return;
  pendingDispenserActivationId=id;
  const productByName=Object.fromEntries((window.productRecords||[]).map(p=>[String(p.name).toLowerCase(),p]));
  const product=productByName[String(d.product||'').toLowerCase()];
  const tank=(window.tankRecords||[]).find(t=>t.id===d.tank_id);
  const message=document.getElementById('dispenser-activate-message');
  if(message)message.innerHTML='<b>'+h(d.nozzle_code||'Dispenser')+'</b> — '+h(product?.code_name||d.product||'')+'<br><span class="muted">Tank: '+h(tank?.tank_code||d.tank_id||'')+' • '+h(d.nozzle_count||1)+' nozzle(s)</span>';
  const list=document.getElementById('dispenser-nozzle-activation-list');
  const ids=d.nozzle_ids||[];
  list.innerHTML=ids.length?ids.map((nozzleId,i)=>'<div class="card" style="margin:0 0 8px;padding:10px"><div class="top"><label style="display:flex;align-items:center;gap:8px;margin:0"><span><b>'+h(nozzleId)+'</b></span><button type="button" onclick="showNozzleActivationInput('+i+')" style="padding:4px 8px">Activate</button></label></div><div id="nozzle-activation-input-'+i+'" style="display:none;margin-top:8px"><input id="nozzle-activation-number-'+i+'" type="number" min="0" step="0.01" placeholder="Enter activation number" inputmode="decimal"></div></div>').join(''):'<p class="muted">No nozzles configured.</p>';
  document.getElementById('dispenser-activate-error').style.display='none';
  const modal=document.getElementById('dispenser-activate-modal');
  modal.classList.add('open');
  modal.setAttribute('aria-hidden','false');
}

function showNozzleActivationInput(index){
  const box=document.getElementById('nozzle-activation-input-'+index);
  const input=document.getElementById('nozzle-activation-number-'+index);
  if(!box||!input)return;
  box.style.display=box.style.display==='none'?'block':'none';
  if(box.style.display==='block')input.focus();
}

function closeDispenserActivation(){
  pendingDispenserActivationId=null;
  const modal=document.getElementById('dispenser-activate-modal');
  modal.classList.remove('open');
  modal.setAttribute('aria-hidden','true');
}

async function confirmDispenserActivation(){
  const id=pendingDispenserActivationId;
  if(!id)return;
  const d=(window.dispenserRecords||[]).find(x=>x.id===id);
  if(!d)return;
  const ids=d.nozzle_ids||[];
  const selected=[];
  ids.forEach((nozzleId,i)=>{
    const box=document.getElementById('nozzle-activation-input-'+i);
    const input=document.getElementById('nozzle-activation-number-'+i);
    if(box&&box.style.display!=='none'&&input&&input.value.trim()!==''&&Number(input.value)>=0)selected.push({nozzle_id:nozzleId,activation_number:Number(input.value)});
  });
  const error=document.getElementById('dispenser-activate-error');
  if(!selected.length){
    error.textContent='Activate at least one nozzle and enter its activation number before activating the dispenser.';
    error.style.display='block';
    return;
  }
  try{
    await api('/api/nozzles/'+id,{method:'PATCH',body:JSON.stringify({active:true,activated_nozzles:selected})});
    closeDispenserActivation();
    toast('Dispenser activated');
    await loadSettingsData();
  }catch(e){toast(e.message);}
}

async function toggleNozzle(id,active){
  if(!active){openDispenserActivation(id);return;}
  try{await api('/api/nozzles/'+id,{method:'PATCH',body:JSON.stringify({active:false})});toast('Dispenser deactivated');await loadSettingsData();}
  catch(e){toast(e.message);}
}
async function removeDispenser(id){
  if(!confirm('Remove this dispenser? This cannot be undone.'))return;
  try{await api('/api/nozzles/'+id,{method:'DELETE'});toast('Dispenser removed');await loadSettingsData();}
  catch(e){toast(e.message);}
}
async function createDispenser(e){
  e.preventDefault();
  try{
    await api('/api/nozzles',{method:'POST',body:JSON.stringify({
      product:document.getElementById('dispenser-product').value,
      tank_id:document.getElementById('dispenser-tank').value,
      nozzle_count:Number(document.getElementById('dispenser-nozzle-count').value)
    })});
    e.target.reset();toast('Dispenser created');await loadSettingsData();
  }catch(x){toast(x.message);}
}
async function createShift(e){e.preventDefault();try{await api('/api/shifts',{method:'POST',body:JSON.stringify({employee_id:document.getElementById('shift-employee').value,nozzle_id:document.getElementById('shift-nozzle').value})});e.target.reset();toast('Shift assigned');await loadSettingsData();}catch(x){toast(x.message);}}

async function loadSaleContext(){
  try{
    const [shifts,nozzles,products]=await Promise.all([api('/api/shifts'),api('/api/nozzles'),api('/api/products')]);
    const productCodes=Object.fromEntries(products.map(p=>[String(p.name).toLowerCase(),p.code_name]));
    const codeForProduct=product=>productCodes[String(product||'').toLowerCase()]||product;
    const active=shifts.find(s=>s.status==='active'), box=document.getElementById('sale-context'),product=document.getElementById('product'),button=document.getElementById('sale-button');
    if(!active){box.textContent='No active shift. Start a shift first.';return;}
    const n=nozzles.find(x=>x.id===active.nozzle_id);if(!n){box.textContent='Assigned nozzle not found.';return;}
    box.innerHTML='Active nozzle: <b>'+h(n.nozzle_code)+' — '+h(codeForProduct(n.product))+'</b>';
    product.innerHTML='<option value="'+h(n.product)+'">'+h(codeForProduct(n.product))+'</option>';product.disabled=false;button.disabled=false;
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
    const [rows,products]=await Promise.all([api('/api/sales'),api('/api/products')]);
    const productCodes=Object.fromEntries(products.map(p=>[String(p.name).toLowerCase(),p.code_name]));
    const codeForProduct=product=>productCodes[String(product||'').toLowerCase()]||product;
    box.innerHTML=rows.length?rows.slice(0,20).map(s=>`<div class="card"><b>${h(codeForProduct(s.product))}</b> — ${liters(s.quantity_liters)} L × ${money(s.unit_price)}<br><span class="muted">${money(s.amount)} • ${h(s.payment_method)} • ${new Date(s.sale_time).toLocaleString()}</span></div>`).join(''):'No sales recorded yet.';
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
    const [tanks,purchases,products]=await Promise.all([api('/api/tanks'),api('/api/purchases'),api('/api/products')]);
    const productCodes=Object.fromEntries(products.map(p=>[String(p.name).toLowerCase(),p.code_name]));
    const codeForProduct=product=>productCodes[String(product||'').toLowerCase()]||product;
    document.getElementById('purchase-tank').innerHTML='<option value="">Select tank</option>'+tanks.map(t=>`<option value="${t.id}">${h(t.tank_code)} — ${h(codeForProduct(t.product))}</option>`).join('');
    const productNames=[...new Map(tanks.map(t=>[String(t.product).toLowerCase(),t.product])).values()];
    document.getElementById('purchase-product').innerHTML='<option value="">Select product</option>'+productNames.map(p=>`<option value="${h(p)}">${h(codeForProduct(p))}</option>`).join('');
    document.getElementById('purchase-tank').onchange=()=>{const t=tanks.find(x=>x.id===document.getElementById('purchase-tank').value);if(t)document.getElementById('purchase-product').value=t.product;};
    document.getElementById('purchase-list').innerHTML=purchases.length?purchases.map(p=>`<div class="card"><b>${h(codeForProduct(p.product))}</b> — ${liters(p.quantity_liters)} L<br><span class="muted">${h(p.supplier||'No supplier')} • ${new Date(p.purchase_date).toLocaleString()}</span></div>`).join(''):'<div class="card"><p>No purchases yet.</p></div>';
  }catch(e){document.getElementById('purchase-status').textContent=e.message;}
}
async function createPurchase(e){e.preventDefault();try{await api('/api/purchases',{method:'POST',body:JSON.stringify({product:document.getElementById('purchase-product').value,tank_id:document.getElementById('purchase-tank').value,quantity_liters:Number(document.getElementById('purchase-liters').value),supplier:document.getElementById('purchase-supplier').value.trim(),invoice_number:document.getElementById('purchase-invoice').value.trim()})});e.target.reset();toast('Purchase recorded and tank updated');await loadPurchases();}catch(x){toast(x.message);}}

async function loadDailyReport(){
  try{
    const d=document.getElementById('report-date').value||new Date().toISOString().slice(0,10),[r,products]=await Promise.all([api('/api/reports/daily?date='+encodeURIComponent(d)),api('/api/products')]);
     const productCodes=Object.fromEntries(products.map(p=>[String(p.name).toLowerCase(),p.code_name]));
     const codeForProduct=product=>productCodes[String(product||'').toLowerCase()]||product;
    document.getElementById('report-summary').innerHTML=`<div class="statgrid"><div class="stat"><b>${liters(r.summary.sales_liters)} L</b><span>Sales volume</span></div><div class="stat"><b>${money(r.summary.sales_amount)}</b><span>Sales amount</span></div><div class="stat"><b>${liters(r.summary.purchases_liters)} L</b><span>Purchases</span></div></div>`;
    const rows=Object.entries(r.summary.by_product).map(([p,v])=>`<tr><td>${h(codeForProduct(p))}</td><td>${liters(v.liters)}</td><td>${money(v.amount)}</td></tr>`).join('');
    document.getElementById('report-table').innerHTML=rows||'<tr><td colspan="3">No sales</td></tr>';
  }catch(e){document.getElementById('report-status').textContent=e.message;}
}
async function saveDailyReport(){try{await api('/api/reports/daily',{method:'POST',body:JSON.stringify({date:document.getElementById('report-date').value})});toast('Daily report saved');}catch(e){toast(e.message);}}

function toast(msg){const e=document.getElementById('toast');if(e){e.textContent=msg;e.style.display='block';setTimeout(()=>e.style.display='none',3000);}else alert(msg);}
