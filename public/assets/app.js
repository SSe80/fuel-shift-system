function showSettingsConfirmation(title,details,action,successTitle,successDetails){
  const modal=document.getElementById('settings-confirm-modal');
  if(!modal){return action();}
  window.pendingSettingsAction=action;
  window.pendingSettingsSuccess={
    title:successTitle||'Action completed successfully',
    details:successDetails||details||''
  };
  const titleEl=document.getElementById('settings-confirm-title');
  const detailsEl=document.getElementById('settings-confirm-details');
  const confirmActions=document.getElementById('settings-confirm-actions');
  const successActions=document.getElementById('settings-success-actions');
  if(titleEl)titleEl.textContent=title||'Confirm Change';
  if(detailsEl)detailsEl.innerHTML=details||'Review this change before confirming.';
  if(confirmActions)confirmActions.style.display='flex';
  if(successActions)successActions.style.display='none';
  modal.classList.add('open');modal.setAttribute('aria-hidden','false');
}
function closeSettingsConfirmation(){
  const modal=document.getElementById('settings-confirm-modal');
  if(modal){modal.classList.remove('open');modal.setAttribute('aria-hidden','true');}
  window.pendingSettingsAction=null;
  window.pendingSettingsSuccess=null;
}
function showSettingsSuccess(title,details){
  const modal=document.getElementById('settings-confirm-modal');
  if(!modal)return;
  const titleEl=document.getElementById('settings-confirm-title');
  const detailsEl=document.getElementById('settings-confirm-details');
  const confirmActions=document.getElementById('settings-confirm-actions');
  const successActions=document.getElementById('settings-success-actions');
  if(titleEl)titleEl.textContent='✓ '+(title||'Action completed successfully');
  if(detailsEl)detailsEl.innerHTML=details||'The change was applied successfully.';
  if(confirmActions)confirmActions.style.display='none';
  if(successActions)successActions.style.display='flex';
  modal.classList.add('open');modal.setAttribute('aria-hidden','false');
}
async function confirmSettingsAction(){
  const action=window.pendingSettingsAction;
  const success=window.pendingSettingsSuccess||{};
  if(!action)return;
  window.pendingSettingsAction=null;
  window.pendingSettingsSuccess=null;
  try{
    const result=await action();
    if(result===false)return;
    showSettingsSuccess(success.title,success.details);
  }catch(e){toast(e.message);}
}
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
const reading = value => { const n=Number(value); return Number.isFinite(n) ? n.toFixed(2).replace(/\.?0+$/,'') : '—'; };

async function login(role) {
  const operator_id=document.getElementById('operator-id').value.trim(), pin=document.getElementById('pin').value;
  try {
    const user=await api('/api/login',{method:'POST',body:JSON.stringify({operator_id,pin})});
    if(role==='admin' && user.role!=='admin') throw new Error('This account is not an admin account');
    localStorage.setItem('fuelRole',user.role);
    location.href=user.role==='admin'?'admin-dashboard.html':'attendant-dashboard.html';
  } catch(e) { toast(e.message); }
}
async function logout(){try{await api('/api/logout',{method:'POST',body:'{}'});}catch(_){} localStorage.removeItem('fuelRole');location.href='index.html';}
async function currentUser(){return (await api('/api/me')).user;}

async function userDashboard(){
  try{
    const me=await currentUser();
    if(me.role!=='attendant')return location.href='attendant-login.html';
    document.getElementById('name').textContent=me.name;
    const [shifts,nozzles,products,tanks,handovers,employees]=await Promise.all([
      api('/api/shifts'),api('/api/nozzles'),api('/api/products'),api('/api/tanks'),api('/api/handovers'),api('/api/users')
    ]);
    const productCodes=Object.fromEntries(products.map(p=>[String(p.name).toLowerCase(),p.code_name]));
    const codeForProduct=product=>productCodes[String(product||'').toLowerCase()]||product;
    const tankNames=Object.fromEntries(tanks.map(t=>[t.id,t.tank_code]));
    const active=shifts.filter(s=>s.status==='active');
    const pendingShifts=shifts.filter(s=>s.status==='assigned'&&String(s.employee_id)===String(me.id));
    const employeeNames=Object.fromEntries(employees.map(e=>[e.id,e.name]));
    const pendingHandovers=handovers.filter(x=>x.status==='pending'&&String(x.to_employee_id)===String(me.id));
    const box=document.getElementById('shift');

    const pendingShiftHtml=pendingShifts.map(s=>{
      const n=nozzles.find(x=>x.id===s.nozzle_id);
      const readings=Array.isArray(s.activation_nozzles)?s.activation_nozzles:[];
      const nozzleReadings=readings.length
        ?readings.map((x,i)=>'<div class="pending-nozzle-reading"><div class="pending-nozzle-top"><span class="pending-nozzle-pill">Nozzle '+(i+1)+'</span></div><div class="pending-nozzle-number">'+reading(x.opening_reading)+'</div><div class="pending-nozzle-code">'+h(x.nozzle_id)+'</div></div>').join('')
        :'<div class="muted">No nozzle readings recorded.</div>';
      return '<div class="card pending-confirmation-card">'+
        '<div class="pending-hero"><div class="pending-hero-icon">◷</div><div><div class="pending-card-title">Pending Shift Confirmation</div><div class="pending-card-subtitle">Please review the shift details and confirm when ready.</div></div></div>'+
        ''+
        '<div class="pending-shift-info"><div class="pending-info-block"><span class="pending-info-icon dispenser-icon">▣</span><div><span class="pending-label">Dispenser</span><strong>'+h(n?.nozzle_code||s.nozzle_id)+'</strong></div></div><div class="pending-info-divider"></div><div class="pending-info-block"><span class="pending-info-icon tank-icon">▤</span><div><span class="pending-label">Tank</span><strong>'+h(tankNames[n?.tank_id]||n?.tank_id||'Not connected')+'</strong></div></div><div class="pending-tank-opening"><span class="pending-info-icon tank-icon">▤</span><div><span class="pending-label">Tank opening</span><strong>'+liters(s.opening_tank_liters)+' <small>L</small></strong></div></div></div>'+
        '<div class="pending-nozzle-section"><div class="pending-nozzle-heading"><span class="pending-section-icon">⌁</span> Nozzle opening readings</div>'+nozzleReadings+'</div>'+
        '<form class="form" onsubmit="confirmShiftAssignment(event,\''+s.id+'\')">'+
        '<input id="assignment-pin-'+s.id+'" type="password" inputmode="numeric" autocomplete="current-password" placeholder="Enter your PIN" required>'+
        '<div class="row"><button class="primary">Confirm Readings & Start Shift</button><button type="button" onclick="cancelPendingShift(\''+s.id+'\')">Cancel Shift</button></div></form></div>';
    }).join('');

    const pendingHandoverHtml=pendingHandovers.map(x=>{
      const shift=shifts.find(s=>s.id===x.shift_id), n=nozzles.find(item=>item.id===shift?.nozzle_id);
      return '<div class="card"><div class="top"><h3>Pending Handover</h3><span class="badge">Awaiting confirmation</span></div>'+
        '<p>From: <b>'+h(employeeNames[x.from_employee_id]||x.from_employee_id)+'</b></p>'+
        '<p>Dispenser: <b>'+h(n?.nozzle_code||shift?.nozzle_id||'Dispenser')+'</b></p>'+
        '<p>Closing meter: <b>'+liters(x.closing_reading)+'</b> • Closing tank: <b>'+liters(x.closing_liters)+' L</b></p>'+
        '<form class="form" onsubmit="confirmHandoverFromDashboard(event,\''+x.id+'\')">'+
        '<input id="dashboard-confirm-reading-'+x.id+'" type="number" min="0" step="0.01" placeholder="Opening meter reading" required>'+
        '<input id="dashboard-confirm-mm-'+x.id+'" type="number" min="0" step="0.01" placeholder="Opening dip (mm)" required>'+
        '<input id="dashboard-confirm-liters-'+x.id+'" type="number" min="0" step="0.01" placeholder="Opening tank liters" required>'+
        '<input id="dashboard-handover-pin-'+x.id+'" type="password" inputmode="numeric" placeholder="Enter your PIN" required>'+
        '<button class="primary">Confirm Handover & Start Shift</button></form></div>';
    }).join('');

    const activeHtml=active.map(s=>{
      const n=nozzles.find(x=>x.id===s.nozzle_id);
      return '<div class="card"><div class="top"><h3>Active Shift</h3><span class="badge">active</span></div>'+
        '<p>Dispenser: <b>'+h(n?.nozzle_code||s.nozzle_id)+'</b> • '+h(codeForProduct(n?.product||''))+'</p>'+
        '<p>Tank: <b>'+h(tankNames[n?.tank_id]||n?.tank_id||'Not connected')+'</b></p>'+
        '<p>Opening meter: <b>'+liters(s.opening_reading)+'</b></p>'+
        '<div class="row"><a class="btn primary" href="sales.html?shift_id='+encodeURIComponent(s.id)+'">Record Sale</a>'+
        '<a class="btn" href="handover.html?shift_id='+encodeURIComponent(s.id)+'">Handover</a></div>'+
        '<button class="primary" type="button" onclick="closeShift(event,\''+s.id+'\')">Close Shift</button></div>';
    }).join('');

    box.innerHTML=pendingShiftHtml+pendingHandoverHtml+activeHtml;
    if(!box.innerHTML)box.innerHTML='';
  }catch(e){
    if(e.message==='Unauthorized')location.href='attendant-login.html';
    else{const s=document.getElementById('employee-status');if(s)s.textContent=e.message;}
  }
}
async function loadAttendantShiftPage(){
  try{
    const me=await currentUser();
    if(me.role!=='attendant')return location.href='attendant-login.html';
    document.getElementById('name').textContent=me.name;
    const [shifts,nozzles,products,employees,tanks]=await Promise.all([
      api('/api/shifts'),api('/api/nozzles'),api('/api/products'),api('/api/users'),api('/api/tanks')
    ]);
    const productCodes=Object.fromEntries(products.map(p=>[String(p.name).toLowerCase(),p.code_name]));
    const codeForProduct=product=>productCodes[String(product||'').toLowerCase()]||product;
    const tankNames=Object.fromEntries(tanks.map(t=>[t.id,t.tank_code]));
    const mine=shifts.filter(s=>s.employee_id===me.id);
    const pending=mine.filter(s=>s.status==='assigned');
    const pendingBox=document.getElementById('pending-confirmations');
    if(pendingBox){
      pendingBox.innerHTML=pending.length?pending.map(s=>{
        const n=nozzles.find(x=>x.id===s.nozzle_id);
        const readings=Array.isArray(s.activation_nozzles)?s.activation_nozzles:[];
        const nozzleReadings=readings.length?readings.map(x=>'<div class="pending-nozzle-reading"><div class="pending-nozzle-top"><span class="pending-nozzle-pill">Nozzle '+(readings.indexOf(x)+1)+'</span></div><div class="pending-nozzle-number">'+reading(x.opening_reading)+'</div><div class="pending-nozzle-code">'+h(x.nozzle_id)+'</div></div>').join(''):'<div class="muted">No nozzle readings recorded.</div>';
        return '<div class="card pending-confirmation-card">'+
          '<div class="pending-hero"><div class="pending-hero-icon">◷</div><div><div class="pending-card-title">Pending Shift Confirmation</div><div class="pending-card-subtitle">Please review the shift details and confirm when ready.</div></div></div>'+
          ''+
          '<div class="pending-shift-info"><div class="pending-info-block"><span class="pending-info-icon dispenser-icon">▣</span><div><span class="pending-label">Dispenser</span><strong>'+h(n?.nozzle_code||s.nozzle_id)+'</strong></div></div><div class="pending-info-divider"></div><div class="pending-info-block"><span class="pending-info-icon tank-icon">▤</span><div><span class="pending-label">Tank</span><strong>'+h(tankNames[n?.tank_id]||n?.tank_id||'Not connected')+'</strong></div></div><div class="pending-tank-opening"><span class="pending-info-icon tank-icon">▤</span><div><span class="pending-label">Tank opening</span><strong>'+liters(s.opening_tank_liters)+' <small>L</small></strong></div></div></div>'+
          '<div class="pending-nozzle-section"><div class="pending-nozzle-heading"><span class="pending-section-icon">⌁</span> Nozzle opening readings</div>'+nozzleReadings+'</div>'+
          '<form class="form" onsubmit="confirmShiftAssignment(event,\''+s.id+'\')"><input id="assignment-pin-'+s.id+'" type="password" inputmode="numeric" autocomplete="current-password" placeholder="Enter your PIN" required><div class="row"><button class="primary">Confirm Readings & Start Shift</button><button type="button" onclick="cancelPendingShift(\''+s.id+'\')">Cancel Shift</button></div></form></div>';
      }).join(''):'<div class="card"><p>No pending shift confirmations.</p></div>';
    }
    const history=mine.filter(s=>s.status!=='assigned');
    const historyBox=document.getElementById('shift-history');
    if(historyBox){
      historyBox.innerHTML=history.length?[...history].sort((a,b)=>new Date(b.start_time||b.assigned_at||b.created_at)-new Date(a.start_time||a.assigned_at||a.created_at)).map(s=>{
        const n=nozzles.find(x=>x.id===s.nozzle_id);
        return '<div class="card"><div class="top"><h3>Shift '+h(s.id.slice(0,8))+'</h3><span class="badge">'+h(s.status)+'</span></div><p>Dispenser: <b>'+h(n?.nozzle_code||s.nozzle_id)+'</b> • '+h(codeForProduct(n?.product||''))+'</p><p>Opening meter: <b>'+liters(s.opening_reading)+'</b> • Closing meter: <b>'+liters(s.closing_reading)+'</b></p><p class="muted">'+(s.start_time?'Started: '+new Date(s.start_time).toLocaleString():'Assigned: '+new Date(s.assigned_at||s.created_at).toLocaleString())+(s.end_time?' • Ended: '+new Date(s.end_time).toLocaleString():'')+'</p></div>';
      }).join(''):'<div class="card"><p>No shift history yet.</p></div>';
    }
  }catch(e){
    if(e.message==='Unauthorized')location.href='attendant-login.html';
    else{const s=document.getElementById('shift-page-status');if(s)s.textContent=e.message;}
  }
}
async function confirmShiftAssignment(event,id){
  event.preventDefault();
  const pin=document.getElementById('assignment-pin-'+id)?.value||'';
  try{await api('/api/shifts/'+id+'/confirm',{method:'POST',body:JSON.stringify({pin})});toast('Shift confirmed and started');await userDashboard();}
  catch(e){toast(e.message);}
}
async function cancelPendingShift(id){
  if(!confirm('Cancel this pending shift assignment?'))return;
  try{
    await api('/api/shifts/'+id+'/cancel',{method:'POST',body:'{}'});
    toast('Shift assignment cancelled');
    await userDashboard();
  }catch(e){toast(e.message);}
}
async function confirmHandoverFromDashboard(event,id){
  event.preventDefault();
  try{await api('/api/handovers/'+id+'/confirm',{method:'POST',body:JSON.stringify({opening_reading:Number(document.getElementById('dashboard-confirm-reading-'+id).value),opening_mm:Number(document.getElementById('dashboard-confirm-mm-'+id).value),opening_liters:Number(document.getElementById('dashboard-confirm-liters-'+id).value),pin:document.getElementById('dashboard-handover-pin-'+id).value})});toast('Handover confirmed and shift started');await userDashboard();}
  catch(e){toast(e.message);}
}

async function closeShift(event,id){
  if(event?.preventDefault)event.preventDefault();
  try{
    await api('/api/shifts/'+id+'/close',{method:'POST',body:'{}'});
    toast('Shift closed');
    await userDashboard();
  }catch(e){toast(e.message);}
}

async function adminDashboard(){
  try{
    const me=await currentUser(); if(me.role!=='admin')return location.href='admin-login.html';
    const [allTanks,sales,allShifts,allProducts,allDispensers,employees,purchases]=await Promise.all([api('/api/tanks'),api('/api/sales'),api('/api/shifts'),api('/api/products'),api('/api/nozzles'),api('/api/users'),api('/api/purchases')]);
    const products=allProducts.filter(p=>p.active===true);
    const productCodes=Object.fromEntries(products.map(p=>[String(p.name).toLowerCase(),p.code_name]));
    const codeForProduct=product=>productCodes[String(product||'').toLowerCase()]||product;
    const tanks=allTanks.filter(t=>t.active===true && products.some(p=>String(p.name).toLowerCase()===String(t.product||'').toLowerCase()));
    const dispensers=allDispensers.filter(d=>d.active===true && tanks.some(t=>t.id===d.tank_id) && products.some(p=>String(p.name).toLowerCase()===String(d.product||'').toLowerCase()));
    const activeEmployees=employees.filter(e=>e.active===true);
    const activeEmployeeIds=new Set(activeEmployees.map(e=>e.id));
    const shifts=allShifts.filter(s=>activeEmployeeIds.has(s.employee_id) && dispensers.some(d=>d.id===s.nozzle_id));
    const today=new Date().toISOString().slice(0,10);
    const todaySales=sales.filter(s=>String(s.sale_time||'').slice(0,10)===today);
    const total=todaySales.reduce((a,s)=>a+Number(s.amount||0),0);
    const activeShifts=shifts.filter(s=>s.status==='active');
    const low=tanks.filter(t=>Number(t.capacity_liters)>0&&Number(t.current_liters)/Number(t.capacity_liters)<=.1);
    const el=id=>document.getElementById(id);
    el('sales').textContent=todaySales.length; el('sales-total').textContent=money(total);
    el('active-shifts').textContent=activeShifts.length; el('tank-count').textContent=tanks.length; el('alerts').textContent=low.length;
    el('product-count').textContent=products.length; el('dispenser-count').textContent=dispensers.length; el('attendant-count').textContent=activeEmployees.filter(e=>e.role==='attendant').length;
    el('products').innerHTML=products.length?products.map(p=>'<div class="stat"><b>'+h(p.code_name)+'</b><span>'+h(p.name)+'</span><small>Active • Selling price: '+money(p.selling_price)+'</small></div>').join(''):'<div class="card"><p>No activated products.</p></div>';
    el('dispensers').innerHTML=dispensers.length?dispensers.map(d=>{
      const tank=tanks.find(t=>t.id===d.tank_id);
      const shift=activeShifts.find(s=>s.nozzle_id===d.id);
      const attendant=shift?activeEmployees.find(e=>e.id===shift.employee_id):null;
      return '<div class="stat"><b>'+h(d.nozzle_code)+'</b><span>'+h(codeForProduct(d.product))+' • '+h(tank?.tank_code||'No tank')+'</span><small>Active • '+h(d.nozzle_count||1)+' nozzle(s) • '+(shift?'Shift active — '+h(attendant?.name||'Attendant'):'No active shift')+'</small></div>';
    }).join(''):'<div class="card"><p>No activated dispensers.</p></div>';
    el('attendants').innerHTML=activeEmployees.filter(e=>e.role==='attendant').length?activeEmployees.filter(e=>e.role==='attendant').map(e=>{
      const shift=activeShifts.find(s=>s.employee_id===e.id);
      return '<div class="stat"><b>'+h(e.name)+'</b><span>Attendant • ID '+h(e.operator_id)+'</span><small>'+ (shift?'Active shift on '+h((dispensers.find(d=>d.id===shift.nozzle_id)||{}).nozzle_code||shift.nozzle_id):'Available / no active shift')+'</small></div>';
    }).join(''):'<div class="card"><p>No activated attendants.</p></div>';
    el('tanks').innerHTML=tanks.length?tanks.map(t=>{
      const pct=Number(t.capacity_liters)>0?Math.max(0,Math.min(100,Number(t.current_liters)/Number(t.capacity_liters)*100)):0;
      const tankOpening=t.opening_stock_liters;
      const connected=dispensers.filter(d=>d.tank_id===t.id);
      const comparisons=connected.map(d=>{
        const dispenserOpening=d.opening_tank_liters,hasTank=Number.isFinite(Number(tankOpening)),hasDispenser=Number.isFinite(Number(dispenserOpening));
        const variance=hasTank&&hasDispenser?Number(dispenserOpening)-Number(tankOpening):null;
        return '<div style="margin-top:8px;padding-top:8px;border-top:1px solid rgba(127,127,127,.2)"><b>'+h(d.nozzle_code)+'</b> • Dispenser opening: '+(hasDispenser?liters(dispenserOpening)+' L':'Not recorded')+(variance===null?'':'<br><span class="muted">Difference vs tank activation: <b>'+liters(variance)+' L</b></span>')+'</div>';
      }).join('');
      return '<div class="stat"><b>'+liters(t.current_liters)+' L</b><span>'+h(t.tank_code)+' • '+h(codeForProduct(t.product))+'</span><small>'+pct.toFixed(1)+'% full • Capacity '+liters(t.capacity_liters)+' L</small><small>Tank activation opening: <b>'+(Number.isFinite(Number(tankOpening))?liters(tankOpening)+' L':'Not recorded')+'</b></small>'+(comparisons||'<small>No activated dispenser.</small>')+'</div>';
    }).join(''):'<div class="card"><p>No activated tanks.</p></div>';
    const recent=[...todaySales.map(s=>({time:s.sale_time,text:'Sale • '+codeForProduct(s.product)+' • '+liters(s.quantity_liters)+' L • '+money(s.amount)})),...purchases.filter(p=>String(p.purchase_date||'').slice(0,10)===today).map(p=>({time:p.purchase_date,text:'Purchase • '+codeForProduct(p.product)+' • '+liters(p.quantity_liters)+' L'})),...activeShifts.map(s=>({time:s.assigned_at||s.created_at,text:'Shift active • '+(activeEmployees.find(e=>e.id===s.employee_id)?.name||'Attendant')+' • '+((dispensers.find(d=>d.id===s.nozzle_id)||{}).nozzle_code||'Dispenser')}))].sort((a,b)=>new Date(b.time)-new Date(a.time)).slice(0,12);
    el('activity').innerHTML=recent.length?recent.map(x=>'<div class="card"><b>'+h(x.text)+'</b><br><span class="muted">'+new Date(x.time).toLocaleString()+'</span></div>').join(''):'<div class="card"><p>No activity recorded today.</p></div>';
    el('dashboard-status').textContent=low.length?low.length+' tank(s) are at or below 10% capacity.':'Dashboard shows only activated Settings records.';
  }catch(e){const s=document.getElementById('dashboard-status');if(s)s.textContent=e.message;if(e.message==='Unauthorized')location.href='admin-login.html';}
}
async function adminSettings(){
  try{
    const me=await currentUser();
    if(me.role!=='admin')return location.href='admin-login.html';
    await loadSettingsData();
  }catch(e){
    const box=document.getElementById('settings-status');
    if(box)box.textContent='Settings error: '+e.message;
    toast('Settings error: '+e.message);
  }
}
async function _cancelAdminPendingShift(id){
  try{
    await api('/api/shifts/'+id+'/cancel',{method:'POST',body:'{}'});
    await loadSettingsData();
  }catch(e){throw e;}
}
async function loadSettingsData(){
  const [employees,tanks,dispensers,products,shifts]=await Promise.all([api('/api/users'),api('/api/tanks'),api('/api/nozzles'),api('/api/products'),api('/api/shifts')]);
  const productByName=Object.fromEntries(products.map(p=>[String(p.name).toLowerCase(),p]));
  const codeForProduct=product=>productByName[String(product||'').toLowerCase()]?.code_name||product;
  const pendingHandovers=shifts.filter(x=>x.status==='assigned');
  const pendingByDispenser=Object.fromEntries(pendingHandovers.map(x=>[x.nozzle_id,x]));
  const names=Object.fromEntries(employees.map(e=>[e.id,e.name]));

  // Pending assignments are rendered in place of their dispenser card.
  // The separate pending-handover box is kept empty to avoid duplicate cards.
  const pendingBox=document.getElementById('pending-handovers');
  if(pendingBox) pendingBox.innerHTML='';

  document.getElementById('products').innerHTML=products.length?products.map(p=>`<div class="card ${p.active?'settings-active-card':''}"><div class="top"><div><b><span style="display:inline-block;width:14px;height:14px;border-radius:50%;background:${h(p.color)};vertical-align:-1px;margin-right:6px"></span>${h(p.code_name)}</b><div class="settings-card-details"><div><span>Name:</span> <b>${h(p.name)}</b></div><div><span>Status:</span> <b>${p.active?'Active':'Inactive'}</b></div><div><span>Price:</span> <b>${p.selling_price==null?'Not set':Number(p.selling_price).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})}</b></div></div></div><div class="row settings-card-actions"><button type="button" class="settings-toggle-action" onclick="toggleProduct('${p.id}',${p.active})">${p.active?'Deactivate':'Activate'}</button><button type="button" onclick="openProductEdit('${p.id}')">Edit</button><button type="button" class="settings-remove-action" onclick="removeProduct('${p.id}')">Remove</button></div></div></div>`).join(''):'<p class="muted">No products.</p>';
  window.productRecords=products;
  document.getElementById('employees').innerHTML=employees.length?employees.map(e=>`<div class="card ${e.active?'settings-active-card':''}"><div class="top"><div><b>${h(e.name)}</b><div class="settings-card-details"><div><span>Operator ID:</span> <b>${h(e.operator_id)}</b></div><div><span>Phone:</span> <b>${h(e.phone)}</b></div><div><span>Role:</span> <b>${h(e.role)}</b></div><div><span>Status:</span> <b>${e.active?'Active':'Inactive'}</b></div></div></div><div class="row settings-card-actions"><button type="button" class="settings-toggle-action" onclick="toggleUser('${e.id}',${e.active})">${e.active?'Deactivate':'Activate'}</button><button type="button" onclick="openUserEdit('${e.id}')">Edit</button><button type="button" class="settings-remove-action" onclick="removeUser('${e.id}')">Remove</button></div></div></div>`).join(''):'<p class="muted">No users.</p>';
  window.employeeRecords=employees;
  document.getElementById('tanks').innerHTML=tanks.length?tanks.map(t=>`<div class="card ${t.active!==false?'settings-active-card':''}"><div class="top"><div><b>${h(t.tank_code)} — ${h(codeForProduct(t.product))}</b><div class="settings-card-details"><div><span>Capacity:</span> <b>${liters(t.capacity_liters)} L</b></div><div><span>Status:</span> <b>${t.active===false?'Inactive':'Active'}</b></div><div><span>Opening stock:</span> <b>${t.opening_stock_liters==null?'Not recorded':liters(t.opening_stock_liters)+' L'}</b></div></div></div><div class="row settings-card-actions"><button type="button" class="settings-toggle-action" onclick="toggleTank('${t.id}',${t.active!==false})">${t.active===false?'Activate':'Deactivate'}</button><button type="button" onclick="openTankEdit('${t.id}')">Edit</button><button type="button" class="settings-remove-action" onclick="removeTank('${t.id}')">Remove</button></div></div></div>`).join(''):'<p class="muted">No tanks.</p>';
  window.tankRecords=tanks;
  document.getElementById('dispensers').innerHTML=dispensers.length?dispensers.map(n=>{
    const tank=tanks.find(t=>t.id===n.tank_id);
    const pending=pendingByDispenser[n.id];
    const shift=pending||shifts.find(s=>s.nozzle_id===n.id&&s.status==='active');
    const attendant=shift?employees.find(e=>e.id===shift.employee_id):null;
    const activeReadings=shift&&Array.isArray(shift.activation_nozzles)?shift.activation_nozzles:[];
    const activeReadingText=activeReadings.length
      ?activeReadings.map(r=>'<div class="dispenser-reading-row"><span>'+h(r.nozzle_id)+'</span><b>'+Number(r.opening_reading||0).toFixed(0)+'</b></div>').join('')
      :'<span class="muted">No opening readings recorded</span>';
    const productCode=codeForProduct(n.product);
    const nozzleCount=Number(n.nozzle_count||1);
    const nozzleLabel=nozzleCount===1?'1 nozzle':nozzleCount+' nozzles';
    const nozzleIds=(n.nozzle_ids||[]).map(id=>'<span class="dispenser-nozzle-tag">'+h(id)+'</span>').join('');
    if(pending){
      const readings=Array.isArray(pending.activation_nozzles)?pending.activation_nozzles:[];
      const readingText=readings.length
        ?readings.map(r=>'<div class="dispenser-reading-row"><span>'+h(r.nozzle_id)+'</span><b>'+Number(r.opening_reading||0).toFixed(0)+'</b></div>').join('')
        :'<span class="muted">No opening readings recorded</span>';
      return '<div class="card dispenser-settings-card dispenser-pending-card">'+
        '<div class="dispenser-card-head"><div><span class="section-kicker">SHIFT ASSIGNMENT</span><h3>Pending shift</h3><span class="badge">Awaiting attendant confirmation</span></div>'+
        '<button type="button" class="dispenser-danger-action" onclick="cancelAdminPendingShift(\''+pending.id+'\')">Cancel assignment</button></div>'+
        '<div class="dispenser-identity"><div class="dispenser-name">'+h(n.nozzle_code)+'</div><div class="dispenser-product">'+h(productCode)+' <span>•</span> '+h(nozzleLabel)+'</div></div>'+
        '<div class="dispenser-info-grid">'+
          '<div><span>Connected tank</span><b>'+h(tank?.tank_code||n.tank_id||'Not connected')+'</b></div>'+
          '<div><span>Tank opening</span><b>'+liters(pending.opening_tank_liters)+' L</b></div>'+
          '<div><span>Assigned attendant</span><b>'+h(names[pending.employee_id]||pending.employee_id)+'</b></div>'+
          '<div><span>Dispenser status</span><b>Inactive</b></div>'+
        '</div>'+
        '<div class="dispenser-detail-block"><span class="dispenser-detail-title">Nozzle opening readings</span>'+readingText+'</div>'+
        '<p class="dispenser-note">The dispenser will remain inactive until the assigned attendant confirms the readings with their PIN.</p>'+
      '</div>';
    }
    return '<div class="card dispenser-settings-card '+(n.active?'dispenser-active-card':'')+'">'+
      '<div class="dispenser-card-head"><div><span class="section-kicker">FUEL DISPENSER</span><h3>'+h(n.nozzle_code)+'</h3><div class="dispenser-product">'+h(productCode)+' <span>•</span> '+h(nozzleLabel)+'</div></div>'+
      '<div class="dispenser-status '+(n.active?'is-active':'is-inactive')+'"><span></span>'+(n.active?'Active':'Inactive')+'</div></div>'+
      '<div class="dispenser-main-body">'+
      '<div class="dispenser-info-grid">'+
        '<div><span>Connected tank</span><b>'+h(tank?.tank_code||n.tank_id||'Not connected')+'</b></div>'+
        '<div><span>Tank opening</span><b>'+(n.opening_tank_liters==null?'Not recorded':liters(n.opening_tank_liters)+' L')+'</b></div>'+
        (n.active?'<div><span>Current shift</span><b>'+(attendant?h(attendant.name):'No active shift')+'</b></div>':'')+
      '</div>'+
      '<div class="dispenser-detail-block"><span class="dispenser-detail-title">Nozzle opening readings</span>'+activeReadingText+'</div>'+
      '<div class="dispenser-detail-block"><span class="dispenser-detail-title">Nozzle identifiers</span><div class="dispenser-nozzle-list">'+(nozzleIds||'<span class="muted">No nozzle identifiers</span>')+'</div></div>'+
      '</div>'+
      '<div class="dispenser-card-actions">'+
        '<button type="button" class="primary" onclick="toggleNozzle(\''+n.id+'\','+n.active+')">'+(n.active?'DEACTIVATE':'ACTIVATE DISPENSER')+'</button>'+
        (!n.active?'<button type="button" onclick="openDispenserEdit(\''+n.id+'\')">Edit dispenser</button>':'')+
        '<button type="button" class="dispenser-remove-action" onclick="removeDispenser(\''+n.id+'\')">Remove</button>'+
      '</div>'+
    '</div>';
  }).join(''):'<p class="muted">No dispensers configured yet.</p>';
window.dispenserRecords=dispensers;
  const tankProductSelect=document.getElementById('tank-product');
  if(tankProductSelect){
    tankProductSelect.innerHTML='<option value="">Select product</option>'+products.filter(p=>p.active).map(p=>'<option value="'+h(p.name)+'">'+h(p.code_name)+'</option>').join('');
  }
  const dispenserProductSelect=document.getElementById('dispenser-product');
  const dispenserTankSelect=document.getElementById('dispenser-tank');
  if(dispenserProductSelect){
    dispenserProductSelect.innerHTML='<option value="">Select product</option>'+products.filter(p=>p.active).map(p=>'<option value="'+h(p.name)+'">'+h(p.code_name)+'</option>').join('');
  }
  if(dispenserProductSelect&&dispenserTankSelect){
    dispenserProductSelect.onchange=()=>{
      const product=dispenserProductSelect.value;
      dispenserTankSelect.innerHTML='<option value="">Select tank</option>'+tanks.filter(t=>t.active!==false&&String(t.product||'').toLowerCase()===String(product||'').toLowerCase()).map(t=>'<option value="'+t.id+'">'+h(t.tank_code)+' — '+h(codeForProduct(t.product))+'</option>').join('');
    };
  }
}
function openAddModal(id){
  const m=document.getElementById(id);
  if(!m)return;
  m.classList.add('open');
  m.setAttribute('aria-hidden','false');
}
function closeAddModal(id){
  const m=document.getElementById(id);
  if(!m)return;
  m.classList.remove('open');
  m.setAttribute('aria-hidden','true');
  const form=m.querySelector('form');
  if(form)form.reset();
  if(id==='add-product-modal'){
    const color=document.getElementById('product-color');
    if(color)color.value='#1264d8';
  }
}
function formatPriceMajorInput(input){
  if(!input)return;
  const digits=String(input.value||'').replace(/\D/g,'');
  input.value=digits?Number(digits).toLocaleString('en-US'):'';
}
function priceFromParts(majorId,centsId){
  const major=String(document.getElementById(majorId)?.value||'').replace(/,/g,'').replace(/\D/g,'');
  const cents=String(document.getElementById(centsId)?.value||'').replace(/\D/g,'').slice(0,2).padEnd(2,'0');
  if(!major)return null;
  return Number(major+'.'+cents);
}
function setPriceParts(price,majorId,centsId){
  const n=Number(price||0);
  const whole=Math.floor(n);
  const cents=Math.round((n-whole)*100);
  const a=document.getElementById(majorId), b=document.getElementById(centsId);
  if(a)a.value=whole.toLocaleString('en-US');
  if(b)b.value=String(cents).padStart(2,'0');
}
function bindPriceInputs(majorId,centsId){
  const a=document.getElementById(majorId),b=document.getElementById(centsId);
  if(a&&!a.dataset.bound){a.dataset.bound='1';a.addEventListener('input',()=>formatPriceMajorInput(a));}
  if(b&&!b.dataset.bound){b.dataset.bound='1';b.addEventListener('input',()=>{b.value=b.value.replace(/\D/g,'').slice(0,2);});}
}
function openProductEdit(id){
  const p=(window.productRecords||[]).find(x=>x.id===id);
  if(!p)return;
  document.getElementById('edit-product-id').value=p.id;
  document.getElementById('edit-product-name').value=p.name||'';
  document.getElementById('edit-product-code').value=p.code_name||'';
  document.getElementById('edit-product-color').value=p.color||'#1264d8';
  bindPriceInputs('edit-product-price-major','edit-product-price-cents');
  setPriceParts(p.selling_price,'edit-product-price-major','edit-product-price-cents');
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
async function _saveProductEdit(event){
  event.preventDefault();
  const id=document.getElementById('edit-product-id').value;
  try{
    await api('/api/products/'+id,{method:'PATCH',body:JSON.stringify({
      name:document.getElementById('edit-product-name').value.trim(),
      code_name:document.getElementById('edit-product-code').value.trim(),
      color:document.getElementById('edit-product-color').value,
      selling_price:priceFromParts('edit-product-price-major','edit-product-price-cents')
    })});
    closeProductEdit();
    await loadSettingsData();
  }catch(e){throw e;}
}
async function _createProduct(event){
  event.preventDefault();
  try{
    await api('/api/products',{method:'POST',body:JSON.stringify({
      name:document.getElementById('product-name').value.trim(),
      code_name:document.getElementById('product-code').value.trim(),
      color:document.getElementById('product-color').value,
      active:false
    })});
    closeAddModal('add-product-modal');
    document.getElementById('product-color').value='#1264d8';
    await loadSettingsData();
  }catch(e){throw e;}
}
async function _removeProduct(id){try{await api('/api/products/'+id,{method:'DELETE'});await loadSettingsData();}catch(e){throw e;}}
function removeProduct(id){
  const p=settingsRecord(window.productRecords,id);
  const details='<p><b>Product:</b> '+h(p?.code_name||p?.name||id)+'</p>'+settingsStatus('Will be permanently removed');
  showSettingsConfirmation('Review Product Removal',details,()=>_removeProduct(id),
    'Product removed successfully','<p>The product was removed successfully.</p>'+details);
}
function toggleProduct(id,active){ if(active){ deactivateProduct(id); } else { openProductActivation(id); } }
async function _deactivateProduct(id){try{await api('/api/products/'+id,{method:'PATCH',body:JSON.stringify({active:false})});await loadSettingsData();}catch(e){throw e;}}
function openProductActivation(id){
  const p=(window.productRecords||[]).find(x=>x.id===id); if(!p)return;
  document.getElementById('activation-target-id').value=id;
  document.getElementById('activation-target-type').value='product';
  document.getElementById('activation-target-title').textContent='Activate Product?';
  const priceBox=document.getElementById('product-activation-price');
  if(priceBox){priceBox.style.display='block';bindPriceInputs('activation-price-major','activation-price-cents');setPriceParts(p.selling_price,'activation-price-major','activation-price-cents');}
  document.getElementById('activation-target-message').innerHTML='<b>'+h(p.code_name)+'</b> — '+h(p.name)+'<br><span class="muted">This product will become available for tanks, dispensers and sales.</span>';
  openGenericActivationModal();
}

function openUserEdit(id){
  const e=(window.employeeRecords||[]).find(x=>x.id===id);
  if(!e)return;
  document.getElementById('edit-employee-id').value=e.id;
  document.getElementById('edit-attendant-name').value=e.name||'';
  document.getElementById('edit-attendant-phone').value=e.phone||'';
  document.getElementById('edit-attendant-role').value=e.role||'attendant';
  document.getElementById('edit-attendant-pin').value='';
  const modal=document.getElementById('employee-edit-modal');
  modal.classList.add('open');
  modal.setAttribute('aria-hidden','false');
  document.getElementById('edit-attendant-name').focus();
}
function closeUserEdit(){const modal=document.getElementById('employee-edit-modal');modal.classList.remove('open');modal.setAttribute('aria-hidden','true');document.getElementById('employee-edit-form').reset();}
async function _saveUserEdit(event){
  event.preventDefault();
  const id=document.getElementById('edit-employee-id').value;
  const body={
    name:document.getElementById('edit-attendant-name').value.trim(),
    phone:document.getElementById('edit-attendant-phone').value.trim(),
    role:document.getElementById('edit-attendant-role').value
  };
  const pin=document.getElementById('edit-attendant-pin').value.trim();
  if(pin)body.pin=pin;
  try{
    await api('/api/users/'+id,{method:'PATCH',body:JSON.stringify(body)});
    closeUserEdit();
    await loadSettingsData();
  }catch(e){throw e;}
}
async function _createUser(e){e.preventDefault();try{await api('/api/employees',{method:'POST',body:JSON.stringify({name:document.getElementById('attendant-name').value.trim(),phone:document.getElementById('attendant-phone').value.trim(),pin:document.getElementById('attendant-pin').value,role:document.getElementById('attendant-role').value,active:true})});e.target.reset();closeAddModal('add-user-modal');await loadSettingsData();}catch(e){throw e;}}
async function _removeUser(id){try{await api('/api/users/'+id,{method:'DELETE'});await loadSettingsData();}catch(e){throw e;}}
function removeUser(id){
  const e=settingsRecord(window.employeeRecords,id);
  const details='<p><b>User:</b> '+h(e?.name||id)+'</p>'+settingsStatus('Will be permanently removed');
  showSettingsConfirmation('Review User Removal',details,()=>_removeUser(id),
    'User removed successfully','<p>The user was removed successfully.</p>'+details);
}
function toggleUser(id,active){ if(active){ deactivateUser(id); } else { openUserActivation(id); } }
async function _deactivateUser(id){try{await api('/api/users/'+id,{method:'PATCH',body:JSON.stringify({active:false})});await loadSettingsData();}catch(e){throw e;}}
function openUserActivation(id){
  const e=(window.employeeRecords||[]).find(x=>x.id===id); if(!e)return;
  document.getElementById('activation-target-id').value=id;
  document.getElementById('activation-target-type').value='user';
  document.getElementById('activation-target-title').textContent='Activate User?';
  const priceBox=document.getElementById('product-activation-price'); if(priceBox)priceBox.style.display='none';
  document.getElementById('activation-target-message').innerHTML='<b>'+h(e.name)+'</b><br><span class="muted">'+h(e.role)+' • Operator ID: '+h(e.operator_id)+'</span>';
  openGenericActivationModal();
}
async function removeProduct(id){
  const p=settingsRecord(window.productRecords,id);
  const details='<p><b>Product:</b> '+h(p?.code_name||p?.name||id)+'</p>'+settingsStatus('Will be permanently removed');
  showSettingsConfirmation('Review Product Removal',details,()=>_removeProduct(id),
    'Product removed successfully','<p>The product was removed successfully.</p>'+details);
}
async function _removeProduct(id){
  try{await api('/api/products/'+id,{method:'DELETE'});await loadSettingsData();}catch(e){throw e;}
}
async function removeUser(id){
  const e=settingsRecord(window.employeeRecords,id);
  const details='<p><b>User:</b> '+h(e?.name||id)+'</p>'+settingsStatus('Will be permanently removed');
  showSettingsConfirmation('Review User Removal',details,()=>_removeUser(id),
    'User removed successfully','<p>The user was removed successfully.</p>'+details);
}
async function _removeUser(id){
  try{await api('/api/users/'+id,{method:'DELETE'});await loadSettingsData();}catch(e){throw e;}
}
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
async function _saveTankEdit(event){
  event.preventDefault();
  const id=document.getElementById('edit-tank-id').value;
  try{
    await api('/api/tanks/'+id,{method:'PATCH',body:JSON.stringify({
      tank_order:Number(document.getElementById('edit-tank-order').value),
      capacity_liters:Number(document.getElementById('edit-tank-capacity').value)
    })});
    closeTankEdit();
    await loadSettingsData();
  }catch(e){throw e;}
}
function toggleTank(id,active){ if(active){ deactivateTank(id); } else { openTankActivation(id); } }
async function _deactivateTank(id){try{await api('/api/tanks/'+id,{method:'PATCH',body:JSON.stringify({active:false})});await loadSettingsData();}catch(e){throw e;}}
function openTankActivation(id){
  const t=(window.tankRecords||[]).find(x=>x.id===id); if(!t)return;
  const productByName=Object.fromEntries((window.productRecords||[]).map(p=>[String(p.name).toLowerCase(),p]));
  const product=productByName[String(t.product||'').toLowerCase()];
  document.getElementById('activation-target-id').value=id;
  document.getElementById('activation-target-type').value='tank';
  document.getElementById('activation-target-title').textContent='Activate Fuel Tank?';
  const priceBox=document.getElementById('product-activation-price'); if(priceBox)priceBox.style.display='none';
  const stockBox=document.getElementById('tank-activation-stock'); if(stockBox)stockBox.style.display='block';
  const stockInput=document.getElementById('tank-opening-stock'); if(stockInput)stockInput.value='';
  document.getElementById('activation-target-message').innerHTML='<b>'+h(t.tank_code)+'</b> — '+h(product?.code_name||t.product)+'<br><span class="muted">Tank capacity: '+h(liters(t.capacity_liters))+' L • Product: '+(product?.active?'Active':'Inactive')+'</span>';
  openGenericActivationModal();
}
async function _removeTank(id){
  try{
    await api('/api/tanks/'+id,{method:'DELETE'});
    await loadSettingsData();
  }catch(e){throw e;}
}
async function _createTank(e){
  e.preventDefault();
  try{
    await api('/api/tanks',{method:'POST',body:JSON.stringify({
      product:document.getElementById('tank-product').value,
      capacity_liters:Number(document.getElementById('tank-capacity').value),
      active:false
    })});
    e.target.reset();
    closeAddModal('add-tank-modal');
    await loadSettingsData();
  }catch(e){throw e;}
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
async function _saveDispenserEdit(event){
  event.preventDefault();
  const id=document.getElementById('edit-dispenser-id').value;
  try{
    await api('/api/nozzles/'+id,{method:'PATCH',body:JSON.stringify({
      product:document.getElementById('edit-dispenser-product').value,
      tank_id:document.getElementById('edit-dispenser-tank').value,
      tank_order:Number(document.getElementById('edit-dispenser-order').value),
      nozzle_count:Number(document.getElementById('edit-dispenser-nozzle-count').value)
    })});
    closeDispenserEdit();await loadSettingsData();
  }catch(e){throw e;}
}
function openGenericActivationModal(){const m=document.getElementById('generic-activation-modal');if(!m)return;m.classList.add('open');m.setAttribute('aria-hidden','false');}
function closeGenericActivation(){const m=document.getElementById('generic-activation-modal');if(!m)return;m.classList.remove('open');m.setAttribute('aria-hidden','true');}
async function _confirmGenericActivation(){
  const id=document.getElementById('activation-target-id')?.value||'',type=document.getElementById('activation-target-type')?.value||'';
  if(!id||!type)return false;
  try{
    const path=type==='user'?'/api/users/'+id:type==='product'?'/api/products/'+id:'/api/tanks/'+id;
    const body={active:true};
    if(type==='product'){
      const price=priceFromParts('activation-price-major','activation-price-cents');
      if(price===null||price<=0){toast('Enter a valid selling price greater than zero');return false;}
      body.selling_price=price;
    }
    if(type==='tank'){
      const stockInput=document.getElementById('tank-opening-stock');
      const stock=stockInput?.value.trim()!==''?Number(stockInput.value):NaN;
      if(!Number.isFinite(stock)||stock<0){toast('Enter a valid opening stock reading in liters');return false;}
      body.opening_stock_liters=stock;
    }
    await api(path,{method:'PATCH',body:JSON.stringify(body)});
    closeGenericActivation();await loadSettingsData();
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
  if(!tank){toast('This dispenser has no connected tank.');return;}
  if(!tank.active){toast('This dispenser cannot be activated because its connected tank is inactive.');return;}
  const message=document.getElementById('dispenser-activate-message');
  if(message)message.innerHTML='<b>'+h(d.nozzle_code||'Dispenser')+'</b> — '+h(product?.code_name||d.product||'');
  const tankLabel=document.getElementById('dispenser-activation-tank-label');
  if(tankLabel)tankLabel.firstChild.textContent=''+(tank?.tank_code||'Tank')+' opening reading (liters)';
  const tankLitersInput=document.getElementById('dispenser-activation-tank-liters');
  if(tankLitersInput){
    const activationReading=Number(tank.opening_stock_liters);
    tankLitersInput.value=Number.isFinite(activationReading)&&activationReading>=0?String(activationReading):'';
  }
  const employeeSelect=document.getElementById('dispenser-activation-employee');
  if(employeeSelect)employeeSelect.innerHTML='<option value="">Select attendant</option>'+((window.employeeRecords||[]).filter(e=>e.active&&e.role==='attendant').map(e=>`<option value="${e.id}">${h(e.name)} — ID ${h(e.operator_id)}</option>`).join(''));
  const list=document.getElementById('dispenser-nozzle-activation-list');
  const ids=d.nozzle_ids||[];
  list.innerHTML=ids.length?ids.map((nozzleId,i)=>'<div class="card" style="margin:0 0 8px;padding:10px"><div class="top"><label style="display:flex;align-items:center;gap:8px;margin:0"><span><b>'+h(nozzleId)+'</b></span><button type="button" onclick="showNozzleActivationInput('+i+')" style="padding:4px 8px">Activate</button></label></div><div id="nozzle-activation-input-'+i+'" style="display:none;margin-top:8px"><input id="nozzle-activation-number-'+i+'" type="number" min="0" step="0.01" placeholder="Enter opening meter reading" inputmode="decimal"></div></div>').join(''):'<p class="muted">No nozzles configured.</p>';
  const review=document.getElementById('dispenser-activation-review');
  if(review)review.innerHTML='';
  const confirmation=document.getElementById('dispenser-attendant-confirmation');
  if(confirmation){confirmation.checked=false;confirmation.disabled=false;}
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

async function _confirmDispenserActivation(){
  const id=pendingDispenserActivationId;
  if(!id)return;
  const d=(window.dispenserRecords||[]).find(x=>x.id===id);
  if(!d)return;
  const ids=d.nozzle_ids||[];
  const employeeSelect=document.getElementById('dispenser-activation-employee');
  const employeeId=employeeSelect?.value||'';
  const attendantName=employeeSelect?.selectedOptions?.[0]?.textContent||'Selected attendant';
  const tankLitersInput=document.getElementById('dispenser-activation-tank-liters');
  const openingTankLiters=tankLitersInput?.value.trim()!==''?Number(tankLitersInput.value):NaN;
  const selected=[];
  ids.forEach((nozzleId,i)=>{
    const box=document.getElementById('nozzle-activation-input-'+i);
    const input=document.getElementById('nozzle-activation-number-'+i);
    if(box&&box.style.display!=='none'&&input&&input.value.trim()!==''&&Number(input.value)>=0)selected.push({nozzle_id:nozzleId,activation_number:Number(input.value)});
  });
  const error=document.getElementById('dispenser-activate-error');
  const review=document.getElementById('dispenser-activation-review');
  const confirmation=document.getElementById('dispenser-attendant-confirmation');
  if(!Number.isFinite(openingTankLiters)||openingTankLiters<0){
    error.textContent='Enter the tank opening reading in liters.';
    error.style.display='block'; return false;
  }
  if(!employeeId){
    error.textContent='Select an attendant before continuing.';
    error.style.display='block'; return false;
  }
  if(!selected.length){
    error.textContent='Activate at least one nozzle and enter its opening meter reading before continuing.';
    error.style.display='block'; return false;
  }
  if(review)review.innerHTML='<div class="card" style="margin:0"><b>Attendant reading confirmation</b><p style="margin:6px 0">Attendant: <b>'+h(attendantName)+'</b></p><p style="margin:6px 0">Tank opening: <b>'+liters(openingTankLiters)+' L</b></p><p style="margin:6px 0">Nozzle opening readings: '+selected.map(x=>'<b>'+h(x.nozzle_id)+'</b> = '+liters(x.activation_number)).join(' • ')+'</p><p class="muted" style="margin:6px 0 0">The selected Attendant must review these readings and confirm they are correct before the shift is activated.</p></div>';
  try{
    await api('/api/shifts',{method:'POST',body:JSON.stringify({
      employee_id:employeeId,
      nozzle_id:id,
      opening_tank_liters:openingTankLiters,
      activation_nozzles:selected.map(x=>({nozzle_id:x.nozzle_id,opening_reading:x.activation_number}))
    })});
    closeDispenserActivation();
    await loadSettingsData();
  }catch(e){toast(e.message);}
}

async function _toggleNozzle(id,active){
  if(!active){openDispenserActivation(id);return;}
  try{await api('/api/nozzles/'+id,{method:'PATCH',body:JSON.stringify({active:false})});await loadSettingsData();}
  catch(e){throw e;}
}
async function _removeDispenser(id){
  try{await api('/api/nozzles/'+id,{method:'DELETE'});await loadSettingsData();}
  catch(e){throw e;}
}
async function _createDispenser(e){
  e.preventDefault();
  try{
    await api('/api/nozzles',{method:'POST',body:JSON.stringify({
      product:document.getElementById('dispenser-product').value,
      tank_id:document.getElementById('dispenser-tank').value,
      nozzle_count:Number(document.getElementById('dispenser-nozzle-count').value)
    })});
    e.target.reset();closeAddModal('add-dispenser-modal');await loadSettingsData();
  }catch(e){throw e;}
}
async function createShift(e){e.preventDefault();try{await api('/api/shifts',{method:'POST',body:JSON.stringify({employee_id:document.getElementById('shift-employee').value,nozzle_id:document.getElementById('shift-nozzle').value})});e.target.reset();toast('Shift assigned');await loadSettingsData();}catch(x){toast(x.message);}}

async function loadSaleContext(){
  try{
    const [shifts,nozzles,products]=await Promise.all([api('/api/shifts'),api('/api/nozzles'),api('/api/products')]);
    const productCodes=Object.fromEntries(products.map(p=>[String(p.name).toLowerCase(),p.code_name]));
    const codeForProduct=product=>productCodes[String(product||'').toLowerCase()]||product;
    const active=shifts.filter(s=>s.status==='active'), box=document.getElementById('sale-context'),product=document.getElementById('product'),button=document.getElementById('sale-button');
    if(!active.length){box.textContent='No active shift. Start a shift first.';return;}
    const requested=new URLSearchParams(location.search).get('shift_id');
    const selected=active.find(s=>s.id===requested)||active[0];
    const shiftOptions=active.map(s=>{
      const n=nozzles.find(x=>x.id===s.nozzle_id);
      return '<option value="'+h(s.id)+'" '+(s.id===selected.id?'selected':'')+'>'+h(n?.nozzle_code||s.nozzle_id)+' — '+h(codeForProduct(n?.product||''))+'</option>';
    }).join('');
    box.innerHTML='<label>Active dispenser shift<select id="sale-shift" onchange="loadSaleShiftProduct()">'+shiftOptions+'</select></label>';
    window.saleShiftRecords={shifts,nozzles,products,codeForProduct};
    loadSaleShiftProduct();
    button.disabled=false;
  }catch(e){document.getElementById('sale-context').textContent=e.message;}
}
function loadSaleShiftProduct(){
  const shiftId=document.getElementById('sale-shift')?.value;
  const ctx=window.saleShiftRecords||{};
  const shift=(ctx.shifts||[]).find(s=>s.id===shiftId);
  const n=(ctx.nozzles||[]).find(x=>x.id===shift?.nozzle_id);
  const product=document.getElementById('product');
  if(!shift||!n||!product)return;
  product.innerHTML='<option value="'+h(n.product)+'">'+h(ctx.codeForProduct(n.product))+'</option>';
  product.disabled=false;
}
async function addSale(){
  const litersSold=Number(document.getElementById('liters').value),price=Number(document.getElementById('price').value),shiftId=document.getElementById('sale-shift')?.value;
  if(!shiftId)return toast('Select an active shift');
  if(!(litersSold>0)||price<0)return toast('Enter valid quantity and price');
  try{const r=await api('/api/sales',{method:'POST',body:JSON.stringify({shift_id:shiftId,product:document.getElementById('product').value,quantity_liters:litersSold,unit_price:price,payment_method:document.getElementById('payment').value})});toast('Sale recorded: '+liters(r.sale?.quantity_liters||litersSold)+' L');document.getElementById('liters').value='';await loadSalesHistory();}catch(e){toast(e.message);}
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
    const me=await currentUser(),[shifts,employees,nozzles]=await Promise.all([api('/api/shifts'),api('/api/users').catch(()=>[]),api('/api/nozzles')]);
    const active=shifts.filter(s=>s.status==='active');
    if(!active.length){document.getElementById('handover-status').textContent='No active shift.';return;}
    const requested=new URLSearchParams(location.search).get('shift_id');
    const selected=active.find(s=>s.id===requested)||active[0];
    document.getElementById('handover-shift').innerHTML=active.map(s=>{
      const n=nozzles.find(x=>x.id===s.nozzle_id);
      return '<option value="'+h(s.id)+'" '+(s.id===selected.id?'selected':'')+'>'+h(n?.nozzle_code||s.nozzle_id)+'</option>';
    }).join('');
    document.getElementById('handover-status').textContent='Select the dispenser shift to hand over.';
    document.getElementById('to-employee').innerHTML='<option value="">Select receiving attendant</option>'+employees.filter(e=>e.active&&e.id!==me.id&&e.role==='attendant').map(e=>'<option value="'+e.id+'">'+h(e.name)+' — ID '+h(e.operator_id)+'</option>').join('');
  }catch(e){document.getElementById('handover-status').textContent=e.message;}
}
async function submitHandover(e){e.preventDefault();try{await api('/api/handovers',{method:'POST',body:JSON.stringify({shift_id:document.getElementById('handover-shift').value,to_employee_id:document.getElementById('to-employee').value,closing_reading:Number(document.getElementById('closing-reading').value),closing_mm:Number(document.getElementById('closing-mm').value),closing_liters:Number(document.getElementById('closing-liters').value)})});toast('Handover submitted');setTimeout(()=>location.href='pending-handovers.html',700);}catch(x){toast(x.message);}}
async function loadPendingHandovers(){
  try{
    const [hs,emps]=await Promise.all([api('/api/handovers'),api('/api/users').catch(()=>[])]);
    const names=Object.fromEntries(emps.map(e=>[e.id,e.name]));
    const pending=hs.filter(x=>x.status==='pending');
    document.getElementById('pending-list').innerHTML=pending.length?pending.map(x=>`<div class="card"><h3>Handover ${h(x.id.slice(0,8))}</h3><p>From: <b>${h(names[x.from_employee_id]||x.from_employee_id)}</b><br>To: <b>${h(names[x.to_employee_id]||x.to_employee_id)}</b></p><p>Closing meter: ${liters(x.closing_reading)} • Tank: ${liters(x.closing_liters)} L</p><form class="form" onsubmit="confirmHandover(event,'${x.id}')"><input id="confirm-reading-${x.id}" type="number" min="0" step="0.01" placeholder="Opening meter" required><input id="confirm-mm-${x.id}" type="number" min="0" step="0.01" placeholder="Opening dip (mm)" required><input id="confirm-liters-${x.id}" type="number" min="0" step="0.01" placeholder="Opening tank liters" required><button class="primary">Confirm & Start Shift</button></form></div>`).join(''):'<div class="card"><p>No pending handovers.</p></div>';
  }catch(e){document.getElementById('pending-list').textContent=e.message;}
}
async function confirmHandover(e,id){e.preventDefault();try{await api('/api/handovers/'+id+'/confirm',{method:'POST',body:JSON.stringify({opening_reading:Number(document.getElementById('confirm-reading-'+id).value),opening_mm:Number(document.getElementById('confirm-mm-'+id).value),opening_liters:Number(document.getElementById('confirm-liters-'+id).value),pin:document.getElementById('confirm-pin-'+id).value})});toast('Handover confirmed');setTimeout(()=>location.href='attendant-dashboard.html',700);}catch(x){toast(x.message);}}

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

// Admin Settings action review wrappers
const settingsRecord=(records,id)=>((records||[]).find(x=>String(x.id)===String(id))||{});
const settingsDiff=(label,oldValue,newValue,unit='')=>{
  const same=String(oldValue??'')===String(newValue??'');
  return '<p style="margin:7px 0"><b>'+h(label)+':</b> '+h(oldValue??'—')+(same?'':' → <b>'+h(newValue??'—')+'</b>')+(unit?' '+h(unit):'')+'</p>';
};
const settingsStatus=(label)=>'<p style="margin:7px 0"><b>Status:</b> '+h(label)+'</p>';

async function saveProductEdit(event){
  event.preventDefault();
  const id=document.getElementById('edit-product-id').value;
  const old=settingsRecord(window.productRecords,id);
  const name=document.getElementById('edit-product-name').value.trim();
  const code=document.getElementById('edit-product-code').value.trim();
  const price=priceFromParts('edit-product-price-major','edit-product-price-cents');
  const details='<p><b>Product:</b> '+h(old.code_name||old.name||id)+'</p>'+
    settingsDiff('Name',old.name,name)+
    settingsDiff('Code',old.code_name,code)+
    settingsDiff('Selling price',money(old.selling_price),money(price));
  showSettingsConfirmation('Review Product Update',details,()=>_saveProductEdit(event),
    'Product updated successfully','<p><b>'+h(code||name)+'</b> was updated successfully.</p>'+details);
}
async function createProduct(event){
  event.preventDefault();
  const name=document.getElementById('product-name').value.trim(),code=document.getElementById('product-code').value.trim();
  const details='<p><b>Product:</b> '+h(name)+'</p><p><b>Code:</b> '+h(code)+'</p>'+settingsStatus('Inactive — ready for activation');
  showSettingsConfirmation('Review New Product',details,()=>_createProduct(event),
    'Product created successfully','<p><b>'+h(code)+'</b> was created successfully.</p>'+details);
}
async function deactivateProduct(id){
  const p=settingsRecord(window.productRecords,id);
  const details='<p><b>Product:</b> '+h(p.code_name||p.name||id)+'</p>'+settingsDiff('Status','Active','Inactive');
  showSettingsConfirmation('Review Product Deactivation',details,()=>_deactivateProduct(id),
    'Product deactivated successfully','<p>The product is now inactive.</p>'+details);
}
async function saveUserEdit(event){
  event.preventDefault();
  const id=document.getElementById('edit-employee-id').value,old=settingsRecord(window.employeeRecords,id);
  const name=document.getElementById('edit-attendant-name').value.trim();
  const phone=document.getElementById('edit-attendant-phone').value.trim();
  const role=document.getElementById('edit-attendant-role').value;
  const pinChanged=!!document.getElementById('edit-attendant-pin').value.trim();
  const details='<p><b>User:</b> '+h(old.name||id)+'</p>'+
    settingsDiff('Name',old.name,name)+settingsDiff('Phone',old.phone,phone)+settingsDiff('Role',old.role,role)+
    '<p style="margin:7px 0"><b>PIN:</b> '+(pinChanged?'Will be changed':'No change')+'</p>';
  showSettingsConfirmation('Review User Update',details,()=>_saveUserEdit(event),
    'User updated successfully','<p>User changes were saved.</p>'+details);
}
async function createUser(event){
  event.preventDefault();
  const name=document.getElementById('attendant-name').value.trim(),phone=document.getElementById('attendant-phone').value.trim(),role=document.getElementById('attendant-role').value;
  const details='<p><b>Name:</b> '+h(name)+'</p><p><b>Phone:</b> '+h(phone)+'</p><p><b>Role:</b> '+h(role)+'</p>'+settingsStatus('Active');
  showSettingsConfirmation('Review New User',details,()=>_createUser(event),
    'User created successfully','<p><b>'+h(name)+'</b> was created successfully.</p>'+details);
}
async function deactivateUser(id){
  const e=settingsRecord(window.employeeRecords,id);
  const details='<p><b>User:</b> '+h(e.name||id)+'</p>'+settingsDiff('Status','Active','Inactive');
  showSettingsConfirmation('Review User Deactivation',details,()=>_deactivateUser(id),
    'User deactivated successfully','<p>The user is now inactive.</p>'+details);
}
async function saveTankEdit(event){
  event.preventDefault();
  const id=document.getElementById('edit-tank-id').value,old=settingsRecord(window.tankRecords,id);
  const order=document.getElementById('edit-tank-order').value,cap=document.getElementById('edit-tank-capacity').value;
  const oldOrder=(String(old.tank_code||'').match(/•TANK (\d+)$/)||[])[1]||'—';
  const details='<p><b>Tank:</b> '+h(old.tank_code||id)+'</p>'+
    settingsDiff('Tank order',oldOrder,order)+settingsDiff('Capacity',liters(old.capacity_liters),liters(cap),'L');
  showSettingsConfirmation('Review Tank Update',details,()=>_saveTankEdit(event),
    'Tank updated successfully','<p><b>'+h(old.tank_code||id)+'</b> was updated successfully.</p>'+details);
}
async function deactivateTank(id){
  const t=settingsRecord(window.tankRecords,id);
  const details='<p><b>Tank:</b> '+h(t.tank_code||id)+'</p>'+settingsDiff('Status','Active','Inactive');
  showSettingsConfirmation('Review Tank Deactivation',details,()=>_deactivateTank(id),
    'Tank deactivated successfully','<p>The tank is now inactive.</p>'+details);
}
async function removeTank(id){
  const t=settingsRecord(window.tankRecords,id);
  const details='<p><b>Tank:</b> '+h(t.tank_code||id)+'</p>'+settingsStatus('Will be permanently removed');
  showSettingsConfirmation('Review Tank Removal',details,()=>_removeTank(id),
    'Tank removed successfully','<p>The tank was removed successfully.</p>'+details);
}
async function createTank(event){
  event.preventDefault();
  const product=document.getElementById('tank-product').value,cap=document.getElementById('tank-capacity').value;
  const productRecord=(window.productRecords||[]).find(p=>String(p.name)===String(product));
  const details='<p><b>Product:</b> '+h(productRecord?.code_name||product)+'</p><p><b>Capacity:</b> '+h(liters(cap))+' L</p>'+settingsStatus('Inactive — ready for activation');
  showSettingsConfirmation('Review New Fuel Tank',details,()=>_createTank(event),
    'Fuel tank created successfully','<p>The new fuel tank was created successfully.</p>'+details);
}
async function saveDispenserEdit(event){
  event.preventDefault();
  const id=document.getElementById('edit-dispenser-id').value,old=settingsRecord(window.dispenserRecords,id);
  const product=document.getElementById('edit-dispenser-product').value,tankId=document.getElementById('edit-dispenser-tank').value,count=document.getElementById('edit-dispenser-nozzle-count').value;
  const tank=(window.tankRecords||[]).find(t=>String(t.id)===String(tankId));
  const oldTank=(window.tankRecords||[]).find(t=>String(t.id)===String(old.tank_id));
  const oldOrder=(String(old.nozzle_code||'').match(/•DISPENSER (\d+)$/)||[])[1]||'—';
  const newOrder=document.getElementById('edit-dispenser-order').value;
  const details='<p><b>Dispenser:</b> '+h(old.nozzle_code||id)+'</p>'+
    settingsDiff('Product',old.product,product)+
    settingsDiff('Tank',oldTank?.tank_code||old.tank_id,tank?.tank_code||tankId)+
    settingsDiff('Dispenser order',oldOrder,newOrder)+
    settingsDiff('Nozzles',old.nozzle_count,count);
  showSettingsConfirmation('Review Dispenser Update',details,()=>_saveDispenserEdit(event),
    'Dispenser updated successfully','<p><b>'+h(old.nozzle_code||id)+'</b> was updated successfully.</p>'+details);
}
async function _confirmGenericActivationReview(){
  const id=document.getElementById('activation-target-id')?.value||'',type=document.getElementById('activation-target-type')?.value||'';
  const label=type==='user'?'User':type==='product'?'Product':'Fuel Tank';
  const records=type==='user'?window.employeeRecords:type==='product'?window.productRecords:window.tankRecords;
  const item=settingsRecord(records,id);
  let details='<p><b>'+h(label)+':</b> '+h(item?.name||item?.code_name||item?.tank_code||id)+'</p>'+settingsDiff('Status','Inactive','Active');
  let successDetails='<p><b>'+h(label)+'</b> is now active.</p>'+details;
  if(type==='product'){
    const price=priceFromParts('activation-price-major','activation-price-cents');
    if(price===null||price<=0){toast('Enter a valid selling price greater than zero');return;}
    details+='<p style="margin:7px 0"><b>Selling price:</b> '+h(money(price))+'</p>';
    successDetails='<p><b>'+h(item?.code_name||item?.name||id)+'</b> is now active.</p>'+details;
  }
  if(type==='tank'){
    const stock=document.getElementById('tank-opening-stock')?.value.trim()||'';
    const stockNumber=stock===''?NaN:Number(stock);
    if(!Number.isFinite(stockNumber)||stockNumber<0){toast('Enter a valid opening stock reading in liters');return;}
    details+='<p style="margin:7px 0"><b>Opening stock:</b> '+h(liters(stockNumber))+' L</p>';
    successDetails='<p><b>'+h(item?.tank_code||id)+'</b> activated successfully.</p>'+details;
  }
  showSettingsConfirmation('Review '+label+' Activation',details,()=>_confirmGenericActivation(),
    label+' activated successfully',successDetails);
}
function confirmGenericActivation(){return _confirmGenericActivationReview();}
async function confirmDispenserActivation(){
  const id=pendingDispenserActivationId,d=settingsRecord(window.dispenserRecords,id);
  const employeeSelect=document.getElementById('dispenser-activation-employee');
  const employeeId=employeeSelect?.value||'';
  const employee=employeeSelect?.selectedOptions?.[0]?.textContent||'Not selected';
  const tank=document.getElementById('dispenser-activation-tank-liters')?.value.trim()||'';
  const tankNumber=tank===''?NaN:Number(tank);
  const ids=d.nozzle_ids||[];
  const selected=ids.map((nozzleId,i)=>{
    const box=document.getElementById('nozzle-activation-input-'+i),input=document.getElementById('nozzle-activation-number-'+i);
    if(!box||box.style.display==='none'||!input||input.value.trim()==='')return null;
    const value=Number(input.value);
    return Number.isFinite(value)&&value>=0?{nozzleId,value}:null;
  }).filter(Boolean);
  if(!Number.isFinite(tankNumber)||tankNumber<0){toast('Enter the tank opening reading in liters.');return;}
  if(!employeeId){toast('Select an attendant before continuing.');return;}
  if(!selected.length){toast('Activate at least one nozzle and enter its opening meter reading before continuing.');return;}
  const readings=selected.map(x=>'<p style="margin:5px 0"><b>'+h(x.nozzleId)+':</b> '+h(liters(x.value))+'</p>').join('');
  const details='<p><b>Dispenser:</b> '+h(d.nozzle_code||id)+'</p><p><b>Attendant:</b> '+h(employee)+'</p><p><b>Opening stock:</b> '+h(liters(tankNumber))+' L</p><p><b>Nozzle opening readings:</b></p>'+readings+settingsStatus('Pending — dispenser remains inactive until attendant confirms');
  showSettingsConfirmation('Review Dispenser Shift Assignment',details,()=>_confirmDispenserActivation(),
    'Shift assignment created successfully','<p>The assignment was sent to <b>'+h(employee)+'</b>.</p>'+details);
}
async function _toggleNozzleConfirmed(id){return _toggleNozzle(id,true);}
function toggleNozzle(id,active){
  if(!active)return _toggleNozzle(id,active);
  const d=settingsRecord(window.dispenserRecords,id);
  const details='<p><b>Dispenser:</b> '+h(d.nozzle_code||id)+'</p>'+settingsDiff('Status','Active','Inactive');
  showSettingsConfirmation('Review Dispenser Deactivation',details,()=>_toggleNozzleConfirmed(id),
    'Dispenser deactivated successfully','<p>The dispenser is now inactive.</p>'+details);
}
async function removeDispenser(id){
  const d=settingsRecord(window.dispenserRecords,id);
  const details='<p><b>Dispenser:</b> '+h(d.nozzle_code||id)+'</p>'+settingsStatus('Will be permanently removed');
  showSettingsConfirmation('Review Dispenser Removal',details,()=>_removeDispenser(id),
    'Dispenser removed successfully','<p>The dispenser was removed successfully.</p>'+details);
}
async function createDispenser(event){
  event.preventDefault();
  const product=document.getElementById('dispenser-product').value,tankId=document.getElementById('dispenser-tank').value,count=document.getElementById('dispenser-nozzle-count').value;
  const tank=(window.tankRecords||[]).find(t=>String(t.id)===String(tankId));
  const details='<p><b>Product:</b> '+h(product)+'</p><p><b>Tank:</b> '+h(tank?.tank_code||tankId)+'</p><p><b>Nozzles:</b> '+h(count)+'</p>'+settingsStatus('Inactive — ready for activation');
  showSettingsConfirmation('Review New Fuel Dispenser',details,()=>_createDispenser(event),
    'Fuel dispenser created successfully','<p>The new dispenser was created successfully.</p>'+details);
}
async function cancelAdminPendingShift(id){
  const shifts=await api('/api/shifts'),shift=shifts.find(x=>x.id===id);
  const d=settingsRecord(window.dispenserRecords,shift?.nozzle_id);
  const details='<p><b>Dispenser:</b> '+h(d?.nozzle_code||shift?.nozzle_id||id)+'</p>'+settingsDiff('Assignment status','Pending','Cancelled')+'<p class="muted">The dispenser configuration and activation state remain unchanged.</p>';
  showSettingsConfirmation('Review Pending Assignment Cancellation',details,()=>_cancelAdminPendingShift(id),
    'Pending assignment cancelled successfully','<p>The pending assignment was cancelled. The dispenser remains inactive and unchanged.</p>'+details);
}
