
function showAttendantActionResult(type,title,details,afterClose){
  let modal=document.getElementById('attendant-action-result-modal');
  if(!modal){
    modal=document.createElement('div');
    modal.id='attendant-action-result-modal';
    modal.className='attendant-action-result-modal';
    modal.setAttribute('aria-hidden','true');
    modal.innerHTML='<div class="attendant-action-result-backdrop" onclick="closeAttendantActionResult()"></div><div class="attendant-action-result-card" role="dialog" aria-modal="true" aria-labelledby="attendant-action-result-title"><div id="attendant-action-result-icon" class="attendant-action-result-icon"></div><span class="attendant-action-result-kicker">CONFIRMATION</span><h3 id="attendant-action-result-title"></h3><p id="attendant-action-result-details"></p><div class="attendant-action-result-actions"><button type="button" onclick="closeAttendantActionResult()">Continue</button></div></div>';
    document.body.appendChild(modal);
  }
  const card=modal.querySelector('.attendant-action-result-card');
  const icon=modal.querySelector('#attendant-action-result-icon');
  if(card)card.className='attendant-action-result-card '+(type==='success'?'success':'failed');
  if(icon)icon.textContent=type==='success'?'✓':'!';
  const titleEl=modal.querySelector('#attendant-action-result-title');
  const detailsEl=modal.querySelector('#attendant-action-result-details');
  if(titleEl)titleEl.textContent=title|| (type==='success'?'Completed successfully':'Action failed');
  if(detailsEl)detailsEl.textContent=details||'';
  modal._afterClose=typeof afterClose==='function'?afterClose:null;
  modal.classList.add('open');modal.setAttribute('aria-hidden','false');
}
function closeAttendantActionResult(){
  const modal=document.getElementById('attendant-action-result-modal');
  if(!modal)return;
  const next=modal._afterClose;
  modal._afterClose=null;
  modal.classList.remove('open');modal.setAttribute('aria-hidden','true');
  if(typeof next==='function')setTimeout(next,120);
}

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
function restorePendingSettingsOrder(pending){
  if(!pending?.containerKey||!Array.isArray(pending.originalOrder))return;
  const cards=[...document.querySelectorAll('.settings-item-card[data-settings-key="'+pending.containerKey+'"][data-settings-id]')];
  if(!cards.length)return;
  const byId=new Map(cards.map(card=>[String(card.dataset.settingsId),card]));
  const container=cards[0].parentElement;
  pending.originalOrder.forEach(id=>{
    const card=byId.get(String(id));
    if(card&&card.parentElement===container)container.appendChild(card);
  });
}
function closeSettingsConfirmation(){
  const modal=document.getElementById('settings-confirm-modal');
  const pendingReorder=window.pendingSettingsReorder;
  if(pendingReorder)restorePendingSettingsOrder(pendingReorder);
  if(modal){modal.classList.remove('open');modal.setAttribute('aria-hidden','true');}
  window.pendingSettingsReorder=null;
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
  const role = sessionStorage.getItem('fuelRole') || '';
  const response = await fetch(path, {
    credentials: 'same-origin',
    ...options,
    headers: {'Content-Type':'application/json', 'X-Fuel-Role': role, ...(options.headers || {})}
  });
  const text = await response.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch (_) { data = text; }
  if (!response.ok) {
    const msg = typeof data === 'object' && data ? (typeof data.error === 'string' ? (data.message ? data.error+': '+data.message : (data.type ? data.error+' ('+data.type+')' : data.error)) : JSON.stringify(data.error || data)) : String(data || 'Request failed');
    throw new Error(msg);
  }
  return data;
}
const h = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
window.stationCurrency=String(window.stationCurrency||'ETB').trim()||'ETB';
window.stationCurrencyReady=api('/api/settings').then(s=>{
  window.stationCurrency=String(s?.currency||'ETB').trim()||'ETB';
  return window.stationCurrency;
}).catch(()=>window.stationCurrency);
const currencyLabel = () => h(String(window.stationCurrency||'ETB').trim()||'ETB');
const money = value => currencyLabel()+' '+Number(value || 0).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2});
const liters = value => Number(value || 0).toLocaleString(undefined,{maximumFractionDigits:2});
const reading = value => { const n=Number(value); return Number.isFinite(n) ? n.toFixed(2).replace(/\.?0+$/,'') : '—'; };

async function login(role) {
  const operator_id=document.getElementById('operator-id').value.trim(), pin=document.getElementById('pin').value;
  try {
    const endpoint=role==='admin'?'/api/admin-login':'/api/attendant-login';
    const user=await api(endpoint,{method:'POST',body:JSON.stringify({operator_id,pin})});
    if(user.role!==role) throw new Error('This account is not valid for the selected login');
    sessionStorage.setItem('fuelRole',role);
    location.href=role==='admin'?'admin-dashboard.html':'attendant-dashboard.html';
  } catch(e) { toast(e.message); }
}
async function performLogout(){
  const role=sessionStorage.getItem('fuelRole')||'';
  try{await api('/api/logout',{method:'POST',body:'{}'});}catch(_){}
  sessionStorage.removeItem('fuelRole');
  location.href=role==='admin'?'admin-login.html':'attendant-login.html';
}
function closeLogoutConfirmation(){
  const modal=document.getElementById('logout-confirm-modal');
  if(modal){modal.classList.remove('open');modal.setAttribute('aria-hidden','true');}
}
function openLogoutConfirmation(){
  let modal=document.getElementById('logout-confirm-modal');
  if(!modal){
    modal=document.createElement('div');
    modal.id='logout-confirm-modal';
    modal.className='logout-confirm-modal';
    modal.setAttribute('aria-hidden','true');
    modal.innerHTML='<div class="logout-confirm-backdrop" onclick="closeLogoutConfirmation()"></div><div class="logout-confirm-card" role="dialog" aria-modal="true" aria-labelledby="logout-confirm-title"><div class="logout-confirm-icon">↪</div><div class="logout-confirm-content"><span class="section-kicker">SIGN OUT</span><h2 id="logout-confirm-title">Log out?</h2><p>Are you sure you want to log out of the Fuel Shift system?</p></div><div class="logout-confirm-actions"><button type="button" class="logout-cancel-button" onclick="closeLogoutConfirmation()">Cancel</button><button type="button" class="logout-confirm-button" onclick="performLogout()">Log out</button></div></div>';
    document.body.appendChild(modal);
  }
  modal.classList.add('open');
  modal.setAttribute('aria-hidden','false');
  setTimeout(()=>modal.querySelector('.logout-cancel-button')?.focus(),0);
}
async function logout(){openLogoutConfirmation();}
async function currentUser(){return (await api('/api/me')).user;}

function openTakeoverSaleModal(id){
  const takeover=(window.takeoverRecords||[]).find(x=>String(x.id)===String(id));
  if(!takeover)return;
  window.pendingTakeoverSaleId=id;
  window.pendingTakeoverRecord=takeover;
  window.takeoverSaleTypes=Array.isArray(window.dashboardSaleTypes)?window.dashboardSaleTypes:[];
  const modal=document.getElementById('takeover-sale-modal');
  const summary=document.getElementById('takeover-sale-summary');
  const list=document.getElementById('takeover-sale-type-list');
  if(summary)summary.innerHTML='<div><span>Calculated liters</span><strong>'+liters(takeover.total_sales_liters)+' L</strong></div><div><span>Calculated sales amount</span><strong>'+money(takeover.total_sales_amount)+'</strong></div>';
  if(list)list.innerHTML=window.takeoverSaleTypes.length
    ?window.takeoverSaleTypes.map(s=>'<div class="takeover-sale-entry" data-sale-type="'+h(s.id)+'"><div class="takeover-sale-entry-head"><div><strong>'+h(s.name)+'</strong>'+(s.description?'<small>'+h(s.description)+'</small>':'')+'</div><input class="takeover-sale-amount" data-sale-id="'+h(s.id)+'" type="number" min="0" step="0.01" inputmode="decimal" placeholder="0.00"></div>'+(s.reason_required?'<label class="takeover-sale-reason-label">Reason<textarea class="takeover-sale-reason" data-reason-id="'+h(s.id)+'" rows="2" placeholder="Enter reason"></textarea></label>':'')+'</div>').join('')
    :'<p class="muted">No active sale types are configured.</p>';
  if(modal){modal.classList.add('open');modal.setAttribute('aria-hidden','false');}
}
function closeTakeoverSaleModal(){
  const modal=document.getElementById('takeover-sale-modal');
  if(modal){modal.classList.remove('open');modal.setAttribute('aria-hidden','true');}
}
function collectTakeoverSaleEntries(){
  const sales=[];
  document.querySelectorAll('#takeover-sale-type-list .takeover-sale-entry').forEach(row=>{
    const input=row.querySelector('.takeover-sale-amount');
    const amount=Number(input?.value||0);
    if(!Number.isFinite(amount)||amount<=0)return;
    const typeId=row.getAttribute('data-sale-type');
    const type=(window.takeoverSaleTypes||[]).find(x=>String(x.id)===String(typeId));
    const reason=row.querySelector('.takeover-sale-reason')?.value.trim()||'';
    sales.push({sale_type_id:typeId,name:type?.name||'Sale',amount,reason,reason_required:!!type?.reason_required});
  });
  return sales;
}
function continueTakeoverSale(){
  const takeover=window.pendingTakeoverRecord;
  if(!takeover)return;
  const sales=collectTakeoverSaleEntries();
  window.pendingTakeoverSales=sales;
  const modal=document.getElementById('takeover-sale-modal');
  const confirm=document.getElementById('takeover-sale-confirm-modal');
  const content=document.getElementById('takeover-sale-confirm-content');
  const calculated=Number(takeover.total_sales_amount||0);
  if(content)content.innerHTML=
    '<div class="takeover-sale-summary takeover-confirm-summary"><div><span>Calculated liters</span><strong>'+liters(takeover.total_sales_liters)+' L</strong></div><div><span>Calculated sales amount</span><strong>'+money(calculated)+'</strong></div></div>'+
    '<div class="takeover-sales-entry-section"><div class="takeover-sales-entry-title">Review & enter sales</div><div id="takeover-sale-type-list-confirm">'+
    ((window.takeoverSaleTypes||[]).map(s=>{
      const x=sales.find(v=>String(v.sale_type_id)===String(s.id));
      if(!x)return '';
      return '<div class="takeover-sale-entry takeover-sale-review-entry" data-sale-type="'+h(s.id)+'"><div class="takeover-sale-entry-head"><div><strong>'+h(s.name)+'</strong>'+(s.description?'<small>'+h(s.description)+'</small>':'')+'</div><strong class="takeover-sale-review-value">'+money(x.amount)+'</strong></div>'+(s.reason_required?'<div class="takeover-sale-reason-label">Reason<div class="takeover-sale-review-reason">'+(x.reason?h(x.reason):'')+'</div></div>':'')+'</div>';
    }).join(''))+
    '</div></div><div id="takeover-sale-match-status"></div>';
  if(modal){modal.classList.remove('open');modal.setAttribute('aria-hidden','true');}
  if(confirm){
    confirm.classList.add('open');confirm.setAttribute('aria-hidden','false');
    const button=confirm.querySelector('button.confirm-sale-button');
    if(button)button.disabled=true;
    updateTakeoverSaleConfirmation();
  }
}
function editTakeoverSaleEntries(){
  const modal=document.getElementById('takeover-sale-confirm-modal');
  const entry=document.getElementById('takeover-sale-modal');
  if(modal){modal.classList.remove('open');modal.setAttribute('aria-hidden','true');}
  if(entry){entry.classList.add('open');entry.setAttribute('aria-hidden','false');}
}
function updateTakeoverSaleConfirmation(){
  const takeover=window.pendingTakeoverRecord;
  if(!takeover)return;
  const sales=(Array.isArray(window.pendingTakeoverSales)?window.pendingTakeoverSales:[]).filter(x=>Number(x?.amount)>0);
  let missingReason='';
  sales.forEach(x=>{
    const type=(window.takeoverSaleTypes||[]).find(t=>String(t.id)===String(x.sale_type_id));
    if(type?.reason_required&&!String(x.reason||'').trim())missingReason=type.name;
  });
  const total=sales.reduce((sum,x)=>sum+Number(x.amount||0),0);
  const calculated=Number(takeover.total_sales_amount||0);
  const difference=Math.abs(total-calculated);
  const matches=difference<=1 && sales.length>0 && !missingReason;
  const status=document.getElementById('takeover-sale-match-status');
  if(status)status.innerHTML='<div class="takeover-confirm-sales">'+
    (sales.length?sales.map(x=>'<div class="takeover-confirm-sale-row"><span>'+h(x.name)+'</span><strong>'+money(x.amount)+'</strong></div>').join(''):'<div class="takeover-review-empty">No sale amounts entered.</div>')+
    '<div class="takeover-confirm-total"><span>Entered sales total</span><strong>'+money(total)+'</strong></div>'+
    '<div class="takeover-confirm-check"><span>Calculated amount</span><b>'+money(calculated)+'</b><span>Difference</span><b>'+money(difference)+'</b></div></div>'+
    (missingReason?'<div class="takeover-sale-mismatch">Reason required for '+h(missingReason)+'.</div>':
     !sales.length?'<div class="takeover-sale-mismatch">Enter at least one sale amount.</div>':
     matches?'<div class="takeover-sale-match">Sales total is within the allowed ETB 1.00 difference.</div>':
     '<div class="takeover-sale-mismatch">Sales total must be within ETB 1.00 of the calculated amount.</div>');
  const button=document.querySelector('#takeover-sale-confirm-modal button.confirm-sale-button');
  if(button)button.disabled=!matches;
}
function closeTakeoverSaleConfirm(){
  const modal=document.getElementById('takeover-sale-confirm-modal');
  if(modal){modal.classList.remove('open');modal.setAttribute('aria-hidden','true');}
  window.pendingTakeoverSales=null;
  window.pendingTakeoverSaleId=null;
  window.pendingTakeoverRecord=null;
}
function backToTakeoverSaleEntry(){
  const confirm=document.getElementById('takeover-sale-confirm-modal');
  const entry=document.getElementById('takeover-sale-modal');
  const sales=Array.isArray(window.pendingTakeoverSales)?window.pendingTakeoverSales:[];
  document.querySelectorAll('#takeover-sale-type-list .takeover-sale-entry').forEach(row=>{
    const typeId=row.getAttribute('data-sale-type');
    const sale=sales.find(x=>String(x.sale_type_id)===String(typeId));
    const input=row.querySelector('.takeover-sale-amount');
    const reason=row.querySelector('.takeover-sale-reason');
    if(input)input.value=sale?.amount??'';
    if(reason)reason.value=sale?.reason||'';
  });
  if(confirm){confirm.classList.remove('open');confirm.setAttribute('aria-hidden','true');}
  if(entry){entry.classList.add('open');entry.setAttribute('aria-hidden','false');}
}
async function confirmTakeoverSale(){
  const id=window.pendingTakeoverSaleId;
  const sales=window.pendingTakeoverSales||[];
  const button=document.querySelector('#takeover-sale-confirm-modal button.confirm-sale-button');
  if(!id||!sales.length)return;
  if(button)button.disabled=true;
  try{
    await api('/api/shift-takeovers/'+id+'/record-sale',{method:'POST',body:JSON.stringify({sales:sales.map(x=>({sale_type_id:x.sale_type_id,amount:x.amount,reason:x.reason||null}))})});
    closeTakeoverSaleConfirm();
    closeTakeoverSaleModal();
    toast('Sale submitted for admin confirmation');
    await userDashboard();
  }catch(e){
    if(button)button.disabled=false;
    toast(e.message);
  }
}

async function openTakeoverDetails(id){
  const takeover=(window.takeoverRecords||[]).find(x=>String(x.id)===String(id));
  if(!takeover)return;
  const shifts=window.dashboardShiftRecords||[];
  const nozzles=window.dashboardNozzleRecords||[];
  const employees=window.dashboardEmployeeRecords||[];
  const tanks=window.dashboardTankRecords||[];
  const shift=shifts.find(s=>String(s.id)===String(takeover.shift_id));
  const nozzle=nozzles.find(n=>String(n.id)===String(shift?.nozzle_id));
  const employee=employees.find(e=>String(e.id)===String(takeover.to_employee_id));
  const tank=tanks.find(t=>String(t.id)===String(takeover.tank_id||nozzle?.tank_id));
  const opening=Array.isArray(takeover.nozzle_opening_readings)?takeover.nozzle_opening_readings:[];
  const closing=Array.isArray(takeover.nozzle_closing_readings)?takeover.nozzle_closing_readings:[];
  const nozzleSales=Array.isArray(takeover.nozzle_sales_liters)?takeover.nozzle_sales_liters:[];
  const details=document.getElementById('takeover-details-content');
  if(details)details.innerHTML='<div class="muted" style="padding:18px;text-align:center">Loading sale record…</div>';
  const modal=document.getElementById('takeover-details-modal');
  if(modal){modal.classList.add('open');modal.setAttribute('aria-hidden','false');}
  let recorded=[];
  let saleMeta={};
  try{
    const data=await api('/api/shift-takeovers/'+id+'/sale-record');
    recorded=Array.isArray(data?.sales)?data.sales:[];
    saleMeta=data?.takeover||{};
  }catch(e){
    if(details)details.innerHTML='<p class="muted">'+h(e.message||'Unable to load sale record.')+'</p>';
    return;
  }
  const rows=nozzleSales.map((s,i)=>{
    const o=opening.find(x=>String(x.nozzle_id)===String(s.nozzle_id))||opening[i]||{};
    const cl=closing.find(x=>String(x.nozzle_id)===String(s.nozzle_id))||closing[i]||{};
    return '<div class="takeover-detail-row"><div><b>Nozzle '+(i+1)+'</b><small>'+h(s.nozzle_id||o.nozzle_id||cl.nozzle_id||'')+'</small></div><span>Opening <b>'+reading(o.opening_reading??o.reading)+'</b></span><span>Closing <b>'+reading(cl.reading??cl.closing_reading)+'</b></span><span>Sold <b>'+liters(s.liters_sold)+' L</b></span><span>Price <b>'+money(s.unit_price)+'</b></span><span>Amount <b>'+money(s.amount)+'</b></span></div>';
  }).join('');
  const recordedRows=recorded.map(s=>
    '<div class="takeover-recorded-sale-row"><div><strong>'+h(s.sale_type_name||'Sale')+'</strong>'+(s.sale_type_description?'<small>'+h(s.sale_type_description)+'</small>':'')+(s.reason?'<em>Reason: '+h(s.reason)+'</em>':'')+'</div><strong>'+money(s.amount)+'</strong></div>'
  ).join('');
  const submittedAt=saleMeta.sales_submitted_at||takeover.sales_submitted_at;
  const confirmedAt=saleMeta.sales_confirmed_at||takeover.sales_confirmed_at;
  const recordedAt=saleMeta.sales_recorded_at||takeover.sales_recorded_at;
  if(details)details.innerHTML=
    '<div class="takeover-recorded-sale-card">'+
      '<div class="takeover-recorded-sale-head"><div><span class="section-kicker">RECORDED SALE</span><h4>Sale details</h4></div><span class="takeover-recorded-sale-status">'+h(String(saleMeta.sales_status||takeover.sales_status||'pending_admin').replace('_',' '))+'</span></div>'+
      '<div class="takeover-recorded-sale-meta"><div><span>Submitted</span><strong>'+h(submittedAt?new Date(submittedAt).toLocaleString():'—')+'</strong></div><div><span>Admin confirmed</span><strong>'+h(confirmedAt?new Date(confirmedAt).toLocaleString():'Pending')+'</strong></div><div><span>Recorded by</span><strong>'+h(employee?.name||takeover.to_employee_id||'—')+'</strong></div></div>'+
      '<div class="takeover-recorded-sale-list">'+
        '<div class="takeover-detail-heading">Sales recorded</div>'+
        (recordedRows||'<p class="muted">No recorded sale entries.</p>')+
        '<div class="takeover-detail-total"><span>Recorded sales total</span><strong>'+money(recorded.reduce((sum,s)=>sum+Number(s.amount||0),0))+'</strong></div>'+
      '</div>'+
    '</div>'+
    '<div class="takeover-detail-summary">'+
      '<div><span>Dispenser</span><strong>'+h(nozzle?.nozzle_code||takeover.dispenser_code||'—')+'</strong></div>'+
      '<div><span>Receiving shift</span><strong>'+h(employee?.name||takeover.to_employee_id||'—')+'</strong></div>'+
      '<div><span>Shift started</span><strong>'+ (takeover.shift_started_at?new Date(takeover.shift_started_at).toLocaleString():'—')+'</strong></div>'+
      '<div><span>Shift ended</span><strong>'+ (takeover.shift_ended_at?new Date(takeover.shift_ended_at).toLocaleString():'—')+'</strong></div>'+
      '<div><span>Tank opening</span><strong>'+liters(takeover.tank_opening_liters)+' L</strong></div>'+
      '<div><span>Tank closing</span><strong>'+liters(takeover.tank_closing_liters)+' L</strong></div>'+
      '<div><span>Tank sales</span><strong>'+liters(takeover.tank_sales_liters)+' L</strong></div>'+
      '<div><span>Tank variance</span><strong>'+liters(takeover.tank_variance_liters)+' L ('+Number(takeover.tank_variance_pct||0).toFixed(2)+'%)</strong></div>'+
    '</div>'+
    '<div class="takeover-detail-sales"><div class="takeover-detail-heading">Nozzle sales</div>'+(rows||'<p class="muted">No nozzle sales calculated.</p>')+'</div>'+
    '<div class="takeover-detail-total"><span>Total sales</span><strong>'+liters(takeover.total_sales_liters)+' L</strong><strong>'+money(takeover.total_sales_amount)+'</strong></div>';
}
function closeTakeoverDetails(){
  const modal=document.getElementById('takeover-details-modal');
  if(modal){modal.classList.remove('open');modal.setAttribute('aria-hidden','true');}
}

async function cancelPendingTakeoverSale(id){
  if(!confirm('Cancel this pending sale record?'))return;
  try{
    await api('/api/shift-takeovers/'+id+'/cancel-sale',{method:'POST',body:'{}'});
    toast('Pending sale cancelled');
    await userDashboard();
  }catch(e){toast(e.message);}
}

function closeDispenserDeactivationModal(){
  const modal=document.getElementById('dispenser-deactivation-modal');
  if(modal){modal.classList.remove('open');modal.setAttribute('aria-hidden','true');}
  window.pendingDispenserDeactivationRequest=null;
}
function openDispenserDeactivationConfirmation(id){
  const req=(window.pendingDispenserDeactivationRequests||[]).find(x=>String(x.id)===String(id));
  if(!req)return;
  window.pendingDispenserDeactivationRequest=req;
  let modal=document.getElementById('dispenser-deactivation-modal');
  if(!modal){
    modal=document.createElement('div');
    modal.id='dispenser-deactivation-modal';
    modal.className='modal';
    modal.setAttribute('aria-hidden','true');
    modal.innerHTML='<div class="modal-backdrop" onclick="closeDispenserDeactivationModal()"></div><form class="modal-card form" onsubmit="confirmDispenserDeactivationByAttendant(event)"><div class="top"><div><span class="section-kicker">DISPENSER DEACTIVATION</span><h3 id="dispenser-deactivation-title">Close active shift</h3></div><button type="button" class="modal-close" onclick="closeDispenserDeactivationModal()">×</button></div><p id="dispenser-deactivation-summary" class="muted"></p><div id="dispenser-deactivation-reading-list"></div><label>Closing tank stock (L)<input id="dispenser-deactivation-tank-stock" type="number" min="0" step="0.01" inputmode="decimal" placeholder="Enter closing tank stock" required></label><label>Attendant PIN<input id="dispenser-deactivation-pin" type="password" inputmode="numeric" autocomplete="current-password" minlength="4" placeholder="Enter your PIN" required></label><p id="dispenser-deactivation-error" class="muted" style="display:none"></p><div class="row"><button type="button" onclick="closeDispenserDeactivationModal()">Cancel</button><button type="submit" class="primary">Confirm deactivation</button></div></form></div>';
    document.body.appendChild(modal);
  }
  const n=req.nozzle||{};
  const shift=req.shift||{};
  const readings=Array.isArray(req.nozzle_readings)?req.nozzle_readings:[];
  const title=document.getElementById('dispenser-deactivation-title');
  const summary=document.getElementById('dispenser-deactivation-summary');
  const list=document.getElementById('dispenser-deactivation-reading-list');
  if(title)title.textContent='Close '+(n.nozzle_code||'dispenser')+' shift';
  if(summary)summary.innerHTML='<b>Tank:</b> '+h(n.tank_id||'Connected tank')+' &nbsp; <b>Opening tank:</b> '+liters(shift.opening_tank_liters)+' L';
  if(list)list.innerHTML=readings.map((r,i)=>'<div class="card" style="margin:0 0 8px;padding:10px"><div class="top"><strong>'+h(r.nozzle_code||r.nozzle_id||('Nozzle '+(i+1)))+'</strong><span>Opening '+reading(r.opening_reading)+'</span></div><label>Closing reading<input class="deactivation-closing-reading" data-nozzle-id="'+h(r.nozzle_id)+'" type="number" min="'+h(r.opening_reading||0)+'" step="0.01" inputmode="decimal" placeholder="Enter closing reading" required></label></div>').join('');
  const stock=document.getElementById('dispenser-deactivation-tank-stock'); if(stock)stock.value='';
  const pin=document.getElementById('dispenser-deactivation-pin'); if(pin)pin.value='';
  const error=document.getElementById('dispenser-deactivation-error'); if(error){error.textContent='';error.style.display='none';}
  modal.classList.add('open');modal.setAttribute('aria-hidden','false');
  setTimeout(()=>document.querySelector('#dispenser-deactivation-modal .deactivation-closing-reading')?.focus(),0);
}
async function confirmDispenserDeactivationByAttendant(event){
  event?.preventDefault();
  const req=window.pendingDispenserDeactivationRequest;
  if(!req)return;
  const readings=[...document.querySelectorAll('#dispenser-deactivation-modal .deactivation-closing-reading')].map(input=>({nozzle_id:input.dataset.nozzleId,reading:Number(input.value)}));
  if(readings.some(x=>!Number.isFinite(x.reading))){toast('Enter every closing nozzle reading.');return;}
  const tank=Number(document.getElementById('dispenser-deactivation-tank-stock')?.value);
  const pin=document.getElementById('dispenser-deactivation-pin')?.value.trim()||'';
  const error=document.getElementById('dispenser-deactivation-error');
  if(!Number.isFinite(tank)||tank<0||!pin){if(error){error.textContent='Enter the closing tank stock and your PIN.';error.style.display='block';}return;}
  try{
    const result=await api('/api/dispenser-deactivation-requests/'+encodeURIComponent(req.id)+'/confirm',{method:'POST',body:JSON.stringify({pin,closing_tank_liters:tank,closing_nozzle_readings:readings})});
    closeDispenserDeactivationModal();
    toast('Dispenser deactivated. Record Sale is now ready.');
    await userDashboard();
    if(result?.takeover_id){
      const box=document.getElementById('shift');
      if(box)box.scrollIntoView({behavior:'smooth',block:'start'});
    }
  }catch(e){
    if(error){error.textContent=e.message||'Unable to confirm deactivation.';error.style.display='block';}
    else toast(e.message);
  }
}

async function userDashboard(){
  try{
    await window.stationCurrencyReady;
    const me=await currentUser();
    if(me.role!=='attendant')return location.href='attendant-login.html';
    document.getElementById('name').textContent=me.name;
    const [shifts,nozzles,products,tanks,handovers,employees,takeovers,saleTypes,deactivationRequests]=await Promise.all([
      api('/api/shifts').catch(()=>[]),
      api('/api/nozzles').catch(()=>[]),
      api('/api/products').catch(()=>[]),
      api('/api/tanks').catch(()=>[]),
      api('/api/handovers').catch(()=>[]),
      api('/api/users').catch(()=>[]),
      api('/api/shift-takeovers').catch(()=>[]),
      api('/api/sale-types').catch(()=>[]),
      api('/api/dispenser-deactivation-requests').catch(()=>[])
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
      const configuredNozzleIds=Array.isArray(n?.nozzle_ids)?n.nozzle_ids:[];
      const nozzleReadings=readings.length
        ?readings.map((x,i)=>{
          const nozzleCode=x?.nozzle_id||configuredNozzleIds[i]||('Nozzle '+(i+1));
          return '<div class="pending-nozzle-reading"><div class="pending-nozzle-top"><span class="pending-nozzle-pill">Nozzle '+(i+1)+'</span></div><div class="pending-nozzle-number">'+reading(x?.opening_reading)+'</div><div class="pending-nozzle-code">'+h(nozzleCode)+'</div></div>';
        }).join('')
        :'<div class="muted">No nozzle readings recorded.</div>';
      return '<div class="card dashboard-purchase-card pending pending-confirmation-card">'+
        '<div class="pending-hero"><div class="pending-hero-icon">◷</div><div><div class="pending-card-title">Pending Shift Confirmation</div><div class="pending-card-subtitle">Please review the shift details and confirm when ready.</div></div></div>'+
        ''+
        '<div class="pending-shift-info"><div class="pending-info-block"><span class="pending-info-icon dispenser-icon">▣</span><div><span class="pending-label">Dispenser</span><strong>'+h(n?.nozzle_code||s.nozzle_id)+'</strong></div></div><div class="pending-info-divider"></div><div class="pending-info-block"><span class="pending-info-icon tank-icon">▤</span><div><span class="pending-label">Tank</span><strong>'+h(tankNames[n?.tank_id]||n?.tank_id||'Not connected')+'</strong></div></div><div class="pending-tank-opening"><span class="pending-info-icon tank-icon">▤</span><div><span class="pending-label">Tank opening</span><strong>'+liters(s.opening_tank_liters)+' <small>L</small></strong></div></div></div>'+
        '<div class="pending-nozzle-section"><div class="pending-nozzle-heading"><span class="pending-section-icon">⌁</span> Nozzle opening readings</div>'+nozzleReadings+'</div>'+
        '<form class="form" onsubmit="confirmShiftAssignment(event,\''+s.id+'\')">'+
        '<input id="assignment-pin-'+s.id+'" type="password" inputmode="numeric" autocomplete="current-password" placeholder="Enter your PIN" required>'+
        '<div class="row"><button class="primary">Confirm Readings & Start Shift</button><button type="button" onclick="cancelPendingShift(\''+s.id+'\')">Cancel Shift</button></div></form></div>';
    }).join('');

    const pendingOutgoingHandovers=handovers.filter(x=>x.status==='pending'&&String(x.from_employee_id)===String(me.id));
    const pendingIncomingHandovers=handovers.filter(x=>x.status==='pending'&&String(x.to_employee_id)===String(me.id));
    window.dashboardPendingIncomingHandovers=pendingIncomingHandovers;

    const renderHandoverReadings=(x)=>{
      const rows=Array.isArray(x.closing_nozzle_readings)&&x.closing_nozzle_readings.length
        ?x.closing_nozzle_readings
        :[{nozzle_id:'Nozzle 1',reading:x.closing_reading}];
      return rows.map((r,i)=>
        '<div class="handover-pending-reading"><span>Nozzle '+(i+1)+' <small>'+h(r.nozzle_id||'')+'</small></span><strong>'+reading(r.reading)+'</strong></div>'
      ).join('');
    };

    const pendingOutgoingHtml=pendingOutgoingHandovers.map(x=>{
      const shift=shifts.find(s=>s.id===x.shift_id), n=nozzles.find(item=>item.id===shift?.nozzle_id);
      return '<div class="card dashboard-purchase-card pending pending-confirmation-card handover-pending-card">'+
        '<div class="pending-hero"><div class="pending-hero-icon">↔</div><div><div class="pending-card-title">Pending Handover</div><div class="pending-card-subtitle">Waiting for the receiving attendant to confirm the handover.</div></div></div>'+
        '<div class="handover-pending-summary">'+
          '<div class="handover-pending-main"><span>Receiving attendant</span><strong>'+h(employeeNames[x.to_employee_id]||x.to_employee_id)+'</strong></div>'+
          '<div class="handover-pending-section"><div class="handover-pending-title">Closing meter readings</div>'+renderHandoverReadings(x)+'</div>'+
          '<div class="handover-pending-main"><span>Tank closing liters</span><strong>'+liters(x.closing_liters)+' L</strong></div>'+
        '</div>'+
        '<div class="row handover-pending-actions"><button type="button" class="btn" onclick="cancelPendingHandover(\''+x.id+'\')">Cancel Handover</button></div>'+
      '</div>';
    }).join('');

    const pendingIncomingHtml=pendingIncomingHandovers.map(x=>{
      const shift=shifts.find(s=>s.id===x.shift_id);
      const n=nozzles.find(item=>item.id===shift?.nozzle_id)||{};
      const readings=Array.isArray(x.closing_nozzle_readings)&&x.closing_nozzle_readings.length
        ?x.closing_nozzle_readings
        :[{nozzle_id:n?.nozzle_code||shift?.nozzle_id,reading:x.closing_reading}];
      const nozzleReadings=readings.map((r,i)=>
        '<div class="pending-nozzle-reading"><div class="pending-nozzle-top"><span class="pending-nozzle-pill">Nozzle '+(i+1)+'</span></div><div class="pending-nozzle-number">'+reading(r.reading)+'</div><div class="pending-nozzle-code">'+h(r.nozzle_id||n?.nozzle_code||shift?.nozzle_id)+'</div></div>'
      ).join('');
      return '<div class="card active-shift-card pending-shift-card handover-receive-card">'+
        '<div class="active-shift-head"><div><span class="section-kicker">PENDING SHIFT</span><h3>Shift Confirmation</h3><p>Review the incoming shift before starting sales.</p></div><span class="badge pending-shift-badge">Pending</span></div>'+
        '<div class="active-shift-meta">'+
          '<div><span>Dispenser</span><strong>'+h(x.source_nozzle_code||n?.nozzle_code||shift?.nozzle_id||x.shift_id)+'</strong></div>'+
          '<div><span>Tank</span><strong>'+h(x.source_tank_code||tankNames[n?.tank_id]||n?.tank_id||'Not connected')+'</strong></div>'+
          '<div><span>Tank opening</span><strong>'+liters(x.closing_liters)+' L</strong></div>'+
        '</div>'+
        '<div class="active-shift-readings"><div class="active-shift-readings-head"><span>Opening readings</span><small>'+readings.length+' nozzle'+(readings.length===1?'':'s')+'</small></div>'+
          '<div class="active-shift-reading-list">'+nozzleReadings+'</div>'+
        '</div>'+
        '<div class="active-shift-actions pending-shift-actions"><button class="btn active-handover-btn" type="button" onclick="openPendingHandoverReview(&quot;'+x.id+'&quot;)">Review & Confirm</button><button class="btn pending-cancel-btn" type="button" onclick="cancelPendingHandover(&quot;'+x.id+'&quot;)">Cancel</button></div></div>';
    }).join('');

    const takeoverList=Array.isArray(takeovers)?takeovers:[];
    const pendingTakeovers=takeoverList.filter(x=>x.sales_status==='pending_admin'&&String(x.from_employee_id)===String(me.id));
    const readyTakeovers=takeoverList.filter(x=>x.sales_status==='awaiting_attendant'&&String(x.from_employee_id)===String(me.id));
    const completedTakeovers=takeoverList.filter(x=>x.sales_status==='confirmed'||(!x.sales_status&&x.sales_recorded_at));
    window.dashboardSaleTypes=Array.isArray(saleTypes)?saleTypes:[];
    window.takeoverRecords=takeoverList;
    window.dashboardShiftRecords=shifts;
    window.dashboardNozzleRecords=nozzles;
    window.dashboardEmployeeRecords=employees;
    window.dashboardTankRecords=tanks;
    window.pendingDispenserDeactivationRequests=Array.isArray(deactivationRequests)?deactivationRequests:[];

    const pendingDeactivationHtml=(Array.isArray(deactivationRequests)?deactivationRequests:[]).map(req=>{
      const n=req.nozzle||{};
      const s=req.shift||{};
      const readings=Array.isArray(req.nozzle_readings)?req.nozzle_readings:[];
      const readingRows=readings.map((r,i)=>'<div class="pending-nozzle-reading"><div class="pending-nozzle-top"><span class="pending-nozzle-pill">Nozzle '+(i+1)+'</span></div><div class="pending-nozzle-number">'+reading(r.opening_reading)+'</div><div class="pending-nozzle-code">'+h(r.nozzle_code||r.nozzle_id)+'</div></div>').join('');
      return '<div class="card dashboard-purchase-card pending pending-confirmation-card dispenser-deactivation-attendant-card">'+
        '<div class="pending-hero"><div class="pending-hero-icon">!</div><div><div class="pending-card-title">Pending Dispenser Deactivation</div><div class="pending-card-subtitle">'+h(n.nozzle_code||'Dispenser')+' — close your active shift to finish deactivation.</div></div></div>'+
        '<div class="pending-shift-info"><div class="pending-info-block"><span class="pending-info-icon dispenser-icon">▣</span><div><span class="pending-label">Dispenser</span><strong>'+h(n.nozzle_code||req.nozzle_id)+'</strong></div></div><div class="pending-info-divider"></div><div class="pending-info-block"><span class="pending-info-icon tank-icon">▤</span><div><span class="pending-label">Opening tank</span><strong>'+liters(s.opening_tank_liters)+' <small>L</small></strong></div></div></div>'+
        '<div class="pending-nozzle-section"><div class="pending-nozzle-heading"><span class="pending-section-icon">⌁</span> Opening nozzle readings</div>'+readingRows+'</div>'+
        '<div class="row"><button class="primary" type="button" onclick="openDispenserDeactivationConfirmation(\''+req.id+'\')">Enter Closing Readings</button></div></div>';
    }).join('');
    const pendingTakeoverHtml=pendingTakeovers.slice(0,5).map(t=>{
      const takeoverShift=shifts.find(s=>String(s.id)===String(t.shift_id));
      const takeoverNozzle=nozzles.find(n=>String(n.id)===String(takeoverShift?.nozzle_id));
      const takeoverDispenser=takeoverNozzle?.nozzle_code||t.dispenser_code||'Dispenser';
      const pendingRecordedAt=t.sales_recorded_at||t.updated_at||t.created_at||'';
      const pendingRecordedLabel=pendingRecordedAt?new Date(pendingRecordedAt).toLocaleString():'—';
      return '<div class="card dashboard-purchase-card takeover shift-takeover-card pending-takeover-sale-card">'+
        '<div class="pending-record-sale-head">'+
          '<div class="pending-record-sale-title-wrap"><span class="section-kicker">RECORD SALE • PENDING</span><div class="takeover-card-title">Pending Record Sale Confirmation</div><div class="takeover-card-subtitle">'+h(takeoverDispenser)+'</div></div>'+
          '<span class="pending-record-sale-badge">Waiting for admin</span>'+
        '</div>'+
        '<div class="pending-record-sale-status"><span class="pending-record-sale-status-dot"></span><div><strong>Sale submitted successfully</strong><small>Waiting for admin confirmation</small></div></div>'+
        '<div class="takeover-total-grid">'+
          '<div><span>Liters sold</span><strong>'+liters(t.total_sales_liters)+' L</strong></div>'+
          '<div><span>Sales amount</span><strong>'+money(t.total_sales_amount)+'</strong></div>'+
        '</div>'+
        '<div class="pending-record-sale-meta"><span>Recorded</span><strong>'+h(pendingRecordedLabel)+'</strong></div>'+
        '<div class="row takeover-sale-action">'+
          '<button class="btn" type="button" onclick="cancelPendingTakeoverSale(\''+t.id+'\')">Cancel</button>'+
          '<button class="primary" type="button" onclick="openTakeoverDetails(\''+t.id+'\')">View details</button>'+
        '</div>'+
      '</div>';
    }).join('');
    const takeoverHtml=readyTakeovers.map(t=>{
      const takeoverShift=shifts.find(s=>String(s.id)===String(t.shift_id));
      const takeoverNozzle=nozzles.find(n=>String(n.id)===String(takeoverShift?.nozzle_id));
      const takeoverDispenser=takeoverNozzle?.nozzle_code||t.dispenser_code||'Dispenser';
      return '<div class="card dashboard-purchase-card takeover shift-takeover-card main-record-sale-card">'+
        '<div class="main-record-sale-head"><div><span class="section-kicker">SHIFT HANDOVER</span><div class="takeover-card-title">Record Sale</div><div class="takeover-card-subtitle">'+h(takeoverDispenser)+'</div></div><span class="main-record-sale-status">Handover completed</span></div>'+
        '<div class="main-record-sale-summary"><div><span>Liters sold</span><strong>'+liters(t.total_sales_liters)+' L</strong></div><div><span>Sales amount</span><strong>'+money(t.total_sales_amount)+'</strong></div></div>'+
        '<div class="main-record-sale-actions"><button class="primary" type="button" onclick="openTakeoverSaleModal(\''+t.id+'\')">Record Sale</button><button class="btn" type="button" onclick="openTakeoverDetails(\''+t.id+'\')">Details</button></div>'+
      '</div>';
    }).join('');
    const pendingDeactivationShiftIds=new Set((Array.isArray(deactivationRequests)?deactivationRequests:[]).map(x=>String(x.shift_id)));
    const activeForDisplay=active.filter(s=>!pendingOutgoingHandovers.some(x=>String(x.shift_id)===String(s.id))&&!pendingDeactivationShiftIds.has(String(s.id)));
    const activeHtml=activeForDisplay.map(s=>{
      const n=nozzles.find(x=>x.id===s.nozzle_id);
      const readings=Array.isArray(s.activation_nozzles)&&s.activation_nozzles.length
        ?s.activation_nozzles
        :[{nozzle_id:n?.nozzle_code||s.nozzle_id,opening_reading:s.opening_reading}];
      const nozzleReadings=readings.map((x,i)=>
        '<div class="pending-nozzle-reading"><div class="pending-nozzle-top"><span class="pending-nozzle-pill">Nozzle '+(i+1)+'</span></div><div class="pending-nozzle-number">'+reading(x.opening_reading ?? x.reading)+'</div><div class="pending-nozzle-code">'+h(x.nozzle_id||n?.nozzle_code||s.nozzle_id)+'</div></div>'
      ).join('');
      return '<div class="card dashboard-purchase-card active active-shift-card">'+
        '<div class="active-shift-head"><div><span class="section-kicker">ACTIVE SHIFT</span><h3>Shift in Progress</h3><p>Sales are active on this dispenser.</p></div><span class="badge active-shift-badge">Active</span></div>'+
        '<div class="active-shift-meta">'+
          '<div><span>Dispenser</span><strong>'+h(n?.nozzle_code||s.nozzle_id)+'</strong></div>'+
          '<div><span>Tank</span><strong>'+h(tankNames[n?.tank_id]||n?.tank_id||'Not connected')+'</strong></div>'+
          '<div><span>Tank opening</span><strong>'+liters(s.opening_tank_liters)+' L</strong></div>'+
        '</div>'+
        '<div class="active-shift-readings"><div class="active-shift-readings-head"><span>Opening readings</span><small>'+readings.length+' nozzle'+(readings.length===1?'':'s')+'</small></div>'+
          '<div class="active-shift-reading-list">'+nozzleReadings+'</div>'+
        '</div>'+
        '<div class="active-shift-actions"><button class="btn active-handover-btn" type="button" onclick="openDashboardHandover(\''+s.id+'\')">Handover</button></div></div>';
    }).join('');

    const wrapSection=(kicker,title,content)=>content?'<section class="dashboard-section"><div class="dashboard-section-head"><div><span class="section-kicker">'+kicker+'</span><h2>'+title+'</h2></div></div><div class="dashboard-section-cards">'+content+'</div></section>':'';
box.innerHTML=
  wrapSection('SHIFT CONFIRMATIONS','Pending Shift Confirmations',pendingShiftHtml+pendingIncomingHtml)+
  wrapSection('DISPENSER DEACTIVATION','Pending Deactivation',pendingDeactivationHtml)+
  wrapSection('SHIFT HANDOVER','Record Sale & Handover',takeoverHtml+pendingTakeoverHtml+pendingOutgoingHtml)+
  wrapSection('ACTIVE','Active Shifts',activeHtml);
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
    const nameEl=document.getElementById('name');
    if(nameEl)nameEl.textContent=me.name;
    const [shifts,nozzles,products,employees,tanks,takeovers,handovers]=await Promise.all([
      api('/api/shifts'),api('/api/nozzles'),api('/api/products'),api('/api/users'),api('/api/tanks'),api('/api/shift-takeovers').catch(()=>[]),api('/api/handovers').catch(()=>[])
    ]);
    const handoverByShift=Object.fromEntries((Array.isArray(handovers)?handovers:[]).map(h=>[String(h.shift_id),h]));
    const productCodes=Object.fromEntries(products.map(p=>[String(p.name).toLowerCase(),p.code_name]));
    const codeForProduct=product=>productCodes[String(product||'').toLowerCase()]||product;
    const tankNames=Object.fromEntries(tanks.map(t=>[t.id,t.tank_code]));
    const mine=shifts.filter(s=>s.employee_id===me.id);
    const pendingTakeoverShiftIds=new Set((Array.isArray(takeovers)?takeovers:[])
      .filter(t=>!t.sales_recorded_at)
      .map(t=>String(t.shift_id)));
    const history=mine.filter(s=>s.status!=='assigned'&&!pendingTakeoverShiftIds.has(String(s.id)));
    const historyReadingHtml=s=>{
      const rs=Array.isArray(s.nozzle_readings)?s.nozzle_readings:[];
      if(rs.length){
        return '<div class="history-nozzle-readings">'+rs.map((r,i)=>{
          const label=r.dispenser_code?(r.dispenser_code+' • N'+(r.nozzle_number||i+1)):(r.nozzle_code||('Nozzle '+(i+1)));
          const op=r.opening_reading!==null&&r.opening_reading!==undefined?liters(r.opening_reading):'Not recorded';
          const cl=r.closing_reading!==null&&r.closing_reading!==undefined?liters(r.closing_reading):'Not recorded';
          return '<p><b>'+h(label)+'</b> — Opening: <b>'+op+'</b> • Closing: <b>'+cl+'</b></p>';
        }).join('')+'</div>';
      }
      const hdo=handoverByShift[String(s.id)];
      const cl=s.closing_reading!==null&&s.closing_reading!==undefined?liters(s.closing_reading):(hdo?.closing_reading!==null&&hdo?.closing_reading!==undefined?liters(hdo.closing_reading):'Not recorded');
      return '<p>Opening meter: <b>'+liters(s.opening_reading)+'</b> • Closing meter: <b>'+cl+'</b></p>';
    };
    const confirmedTakeovers=(Array.isArray(takeovers)?takeovers:[]).filter(t=>String(t.from_employee_id)===String(me.id)&&t.sales_status==='confirmed');
    window.takeoverRecords=Array.isArray(takeovers)?takeovers:[];
    window.dashboardShiftRecords=shifts;
    window.dashboardNozzleRecords=nozzles;
    window.dashboardEmployeeRecords=employees;
    window.dashboardTankRecords=tanks;
    const historyBox=document.getElementById('shift-history');
    if(historyBox){
      const records=confirmedTakeovers.map(t=>{
        const takeoverShift=shifts.find(s=>String(s.id)===String(t.shift_id));
        const n=nozzles.find(x=>String(x.id)===String(takeoverShift?.nozzle_id));
        const receiver=employees.find(e=>String(e.id)===String(t.to_employee_id));
        return {
          time:new Date(t.sales_confirmed_at||t.shift_ended_at),
          html:'<div class="card shift-takeover-history-card compact-confirmed-sale-card">'+
            '<div class="top"><div><span class="section-kicker">SALES CONFIRMED</span><h3>'+h(n?.nozzle_code||t.dispenser_code||'Dispenser')+'</h3></div><span class="badge">Confirmed</span></div>'+
            '<div class="compact-sale-summary"><span>Shift '+h(String(t.shift_id).slice(0,8))+'</span><span>'+liters(t.total_sales_liters)+' L</span><strong>'+money(t.total_sales_amount)+'</strong></div>'+
            '<p class="muted">Admin confirmed '+(t.sales_confirmed_at?new Date(t.sales_confirmed_at).toLocaleString():'—')+' • Receiving: '+h(receiver?.name||'—')+'</p>'+
            '<button type="button" class="btn compact-detail-button" onclick="openTakeoverDetails(\''+t.id+'\')">Details</button>'+
          '</div>'
        };
      });
      historyBox.innerHTML=records.sort((a,b)=>b.time-a.time).map(x=>x.html).join('')||'<div class="card"><p>No confirmed sales yet.</p></div>';
    }
  }catch(e){
    if(e.message==='Unauthorized')location.href='attendant-login.html';
    else{const s=document.getElementById('shift-page-status');if(s)s.textContent=e.message;}
  }
}
async function confirmShiftAssignment(event,id){
  event.preventDefault();
  const pin=document.getElementById('assignment-pin-'+id)?.value||'';
  try{
    await api('/api/shifts/'+id+'/confirm',{method:'POST',body:JSON.stringify({pin})});
    showAttendantActionResult('success','Shift confirmed','The shift has been confirmed and started.',()=>userDashboard());
  }catch(e){
    showAttendantActionResult('failed','Shift confirmation failed',e.message||'The shift could not be confirmed.');
  }
}
async function cancelPendingShift(id){
  if(!confirm('Cancel this pending shift assignment?'))return;
  try{
    await api('/api/shifts/'+id+'/cancel',{method:'POST',body:'{}'});
    toast('Shift assignment cancelled');
    await userDashboard();
  }catch(e){toast(e.message);}
}
function openPendingHandoverReview(id){
  const item=(window.dashboardPendingIncomingHandovers||[]).find(x=>String(x.id)===String(id));
  if(!item)return;
  const shift=(window.dashboardShiftRecords||[]).find(x=>String(x.id)===String(item.shift_id))||{};
  const nozzles=Array.isArray(item.closing_nozzle_readings)&&item.closing_nozzle_readings.length
    ?item.closing_nozzle_readings
    :[{nozzle_id:shift.nozzle_id||'Nozzle 1',reading:item.closing_reading}];
  let modal=document.getElementById('pending-handover-review-modal');
  if(!modal){
    modal=document.createElement('div');
    modal.id='pending-handover-review-modal';
    modal.className='pending-handover-review-modal';
    modal.setAttribute('aria-hidden','true');
    document.body.appendChild(modal);
  }
  modal.innerHTML='<div class="pending-handover-review-backdrop" onclick="closePendingHandoverReview()"></div>'+
    '<div class="pending-handover-review-card" role="dialog" aria-modal="true" aria-labelledby="pending-handover-review-title">'+
      '<div class="pending-handover-review-head"><div><span class="pending-handover-review-kicker">SHIFT CONFIRMATION</span><h2 id="pending-handover-review-title">Review Shift Confirmation</h2><p>Check the handover details before starting your shift.</p></div><button type="button" class="pending-handover-review-close" onclick="closePendingHandoverReview()" aria-label="Close">×</button></div>'+
      '<div class="pending-handover-review-body">'+
        '<div class="pending-handover-review-grid">'+
          '<div><span>Dispenser</span><strong>'+h(item.source_nozzle_code||shift.nozzle_id||'Not connected')+'</strong></div>'+
          '<div><span>Tank</span><strong>'+h(item.source_tank_code||'Not connected')+'</strong></div>'+
        '</div>'+
        '<div class="pending-handover-review-section"><div class="pending-handover-review-section-title">Opening meter readings</div>'+
          nozzles.map((r,i)=>'<div class="pending-handover-review-nozzle"><div><b>Nozzle '+(i+1)+'</b><small>'+h(r.nozzle_id||'')+'</small></div><strong>'+String(r.reading??'')+'</strong></div>').join('')+
        '</div>'+
        '<div class="pending-handover-review-main"><span>Tank opening</span><strong>'+String(item.closing_liters??'')+' L</strong></div>'+
        '<label class="pending-handover-review-pin">Your PIN<input id="pending-handover-review-pin-'+h(id)+'" type="password" inputmode="numeric" autocomplete="current-password" placeholder="Enter your PIN" required></label>'+
      '</div>'+
      '<div class="pending-handover-review-actions"><button type="button" class="secondary" onclick="closePendingHandoverReview()">Back</button><button type="button" class="primary" onclick="confirmPendingHandoverReview(&quot;'+h(id)+'&quot;)">Confirm Shift</button></div>'+
    '</div>';
  modal.classList.add('open');modal.setAttribute('aria-hidden','false');
  setTimeout(()=>modal.querySelector('input')?.focus(),60);
}
function closePendingHandoverReview(){
  const modal=document.getElementById('pending-handover-review-modal');
  if(!modal)return;
  modal.classList.remove('open');modal.setAttribute('aria-hidden','true');
}
async function confirmPendingHandoverReview(id){
  const pin=document.getElementById('pending-handover-review-pin-'+id)?.value||'';
  if(!pin){
    const input=document.getElementById('pending-handover-review-pin-'+id);
    if(input){input.focus();input.reportValidity?.();}
    return;
  }
  try{
    await api('/api/handovers/'+id+'/confirm',{method:'POST',body:JSON.stringify({pin})});
    closePendingHandoverReview();
    showAttendantActionResult('success','Shift confirmed','The handover was confirmed and your new shift has started.',()=>userDashboard());
  }catch(e){
    showAttendantActionResult('failed','Shift confirmation failed',e.message||'The shift could not be confirmed.');
  }
}
async function confirmHandoverFromDashboard(event,id){
  event.preventDefault();
  openPendingHandoverReview(id);
}
async function cancelPendingHandover(id){
  if(!confirm('Cancel this pending handover?'))return;
  try{
    await api('/api/handovers/'+id+'/cancel',{method:'POST',body:'{}'});
    toast('Pending handover cancelled');
    await userDashboard();
  }catch(e){toast(e.message);}
}


async function adminDeactivateShift(id){
  if(!confirm('Deactivate this active shift? The attendant will no longer be able to continue this shift.'))return;
  try{
    await api('/api/shifts/'+id+'/deactivate',{method:'POST',body:'{}'});
    toast('Shift deactivated');
    await adminDashboard();
  }catch(e){toast(e.message);}
}

async function adminDashboard(){
  try{
    await window.stationCurrencyReady;
    const me=await currentUser(); if(me.role!=='admin')return location.href='admin-login.html';
    const [allTanks,sales,allShifts,allProducts,allDispensers,employees,purchases,inventory,movements]=await Promise.all([api('/api/tanks'),api('/api/sales'),api('/api/shifts'),api('/api/products'),api('/api/nozzles'),api('/api/users'),api('/api/purchases'),api('/api/inventory-summary'),api('/api/tank-movements')]);
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
      return '<div class="stat"><b>'+h(d.nozzle_code)+'</b><span>'+h(codeForProduct(d.product))+' • '+h(tank?.tank_code||'No tank')+'</span><small>Active • '+h(d.nozzle_count||1)+' nozzle(s) • '+(shift?'Shift active — '+h(attendant?.name||'Attendant'):'No active shift')+'</small>'+(shift?'<button class="btn" type="button" style="margin-top:8px" onclick="adminDeactivateShift(\''+shift.id+'\')">Deactivate Shift</button>':'')+'</div>';
    }).join(''):'<div class="card"><p>No activated dispensers.</p></div>';
    el('attendants').innerHTML=activeEmployees.filter(e=>e.role==='attendant').length?activeEmployees.filter(e=>e.role==='attendant').map(e=>{
      const shift=activeShifts.find(s=>s.employee_id===e.id);
      return '<div class="stat"><b>'+h(e.name)+'</b><span>Attendant • ID '+h(e.operator_id)+'</span><small>'+ (shift?'Active shift on '+h((dispensers.find(d=>d.id===shift.nozzle_id)||{}).nozzle_code||shift.nozzle_id):'Available / no active shift')+'</small></div>';
    }).join(''):'<div class="card"><p>No activated attendants.</p></div>';
    el('tanks').innerHTML=tanks.length?tanks.map(t=>{
      const pct=Number(t.capacity_liters)>0?Math.max(0,Math.min(100,Number(t.current_liters)/Number(t.capacity_liters)*100)):0;
      const inv=inventory.find(x=>String(x.tank_id)===String(t.id))||{};
      const tankOpening=inv.opening_stock_liters ?? t.opening_stock_liters;
      const connected=dispensers.filter(d=>d.tank_id===t.id);
      const comparisons=connected.map(d=>{
        const dispenserOpening=d.opening_tank_liters,hasTank=Number.isFinite(Number(tankOpening)),hasDispenser=Number.isFinite(Number(dispenserOpening));
        const variance=hasTank&&hasDispenser?Number(dispenserOpening)-Number(tankOpening):null;
        return '<div style="margin-top:8px;padding-top:8px;border-top:1px solid rgba(127,127,127,.2)"><b>'+h(d.nozzle_code)+'</b> • Dispenser opening: '+(hasDispenser?liters(dispenserOpening)+' L':'Not recorded')+(variance===null?'':'<br><span class="muted">Difference vs tank activation: <b>'+liters(variance)+' L</b></span>')+'</div>';
      }).join('');
      const expected=Number.isFinite(Number(inv.expected_liters))?Number(inv.expected_liters):null;
      const diff=Number.isFinite(Number(inv.stock_difference_liters))?Number(inv.stock_difference_liters):null;
      return '<div class="stat"><b>'+liters(t.current_liters)+' L</b><span>'+h(t.tank_code)+' • '+h(codeForProduct(t.product))+'</span><small>'+pct.toFixed(1)+'% full • Capacity '+liters(t.capacity_liters)+' L</small><div style="margin-top:8px;padding-top:8px;border-top:1px solid rgba(127,127,127,.2)"><small>Opening stock: <b>'+(Number.isFinite(Number(tankOpening))?liters(tankOpening)+' L':'Not recorded')+'</b></small><small>Purchases received: <b>'+liters(inv.purchases_liters)+' L</b></small><small>Fuel sold: <b>'+liters(inv.sales_liters)+' L</b></small><small>Expected stock: <b>'+(expected===null?'—':liters(expected)+' L')+'</b></small><small>Actual stock: <b>'+liters(t.current_liters)+' L</b></small><small>Stock difference: <b>'+(diff===null?'—':liters(diff)+' L')+'</b></small></div>'+(comparisons||'<small>No activated dispenser.</small>')+'</div>';
    }).join(''):'<div class="card"><p>No activated tanks.</p></div>';
    const movementBox=el('tank-movements');
    if(movementBox){
      const movementRows=Array.isArray(movements)?movements:[];
      const productColors=Object.fromEntries(allProducts.map(p=>[String(p.name||'').toLowerCase(),p.color||'']));
      const movementLabels={opening:'Opening',purchase:'Purchase',sale:'Sale',adjustment:'Adjustment',dip:'Dip'};
      const groups=new Map();
      movementRows.forEach(m=>{const key=String(m.tank_id||m.tank_code||'');if(!groups.has(key))groups.set(key,[]);groups.get(key).push(m);});
      allTanks.filter(t=>t.active===true).forEach(t=>{
        const key=String(t.id);
        if(!groups.has(key)){
          const p=allProducts.find(x=>String(x.name||'').toLowerCase()===String(t.product||'').toLowerCase())||{};
          groups.set(key,[{tank_id:t.id,tank_code:t.tank_code,tank_product:t.product,product_code:p.code_name||t.product,product_name:p.name||t.product,product_color:p.color||'',current_liters:t.current_liters,capacity_liters:t.capacity_liters,no_movement_history:true}]);
        }
      });
      const orderedGroups=[...groups.entries()].sort((a,b)=>String(a[1][0]?.tank_code||'').localeCompare(String(b[1][0]?.tank_code||'')));
      movementBox.innerHTML=orderedGroups.length?orderedGroups.map(([key,rows])=>{
        const first=rows[0]||{},code=first.product_code||first.tank_product||'—',name=first.product_name||first.tank_product||'Unknown product',dot=productColors[String(name).toLowerCase()]||first.product_color||'',current=Number(first.current_liters||0),capacity=Number(first.capacity_liters||0),pct=capacity>0?Math.max(0,Math.min(100,current/capacity*100)):0;
        const noHistory=first.no_movement_history===true;
        return '<section class="tank-movement-group"><div class="tank-movement-group-head"><div><span class="tank-movement-product"><i style="'+(dot?'background:'+h(dot)+';':'')+'"></i>'+h(code)+'</span><h4>'+h(first.tank_code||'Tank')+'</h4><small>'+h(name)+'</small></div><div class="tank-movement-current"><strong>'+liters(current)+' L</strong><span>'+pct.toFixed(1)+'% full</span></div></div><div class="tank-movement-list">'+rows.map(m=>{
          const type=String(m.movement_type||'').toLowerCase(),qty=Number(m.quantity_liters||0),signed=type==='sale'?-Math.abs(qty):qty,sign=signed>0?'+':signed<0?'−':'';
          return '<div class="tank-movement-row"><div class="tank-movement-icon">'+(type==='purchase'?'↓':type==='sale'?'↑':type==='adjustment'?'±':type==='opening'?'◷':'•')+'</div><div class="tank-movement-main"><strong>'+h(movementLabels[type]||m.movement_type||'Movement')+'</strong><small>'+new Date(m.created_at).toLocaleString()+(m.notes?' • '+h(m.notes):'')+'</small></div><div class="tank-movement-qty '+(signed<0?'negative':'positive')+'">'+sign+liters(Math.abs(signed))+' L</div><div class="tank-movement-balance"><small>Balance</small><strong>'+liters(m.balance_after)+' L</strong></div></div>';
        }).join('')+'</div>'+(noHistory?'<div class="tank-movement-no-history"><strong>No movement history</strong><span>Current stock is '+liters(current)+' L, but an opening/anchor movement has not been recorded yet.</span></div>':'')+'</section>';
      }).join(''):'<div class="card"><p>No tank movements recorded.</p></div>';
    }
    const recent=[...todaySales.map(s=>({time:s.sale_time,text:'Sale • '+codeForProduct(s.product)+' • '+liters(s.quantity_liters)+' L • '+money(s.amount)})),...purchases.filter(p=>String(p.purchase_date||'').slice(0,10)===today).map(p=>({time:p.purchase_date,text:'Purchase • '+codeForProduct(p.product)+' • '+liters(p.quantity_liters)+' L'})),...activeShifts.map(s=>({time:s.assigned_at||s.created_at,text:'Shift active • '+(activeEmployees.find(e=>e.id===s.employee_id)?.name||'Attendant')+' • '+((dispensers.find(d=>d.id===s.nozzle_id)||{}).nozzle_code||'Dispenser')}))].sort((a,b)=>new Date(b.time)-new Date(a.time)).slice(0,12);
    el('activity').innerHTML=recent.length?recent.map(x=>'<div class="card"><b>'+h(x.text)+'</b><br><span class="muted">'+new Date(x.time).toLocaleString()+'</span></div>').join(''):'<div class="card"><p>No activity recorded today.</p></div>';
    el('dashboard-status').textContent=low.length?low.length+' tank(s) are at or below 10% capacity.':'Dashboard shows only activated Settings records.';
  }catch(e){const s=document.getElementById('dashboard-status');if(s)s.textContent=e.message;if(e.message==='Unauthorized')location.href='admin-login.html';}
}
let adminSalesData={pending:[],history:[]};
let adminSalesHistoryData={history:[]};
let adminSalesTab='pending';

function adminSalesDate(item){
  const t=item?.takeover||item||{};
  return t.shift_ended_at||t.sales_confirmed_at||t.shift_started_at||t.created_at||'';
}
function adminSalesMatches(item){
  const q=(document.getElementById('admin-sales-search')?.value||'').trim().toLowerCase();
  const period=document.getElementById('admin-sales-period')?.value||'all';
  const t=item?.takeover||{};
  const hay=[item?.dispenser?.name,item?.from_employee?.name,item?.to_employee?.name,item?.shift?.name,t.shift_id,t.id,item?.dispenser?.nozzle_code,item?.dispenser?.product,...(Array.isArray(item?.sales)?item.sales.map(s=>s.sale_type_name):[])].filter(Boolean).join(' ').toLowerCase();
  if(q&&!hay.includes(q))return false;
  if(period==='all')return true;
  const d=new Date(adminSalesDate(item)), now=new Date();
  if(Number.isNaN(d.getTime()))return false;
  if(period==='today')return d.toDateString()===now.toDateString();
  const days=Number(period);
  return Number.isFinite(days)&&((now-d)/86400000)<=days&&d<=now;
}
function renderAdminSalesSummary(){
  const box=document.getElementById('sales-summary'); if(!box)return;
  const pending=adminSalesData.pending||[], history=adminSalesData.history||[];
  const pendingEntries=pending.reduce((n,x)=>n+(Array.isArray(x.sales)?x.sales.length:0),0);
  const pendingAmount=pending.reduce((n,x)=>n+(Array.isArray(x.sales)?x.sales.reduce((s,y)=>s+Number(y.amount||0),0):0),0);
  const confirmedLiters=history.reduce((n,x)=>n+Number(x.takeover?.total_sales_liters||0),0);
  const confirmedAmount=history.reduce((n,x)=>n+Number(x.takeover?.total_sales_amount||0),0);
  const cards=[['Pending shifts',pending.length,'awaiting admin'],['Sales to check',pendingEntries,'submitted entries'],['Pending amount',money(pendingAmount),'awaiting confirmation'],['Confirmed liters',liters(confirmedLiters)+' L','shift history'],['Confirmed amount',money(confirmedAmount),'confirmed shifts']];
  box.innerHTML=cards.map(c=>'<div class="admin-sales-stat"><span>'+h(c[0])+'</span><strong>'+h(String(c[1]))+'</strong><small>'+h(c[2])+'</small></div>').join('');
  const pc=document.getElementById('pending-sales-count'),hc=document.getElementById('confirmed-sales-count');
  if(pc)pc.textContent=pending.length;if(hc)hc.textContent=history.length;
}
function setAdminSalesTab(tab){
  adminSalesTab=tab==='history'?'history':'pending';
  document.querySelectorAll('.admin-sales-tab').forEach(b=>b.classList.toggle('active',b.dataset.salesTab===adminSalesTab));
  filterAdminSales();
}
function renderAdminSalesSummary(){
  const box=document.getElementById('sales-summary'); if(!box)return;
  const pending=adminSalesData.pending||[], history=adminSalesData.history||[];
  const pendingEntries=pending.reduce((n,x)=>n+(Array.isArray(x.sales)?x.sales.length:0),0);
  const pendingAmount=pending.reduce((n,x)=>n+(Array.isArray(x.sales)?x.sales.reduce((s,y)=>s+Number(y.amount||0),0):0),0);
  const confirmedLiters=history.reduce((n,x)=>n+Number(x.takeover?.total_sales_liters||0),0);
  const confirmedAmount=history.reduce((n,x)=>n+Number(x.takeover?.total_sales_amount||0),0);
  const cards=[['Pending shifts',pending.length,'awaiting admin'],['Sales to check',pendingEntries,'submitted entries'],['Pending amount',money(pendingAmount),'awaiting confirmation'],['Confirmed liters',liters(confirmedLiters)+' L','shift history'],['Confirmed amount',money(confirmedAmount),'confirmed shifts']];
  box.innerHTML=cards.map(c=>'<div class="admin-sales-stat"><span>'+h(c[0])+'</span><strong>'+h(String(c[1]))+'</strong><small>'+h(c[2])+'</small></div>').join('');
  const pc=document.getElementById('pending-sales-count'),hc=document.getElementById('confirmed-sales-count');
  if(pc)pc.textContent=pending.length;if(hc)hc.textContent=history.length;
}
function setAdminSalesTab(tab){
  adminSalesTab=tab==='history'?'history':'pending';
  document.querySelectorAll('.admin-sales-tab').forEach(b=>b.classList.toggle('active',b.dataset.salesTab===adminSalesTab));
  const p=document.getElementById('sales-confirmation-list'),hbox=document.getElementById('sales-history-list');
  if(p)p.hidden=adminSalesTab!=='pending';if(hbox)hbox.hidden=adminSalesTab!=='history';filterAdminSales();
}
function updateAdminSaleConfirmButton(card){
  if(!card)return;
  const checks=Array.from(card.querySelectorAll('.admin-sale-check'));
  const button=card.querySelector('[data-confirm-sales]');
  if(button)button.disabled=checks.length===0||checks.some(x=>!x.checked);
}
function bindAdminSaleChecks(){
  document.querySelectorAll('.admin-sale-confirm-card').forEach(card=>{
    card.querySelectorAll('.admin-sale-check').forEach(check=>check.addEventListener('change',()=>updateAdminSaleConfirmButton(card)));
    updateAdminSaleConfirmButton(card);
  });
}
function toggleSalesHistorySearch(){
  const modal=document.getElementById('admin-sales-filter-modal');
  const input=document.getElementById('admin-sales-search-modal');
  const search=document.getElementById('admin-sales-search');
  const period=document.getElementById('admin-sales-period');
  const modalSearch=document.getElementById('admin-sales-search-modal');
  const modalPeriod=document.getElementById('admin-sales-period-modal');
  if(!modal)return;
  if(modalSearch&&search)modalSearch.value=search.value||'';
  if(modalPeriod&&period)modalPeriod.value=period.value||'all';
  modal.classList.add('open');modal.setAttribute('aria-hidden','false');
  if(modalSearch)setTimeout(()=>modalSearch.focus(),50);
}
function closeSalesHistoryFilters(){
  const modal=document.getElementById('admin-sales-filter-modal');
  if(modal){modal.classList.remove('open');modal.setAttribute('aria-hidden','true');}
}
function syncSalesHistorySearch(value){
  const input=document.getElementById('admin-sales-search');
  if(input)input.value=value||'';
}
function syncSalesHistoryPeriod(value){
  const select=document.getElementById('admin-sales-period');
  if(select)select.value=value||'all';
}
function clearSalesHistoryFilters(){
  syncSalesHistorySearch('');
  syncSalesHistoryPeriod('all');
  const input=document.getElementById('admin-sales-search-modal');
  const period=document.getElementById('admin-sales-period-modal');
  if(input)input.value='';
  if(period)period.value='all';
  filterAdminSales();
}
function filterAdminSales(){
  const pendingBox=document.getElementById('sales-confirmation-list');
  const historyBox=document.getElementById('sales-history-list');
  const pendingRows=(adminSalesData.pending||[]).filter(adminSalesMatches);
  const allHistoryRows=(adminSalesData.history||[]).filter(adminSalesMatches);
  const historyRows=allHistoryRows.slice(0,3);
  if(pendingBox){
    if(!pendingRows.length){
      pendingBox.innerHTML='<div class="card admin-sales-empty"><div class="empty-icon">✓</div><strong>No pending sales confirmations</strong><p class="muted">All submitted shift sales have been reviewed.</p></div>';
    }else{
      const groups={};
      pendingRows.forEach(item=>{
        const dsrId=dailyReportIdFromTimestamp(item.takeover?.shift_started_at);
        (groups[dsrId]||(groups[dsrId]=[])).push(item);
      });
      pendingBox.innerHTML=Object.keys(groups).map(dsrId=>
        '<section class="admin-pending-dsr-group" data-dsr-id="'+h(dsrId)+'">'+
          '<button type="button" class="admin-pending-dsr-head" onclick="toggleAdminPendingDsrGroup(\''+h(dsrId)+'\')" aria-expanded="false">'+
            '<span class="admin-pending-dsr-title"><span class="section-kicker">DSR</span><strong>'+h(dsrId)+'</strong></span>'+
            '<span class="admin-pending-dsr-right"><small>'+groups[dsrId].length+' pending sale'+(groups[dsrId].length===1?'':'s')+'</small><span class="admin-pending-dsr-toggle" aria-hidden="true">⌄</span></span>'+
          '</button>'+
          '<div class="admin-pending-dsr-cards" hidden>'+groups[dsrId].map(renderAdminPendingSaleCard).join('')+'</div>'+
        '</section>'
      ).join('');
    }
  }
  if(historyBox){
    if(!historyRows.length){
      historyBox.innerHTML='<div class="card admin-sales-empty"><div class="empty-icon">—</div><strong>No confirmed sales history</strong><p class="muted">Confirmed sales will appear here after admin review.</p></div>';
    }else{
      const historyGroups={};
      historyRows.forEach(item=>{
        const dsrId=dailyReportIdFromTimestamp(item.takeover?.shift_started_at);
        (historyGroups[dsrId]||(historyGroups[dsrId]=[])).push(item);
      });
      historyBox.innerHTML=Object.keys(historyGroups).map(dsrId=>
        '<section class="admin-history-dsr-group" data-dsr-id="'+h(dsrId)+'">'+
          '<button type="button" class="admin-history-dsr-head" onclick="toggleAdminHistoryDsrGroup(\''+h(dsrId)+'\')" aria-expanded="false">'+
            '<span class="admin-history-dsr-title"><span class="section-kicker">DSR</span><strong>'+h(dsrId)+'</strong></span>'+
            '<span class="admin-history-dsr-right"><small>'+historyGroups[dsrId].length+' confirmed sale'+(historyGroups[dsrId].length===1?'':'s')+'</small><span class="admin-history-dsr-toggle" aria-hidden="true">⌄</span></span>'+
          '</button>'+
          '<div class="admin-history-dsr-cards" hidden>'+historyGroups[dsrId].map(renderAdminHistorySaleCard).join('')+'</div>'+
        '</section>'
      ).join('');
    }
    if(allHistoryRows.length>3){
      historyBox.innerHTML+='<div class="sales-history-show-more-wrap"><a class="btn primary sales-history-show-more" href="admin-sales-history.html">Show more</a></div>';
    }
  }
  bindAdminSaleChecks();
}
function toggleAdminPendingDsrGroup(dsrId){
  const groups=document.querySelectorAll('.admin-pending-dsr-group');
  let group=null;
  groups.forEach(el=>{if(String(el.getAttribute('data-dsr-id'))===String(dsrId))group=el;});
  if(!group)return;
  const cards=group.querySelector('.admin-pending-dsr-cards');
  const head=group.querySelector('.admin-pending-dsr-head');
  const toggle=group.querySelector('.admin-pending-dsr-toggle');
  const expanded=group.classList.toggle('expanded');
  if(cards)cards.hidden=!expanded;
  if(head)head.setAttribute('aria-expanded',expanded?'true':'false');
  if(toggle)toggle.textContent=expanded?'⌃':'⌄';
}
function renderAdminPendingSaleCard(item){
  const t=item.takeover||{},sales=Array.isArray(item.sales)?item.sales:[],dispenser=item.dispenser?.name||'Dispenser',shift=item.shift?.name||((item.from_employee?.name||'')+' → '+(item.to_employee?.name||''));
  const dsrId=dailyReportIdFromTimestamp(t.shift_started_at);
  const submitted=sales.reduce((sum,x)=>sum+Number(x.amount||0),0),calculated=Number(t.total_sales_amount||0),variance=submitted-calculated;
  const checked=sales.map(s=>'<label class="admin-sale-check-row"><input type="checkbox" class="admin-sale-check" data-sale-id="'+h(s.id)+'"><span><strong>'+h(s.sale_type_name||'Sale')+'</strong><small>'+(s.sale_type_description?h(s.sale_type_description)+' • ':'')+'Amount: '+money(s.amount)+(s.reason?' • Reason: '+h(s.reason):'')+'</small></span></label>').join('');
  return '<article class="card admin-sale-confirm-card admin-pending-sale-minimized" data-takeover-id="'+h(t.id)+'" data-dsr-id="'+h(dsrId)+'">'+
    '<button type="button" class="admin-pending-sale-head" onclick="toggleAdminPendingSaleCard(\''+h(t.id)+'\')" aria-expanded="false">'+
      '<span class="admin-pending-sale-title"><span class="section-kicker">SALE CONFIRMATION</span><strong>'+h(dispenser)+'</strong><small>'+h(shift)+'</small></span>'+
      '<span class="admin-pending-sale-right"><span class="pending-sale-badge">Pending</span><span class="admin-pending-sale-toggle" aria-hidden="true">⌄</span></span>'+
    '</button>'+
    '<div class="admin-pending-sale-body" hidden>'+
      '<div class="admin-sale-context"><div><span>Shift started</span><strong>'+new Date(t.shift_started_at).toLocaleString()+'</strong></div><div><span>Shift ended</span><strong>'+new Date(t.shift_ended_at).toLocaleString()+'</strong></div><div><span>Liters sold</span><strong>'+liters(t.total_sales_liters)+' L</strong></div><div><span>Calculated amount</span><strong>'+money(calculated)+'</strong></div></div>'+
      '<div class="admin-sale-review-strip"><span><b>'+sales.length+'</b> sale entr'+(sales.length===1?'y':'ies')+'</span><span>Submitted <b>'+money(submitted)+'</b></span><span class="'+(Math.abs(variance)<0.005?'match':'difference')+'">'+(Math.abs(variance)<0.005?'Amount matches':'Amount difference')+' <b>'+money(Math.abs(variance))+'</b></span></div>'+
      '<div class="admin-sale-check-section"><div class="takeover-detail-heading">Sales to check <small>Check every entry before confirming</small></div>'+checked+'</div>'+
      '<div class="admin-sale-total"><span>Submitted sales total</span><strong>'+money(submitted)+'</strong></div><div class="row admin-sale-actions"><button type="button" onclick="cancelAdminSaleConfirmation(\''+t.id+'\')">Cancel</button><button type="button" class="primary" disabled data-confirm-sales="'+h(t.id)+'" onclick="confirmAdminSaleConfirmation(\''+t.id+'\')">Confirm sales</button></div>'+
    '</div></article>';
}
function toggleAdminPendingSaleCard(id){
  const cards=document.querySelectorAll('.admin-pending-sale-minimized');
  let card=null;
  cards.forEach(el=>{if(String(el.getAttribute('data-takeover-id'))===String(id))card=el;});
  if(!card)return;
  const expanded=card.classList.toggle('expanded');
  const body=card.querySelector('.admin-pending-sale-body');
  const toggle=card.querySelector('.admin-pending-sale-toggle');
  const head=card.querySelector('.admin-pending-sale-head');
  if(body)body.hidden=!expanded;
  if(head)head.setAttribute('aria-expanded',expanded?'true':'false');
  if(toggle)toggle.textContent=expanded?'⌃':'⌄';
}
function toggleAdminHistoryDsrGroup(dsrId){
  const groups=document.querySelectorAll('.admin-history-dsr-group');
  let group=null;
  groups.forEach(el=>{if(String(el.getAttribute('data-dsr-id'))===String(dsrId))group=el;});
  if(!group)return;
  const cards=group.querySelector('.admin-history-dsr-cards');
  const head=group.querySelector('.admin-history-dsr-head');
  const toggle=group.querySelector('.admin-history-dsr-toggle');
  const expanded=group.classList.toggle('expanded');
  if(cards)cards.hidden=!expanded;
  if(head)head.setAttribute('aria-expanded',expanded?'true':'false');
  if(toggle)toggle.textContent=expanded?'⌃':'⌄';
}
function renderAdminHistorySaleCard(item){
  const t=item.takeover||{},sales=Array.isArray(item.sales)?item.sales:[],from=item.from_employee?.name||'Attendant',to=item.to_employee?.name||'Attendant',dispenser=item.dispenser?.name||'Dispenser';
  const dsrId=dailyReportIdFromTimestamp(t.shift_started_at);
  return '<article class="card compact-confirmed-sale-card admin-history-sale-card admin-history-sale-minimized" data-takeover-id="'+h(t.id)+'" data-dsr-id="'+h(dsrId)+'">'+
    '<button type="button" class="admin-history-sale-head" onclick="toggleAdminHistorySaleCard(this.dataset.id)" data-id="'+h(t.id)+'" aria-expanded="false">'+
      '<span class="admin-history-sale-title"><span class="section-kicker">SALES CONFIRMED</span><strong>'+h(dispenser)+'</strong><small>'+h(from)+' → '+h(to)+'</small><small class="daily-sales-id">'+h(dsrId)+'</small></span>'+
      '<span class="admin-history-sale-right"><span class="badge">Confirmed</span><span class="admin-history-sale-toggle" aria-hidden="true">⌄</span></span>'+
    '</button>'+
    '<div class="admin-history-sale-body" hidden>'+
      '<div class="compact-sale-summary"><span>Shift '+h(String(t.shift_id||'').slice(0,8))+'</span><span>'+liters(t.total_sales_liters)+' L</span><strong>'+money(t.total_sales_amount)+'</strong></div>'+
      '<div class="admin-history-meta"><span>Confirmed <b>'+h(t.sales_confirmed_at?new Date(t.sales_confirmed_at).toLocaleString():'—')+'</b></span><span><b>'+sales.length+'</b> sale entr'+(sales.length===1?'y':'ies')+'</span></div>'+
      '<button type="button" class="btn compact-detail-button" onclick="openAdminSaleHistoryDetails(\''+h(t.id)+'\')">View details</button>'+
    '</div>'+
  '</article>';
}
function toggleAdminHistorySaleCard(id){
  const cards=document.querySelectorAll('.admin-history-sale-minimized');
  let card=null;
  cards.forEach(el=>{if(String(el.getAttribute('data-takeover-id'))===String(id))card=el;});
  if(!card)return;
  const expanded=card.classList.toggle('expanded');
  const body=card.querySelector('.admin-history-sale-body');
  const toggle=card.querySelector('.admin-history-sale-toggle');
  const head=card.querySelector('.admin-history-sale-head');
  if(body)body.hidden=!expanded;
  if(head)head.setAttribute('aria-expanded',expanded?'true':'false');
  if(toggle)toggle.textContent=expanded?'⌃':'⌄';
}
async function refreshAdminSales(){
  const status=document.getElementById('sales-confirmation-status');if(status)status.textContent='Refreshing sales…';
  await adminSalesConfirmations();
}
async function adminSalesConfirmations(){
  try{
    const me=await currentUser();if(me.role!=='admin')return location.href='admin-login.html';
    await window.stationCurrencyReady;
    const [list,history]=await Promise.all([api('/api/sales/confirmations'),api('/api/sales/history')]);
    adminSalesData={pending:Array.isArray(list)?list:[],history:Array.isArray(history)?history:[]};
    renderAdminSalesSummary();filterAdminSales();
    const status=document.getElementById('sales-confirmation-status');if(status)status.textContent='';
  }catch(e){
    const box=document.getElementById('sales-confirmation-status');if(box)box.textContent=e.message;
    if(e.message==='Unauthorized')location.href='admin-login.html';
  }
}
function createStyledReportPdf(report){
  const W=595,H=842,M=38,CONTENT_W=W-M*2,TOP=116,BOTTOM=48;
  const clean=v=>String(v==null?'':v).replace(/[^ -~]/g,'?');
  const esc=v=>clean(v).replace(/\\/g,'\\\\').replace(/\(/g,'\\(').replace(/\)/g,'\\)');
  const wrap=(value,maxChars)=>{
    const words=clean(value).split(/\s+/),out=[];let line='';
    words.forEach(word=>{
      if(!word)return;
      const next=line?line+' '+word:word;
      if(next.length>maxChars){if(line)out.push(line);line=word;}else line=next;
    });
    if(line)out.push(line);
    return out.length?out:[''];
  };
  const rgb=(r,g,b)=>String(r/255)+' '+String(g/255)+' '+String(b/255);
  const pages=[[]];let y=H-TOP;
  const ensure=(height)=>{
    if(y-height<BOTTOM){pages.push([]);y=H-TOP;return true;}
    return false;
  };
  const cmd=s=>pages[pages.length-1].push(s);
  const rect=(x,yy,w,h,fill,stroke)=>{
    let s='';
    if(fill)s+=rgb(...fill)+' rg\n';
    if(stroke)s+=rgb(...stroke)+' RG\n';
    s+=(stroke?'0.7 w\n':'')+x+' '+yy+' '+w+' '+h+' re '+(fill&&stroke?'B':fill?'f':'S')+'\n';
    cmd(s);
  };
  const text=(value,x,yy,size,bold=false,color=[31,41,55])=>{
    cmd(rgb(...color)+' rg\nBT\n/F'+(bold?'2':'1')+' '+size+' Tf\n1 0 0 1 '+x+' '+yy+' Tm\n('+esc(value)+') Tj\nET\n');
  };
  const line=(x1,y1,x2,y2,color=[226,232,240],width=.7)=>{
    cmd(rgb(...color)+' RG\n'+width+' w\n'+x1+' '+y1+' m '+x2+' '+y2+' l S\n');
  };
  const section=(title)=>{
    if(ensure(42)){}
    rect(M,y-25,CONTENT_W,25,[244,247,250],null);
    text(title.toUpperCase(),M+10,y-17,9,true,[71,85,105]);
    y-=37;
  };
  const kvGrid=(items,cols=2)=>{
    const gap=8,w=(CONTENT_W-gap*(cols-1))/cols,h=43;
    for(let i=0;i<items.length;i+=cols){
      const row=items.slice(i,i+cols);ensure(h+8);
      row.forEach((item,j)=>{
        const x=M+j*(w+gap);
        rect(x,y-h,w,h,[250,251,252],[229,234,240]);
        text(item[0],x+9,y-13,7,false,[100,116,139]);
        const vals=wrap(item[1]||'—',Math.max(16,Math.floor(w/6.2))).slice(0,2);
        text(vals[0],x+9,y-28,10,true,[15,23,42]);
        if(vals[1])text(vals[1],x+9,y-39,8,false,[71,85,105]);
      });
      y-=h+8;
    }
  };
  const table=(headers,rows,widths)=>{
    const total=widths.reduce((a,b)=>a+b,0),headH=25,rowH=27;
    ensure(headH);
    let x=M;
    widths.forEach((w,i)=>{rect(x,y-headH,w,headH,[30,64,92],null);text(headers[i],x+7,y-16,7,true,[255,255,255]);x+=w;});
    y-=headH;
    rows.forEach(row=>{
      const wrapped=row.map((v,i)=>wrap(v,widths[i]<90?13:22).slice(0,2));
      const rh=Math.max(rowH,...wrapped.map(a=>a.length*10+10));
      if(y-rh<BOTTOM){pages.push([]);y=H-TOP;table(headers,[],widths);return tableRow(row,wrapped,rh);}
      tableRow(row,wrapped,rh);
    });
    function tableRow(row,wrapped,rh){
      let x=M;wrapped.forEach((lines,i)=>{
        rect(x,y-rh,widths[i],rh,[255,255,255],[231,235,239]);
        lines.forEach((v,k)=>text(v,x+7,y-13-k*10,8,k===0&&i===0,[31,41,55]));
        x+=widths[i];
      });y-=rh;
    }
    y-=8;
  };
  const paragraph=value=>{
    wrap(value,92).forEach(v=>{if(y-13<BOTTOM){pages.push([]);y=H-TOP;}text(v,M,y-10,8,false,[71,85,105]);y-=13;});
  };

  pages[0].push(rgb(...[37,99,168])+' rg\n'+M+' '+(H-78)+' '+CONTENT_W+' 78 re f\n');
  text(report.title,M,H-40,22,true,[255,255,255]);
  text(report.subtitle,M,H-58,9,false,[222,235,248]);
  text(report.reference,M+CONTENT_W-150,H-40,8,true,[255,255,255]);
  text(report.generated,M+CONTENT_W-150,H-58,7,false,[222,235,248]);
  y=H-TOP;
  if(report.summary){
    rect(M,y-66,CONTENT_W,66,[248,250,252],[218,226,234]);
    let x=M+14;
    report.summary.forEach((s,i)=>{
      if(i)line(x-9,y-12,x-9,y-54,[220,226,232],.6);
      text(s[0],x,y-17,7,false,[100,116,139]);
      text(s[1],x,y-38,13,true,[15,23,42]);
      x+=CONTENT_W/report.summary.length;
    });
    y-=80;
  }
  (report.sections||[]).forEach(s=>{
    section(s.title);
    if(s.fields)kvGrid(s.fields,s.cols||2);
    if(s.table)table(s.table.headers,s.table.rows,s.table.widths);
    if(s.paragraph)paragraph(s.paragraph);
  });
  const objects=[{id:1,body:'<< /Type /Catalog /Pages 2 0 R >>'}],kids=[];let next=4;
  pages.forEach((commands,pi)=>{
    const pageId=next++,contentId=next++;kids.push(pageId+' 0 R');
    commands.push(rgb(...[148,163,184])+' rg\nBT\n/F1 7 Tf\n1 0 0 1 '+M+' 25 Tm\n('+esc('Fuel Station Management • '+report.title)+') Tj\nET\n');
    commands.push(rgb(...[148,163,184])+' rg\nBT\n/F1 7 Tf\n1 0 0 1 '+(W-80)+' 25 Tm\n('+esc('Page '+(pi+1)+' / '+pages.length)+') Tj\nET\n');
    const stream=commands.join('');
    objects.push({id:pageId,body:'<< /Type /Page /Parent 2 0 R /MediaBox [0 0 '+W+' '+H+'] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents '+contentId+' 0 R >>'},{id:contentId,body:'<< /Length '+stream.length+' >>\nstream\n'+stream+'\nendstream'});
  });
  objects.push({id:2,body:'<< /Type /Pages /Kids ['+kids.join(' ')+'] /Count '+pages.length+' >>'},{id:3,body:'<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'},{id:4,body:'<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>'});
  objects.sort((a,b)=>a.id-b.id);
  let pdf='%PDF-1.4\n';const offsets=[];
  objects.forEach(o=>{offsets[o.id]=pdf.length;pdf+=o.id+' 0 obj\n'+o.body+'\nendobj\n';});
  const xref=pdf.length;pdf+='xref\n0 '+(objects.length+1)+'\n0000000000 65535 f \n';
  for(let i=1;i<=objects.length;i++)pdf+=String(offsets[i]||0).padStart(10,'0')+' 00000 n \n';
  pdf+='trailer\n<< /Size '+(objects.length+1)+' /Root 1 0 R >>\nstartxref\n'+xref+'\n%%EOF';
  return new Blob([pdf],{type:'application/pdf'});
}
function downloadAdminSaleHistoryDetails(id){
  const item=(adminSalesData.history||[]).find(x=>String(x.takeover?.id)===String(id));if(!item)return;
  const t=item.takeover||{},sales=Array.isArray(item.sales)?item.sales:[],total=Number(t.total_sales_amount||0);
  const entryTotal=sales.reduce((sum,s)=>sum+Number(s.amount||0),0);
  const rows=sales.map((s,i)=>[String(i+1),s.sale_type_name||'Sale',money(s.amount),s.reason||s.sale_type_description||'—']);
  const blob=createStyledReportPdf({
    title:'SALES REPORT',subtitle:'Confirmed shift sales detail',reference:'DSR '+dailyReportIdFromTimestamp(t.shift_started_at),generated:'CONFIRMED',
    summary:[['TOTAL SALES',money(total)],['LITERS SOLD',liters(t.total_sales_liters)+' L'],['ENTRIES',String(sales.length)],['STATUS','CONFIRMED']],
    sections:[
      {title:'Shift & Attendant',fields:[
        ['Dispenser',item.dispenser?.name||'—'],['From attendant',item.from_employee?.name||'—'],
        ['Received by',item.to_employee?.name||'—'],['Shift ID',t.shift_id||id],
        ['Shift started',t.shift_started_at?new Date(t.shift_started_at).toLocaleString():'—'],['Shift ended',t.shift_ended_at?new Date(t.shift_ended_at).toLocaleString():'—'],
        ['Confirmed',t.sales_confirmed_at?new Date(t.sales_confirmed_at).toLocaleString():'—']
      ]},
      {title:'Recorded Sales',table:{headers:['#','Sale type','Amount','Description / reason'],widths:[28,150,90,297],rows}},
      {title:'Reconciliation',fields:[['Calculated total',money(total)],['Entries total',money(entryTotal)],['Difference',money(Math.abs(total-entryTotal))],['Confirmation','Admin confirmed']],cols:2}
    ]
  });
  const url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download='sales-'+String(t.shift_id||id).slice(0,12)+'.pdf';document.body.appendChild(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);toast('PDF downloaded');
}
function downloadPurchaseDetailPdf(){
  const id=window.currentPurchaseDetailId;
  const p=window.currentPurchaseDetailData||((typeof purchaseDetailData!=='undefined'&&Array.isArray(purchaseDetailData)?purchaseDetailData:[]).find(x=>String(x.id)===String(id)));
  if(!p){toast('Purchase details are not available. Please reopen the detail card and try again.');return;}
  const history=Array.isArray(p.discharge_history)?p.discharge_history:[],compartments=Array.isArray(p.compartment_liters)?p.compartment_liters:[];
  const delivered=Number(p.delivered_quantity_liters||p.quantity_liters||p.ordered_quantity_liters||0),discharged=Number(p.discharged_quantity_liters||0),remaining=Math.max(0,delivered-discharged);
  const dischargeRows=history.map((e,i)=>[
    String(i+1),e.discharge_datetime||e.discharged_at||e.created_at||'—',
    Number(e.quantity_liters||e.discharged_quantity_liters||0).toLocaleString()+' L',
    e.tank_code||e.tank_id||'—',e.tank_stock_status||'—'
  ]);
  const compartmentRows=compartments.map((q,i)=>[String(i+1),'Compartment '+(i+1),Number(q||0).toLocaleString()+' L']);
  const blob=createStyledReportPdf({
    title:'PURCHASE REPORT',subtitle:'Purchase, truck and discharge record',reference:'Invoice '+(p.invoice_number||'—'),generated:p.status||'RECORDED',
    summary:[['PRODUCT',p.product||p.product_code||'—'],['DELIVERED',delivered.toLocaleString()+' L'],['DISCHARGED',discharged.toLocaleString()+' L'],['REMAINING',remaining.toLocaleString()+' L']],
    sections:[
      {title:'Purchase Summary',fields:[
        ['Product',p.product||p.product_code||'—'],['Invoice',p.invoice_number||'—'],
        ['Purchase date',p.purchase_date?new Date(p.purchase_date).toLocaleString():(p.created_at?new Date(p.created_at).toLocaleString():'—')],
        ['Ordered quantity',Number(p.ordered_quantity_liters||p.quantity_liters||0).toLocaleString()+' L'],
        ['Delivered quantity',delivered.toLocaleString()+' L'],['Status',p.status||'—']
      ]},
      {title:'Truck & Driver',fields:[
        ['Driver',p.driver_name||'—'],['Driver phone',p.driver_phone||'—'],
        ['Plate number',p.plate_number||p.truck_plate||'—'],['Compartments',p.truck_compartments||compartments.length||'—']
      ]},
      {title:'Compartment Breakdown',table:{headers:['#','Compartment','Quantity'],widths:[40,250,275],rows:compartmentRows}},
      {title:'Tank Information',fields:[
        ['Tanks',[...new Set(history.map(e=>e?.tank_code||e?.tank_id).filter(Boolean))].join(', ')||'—'],
        ['Discharge operations',String(history.length)],['Total discharged',discharged.toLocaleString()+' L'],['Remaining',remaining.toLocaleString()+' L']
      ]},
      {title:'Discharge History',table:{headers:['#','Date','Quantity','Tank','Status'],widths:[28,170,95,90,182],rows:dischargeRows.length?dischargeRows:[['—','No discharge operations recorded','—','—','—']]}},
      {title:'Purchase Remark',paragraph:p.remark||p.purchase_remark||'No purchase remark recorded.'}
    ]
  });
  const url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download='purchase-'+String(p.invoice_number||id).replace(/[^A-Za-z0-9_-]/g,'_')+'.pdf';document.body.appendChild(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);toast('PDF downloaded');
}
window.downloadPurchaseDetailPdf=downloadPurchaseDetailPdf;

function openAdminSaleHistoryDetails(id){
  const historySource=(typeof adminSalesHistoryData!=='undefined'&&Array.isArray(adminSalesHistoryData.history)?adminSalesHistoryData.history:((typeof adminSalesData!=='undefined'&&Array.isArray(adminSalesData.history))?adminSalesData.history:[]));
  const item=historySource.find(x=>String((x.takeover||{}).id)===String(id));
  if(!item)return;
  const t=item.takeover||{};
  const sales=Array.isArray(item.sales)?item.sales:[];
  const total=Number(t.total_sales_amount||0);
  const entryTotal=sales.reduce((sum,s)=>sum+Number(s.amount||0),0);
  const started=t.shift_started_at?new Date(t.shift_started_at).toLocaleString():'—';
  const ended=t.shift_ended_at?new Date(t.shift_ended_at).toLocaleString():'—';
  const confirmed=t.sales_confirmed_at?new Date(t.sales_confirmed_at).toLocaleString():'—';
  const saleRows=sales.map((s,i)=>{
    const desc=s.sale_type_description?'<small>'+h(s.sale_type_description)+'</small>':'';
    const reason=s.reason?'<small class="reason">Reason: '+h(s.reason)+'</small>':'';
    return '<div class="history-detail-sale"><span class="history-detail-sale-number">'+(i+1)+'</span><div class="history-detail-sale-name"><strong>'+h(s.sale_type_name||'Sale')+'</strong>'+desc+reason+'</div><strong class="history-detail-sale-value">'+money(s.amount)+'</strong></div>';
  }).join('');
  const content=[
    '<div class="history-detail-overview">',
      '<div class="history-detail-main"><span class="section-kicker">CONFIRMED SALES</span><h4>'+h((item.dispenser||{}).name||'Dispenser')+'</h4><p>'+h((item.from_employee||{}).name||'—')+' <span>→</span> '+h((item.to_employee||{}).name||'—')+'</p></div>',
      '<div class="history-detail-amount"><span>Total</span><strong>'+money(total)+'</strong><small>'+liters(t.total_sales_liters)+' L</small></div>',
    '</div>',
    '<div class="history-detail-section">',
      '<div class="history-detail-section-head"><div><span class="section-kicker">SHIFT</span><h4>Shift information</h4></div></div>',
      '<div class="history-detail-info-grid">',
        '<div><span>From</span><strong>'+h(item.from_employee?.name||'—')+'</strong></div>',
        '<div><span>Received by</span><strong>'+h(item.to_employee?.name||'—')+'</strong></div>',
        '<div><span>Started</span><strong>'+h(started)+'</strong></div>',
        '<div><span>Ended</span><strong>'+h(ended)+'</strong></div>',
        '<div class="wide"><span>Shift ID</span><strong class="mono">'+h(t.shift_id||'—')+'</strong></div>',
      '</div>',
    '</div>',
    '<div class="history-detail-section">',
      '<div class="history-detail-section-head"><div><span class="section-kicker">BREAKDOWN</span><h4>Recorded sales</h4></div><span class="history-detail-count">'+sales.length+' '+(sales.length===1?'entry':'entries')+'</span></div>',
      '<div class="history-detail-sales">'+(saleRows||'<div class="history-detail-empty">No sale entries were recorded.</div>')+'</div>',
      '<div class="history-detail-total-row"><span>Entries total</span><strong>'+money(entryTotal)+'</strong></div>',
    '</div>',
    '<div class="history-detail-confirmed"><span>✓</span><div><strong>Confirmed by admin</strong><small>'+h(confirmed)+'</small></div></div>'
  ].join('');
  const modal=document.getElementById('admin-sale-history-details');
  const download=document.getElementById('admin-sale-history-download');
  if(download)download.dataset.takeoverId=String(id);
  const box=document.getElementById('admin-sale-history-details-content');
  if(box)box.innerHTML=content;
  if(modal){
    modal.classList.add('open');
    modal.setAttribute('aria-hidden','false');
  }
}
function closeAdminSaleHistoryDetails(){const modal=document.getElementById('admin-sale-history-details');if(modal){modal.classList.remove('open');modal.setAttribute('aria-hidden','true');}}
function openAdminSaleReview(id){
  const card=document.querySelector('.admin-sale-confirm-card[data-takeover-id="'+id+'"]');
  if(!card)return;
  const checks=Array.from(card.querySelectorAll('.admin-sale-check'));
  const checked=checks.filter(x=>x.checked);
  if(!checked.length||checked.length!==checks.length){toast('Tick every sale before reviewing');return;}
  const item=(adminSalesData.pending||[]).find(x=>String(x.takeover?.id)===String(id));
  if(!item)return;
  const t=item.takeover||{},sales=Array.isArray(item.sales)?item.sales:[],submitted=sales.reduce((sum,x)=>sum+Number(x.amount||0),0),calculated=Number(t.total_sales_amount||0),variance=submitted-calculated;
  const difference=Math.abs(variance);
  const withinAllowedDifference=difference<=1;
  const content=document.getElementById('admin-sale-review-content');
  if(content)content.innerHTML='<div class="admin-sale-review-summary"><div><span>Dispenser</span><strong>'+h(item.dispenser?.name||'Dispenser')+'</strong></div><div><span>Shift</span><strong>'+h(item.shift?.name||((item.from_employee?.name||'')+' → '+(item.to_employee?.name||'')))+'</strong></div><div><span>Shift started</span><strong>'+new Date(t.shift_started_at).toLocaleString()+'</strong></div><div><span>Shift ended</span><strong>'+new Date(t.shift_ended_at).toLocaleString()+'</strong></div><div><span>Liters sold</span><strong>'+liters(t.total_sales_liters)+' L</strong></div><div><span>Calculated amount</span><strong>'+money(calculated)+'</strong></div></div><div class="admin-sale-review-list"><div class="takeover-detail-heading">Sales entries <small>'+sales.length+' checked</small></div>'+sales.map(s=>'<div class="admin-sale-review-entry"><div><strong>'+h(s.sale_type_name||'Sale')+'</strong>'+(s.sale_type_description?'<small>'+h(s.sale_type_description)+'</small>':'')+(s.reason?'<small>Reason: '+h(s.reason)+'</small>':'')+'</div><strong>'+money(s.amount)+'</strong></div>').join('')+'</div><div class="admin-sale-review-total"><span>Submitted sales total</span><strong>'+money(submitted)+'</strong></div><div class="admin-sale-review-check"><div><span>Calculated amount</span><strong>'+money(calculated)+'</strong></div><div><span>Difference</span><strong>'+money(Math.abs(variance))+'</strong></div></div><div class="'+(withinAllowedDifference?'admin-sale-review-ok':'admin-sale-review-warning')+'">'+(difference<0.005?'Amounts match the calculated sales amount.':withinAllowedDifference?'Amount difference is within the allowed ETB 1.00 tolerance.':'Amount difference exceeds the allowed ETB 1.00 tolerance. Confirmation is blocked.')+'</div>';
  window.pendingAdminSaleReviewId=id;
  const modal=document.getElementById('admin-sale-review-modal');
  const finalButton=document.getElementById('admin-sale-final-confirm');
  if(finalButton)finalButton.disabled=!withinAllowedDifference;
  if(modal){modal.classList.add('open');modal.setAttribute('aria-hidden','false');}
}
function closeAdminSaleReview(){
  const modal=document.getElementById('admin-sale-review-modal');
  if(modal){modal.classList.remove('open');modal.setAttribute('aria-hidden','true');}
  window.pendingAdminSaleReviewId=null;
}
async function showAdminSaleConfirmResult(success, message, summary){
  const successModal=document.getElementById('admin-sale-confirm-success-modal');
  const failedModal=document.getElementById('admin-sale-confirm-failed-modal');
  if(success){
    if(successModal){
      const box=document.getElementById('admin-sale-confirm-success-summary');
      if(box)box.innerHTML=summary||'';
      successModal.classList.add('open');
      successModal.setAttribute('aria-hidden','false');
    }else toast('Sales confirmed successfully');
  }else{
    if(failedModal){
      const msg=document.getElementById('admin-sale-confirm-failed-message');
      if(msg)msg.textContent=message||'The sales could not be confirmed.';
      failedModal.classList.add('open');
      failedModal.setAttribute('aria-hidden','false');
    }else toast(message||'Sales confirmation failed');
  }
}
function closeAdminSaleConfirmResult(){
  ['admin-sale-confirm-success-modal','admin-sale-confirm-failed-modal'].forEach(id=>{
    const modal=document.getElementById(id);
    if(modal){modal.classList.remove('open');modal.setAttribute('aria-hidden','true');}
  });
}
async function finalizeAdminSaleConfirmation(){
  const id=window.pendingAdminSaleReviewId;
  if(!id)return;
  const card=document.querySelector('.admin-sale-confirm-card[data-takeover-id="'+id+'"]');
  const ids=Array.from(card?.querySelectorAll('.admin-sale-check:checked')||[]).map(x=>x.getAttribute('data-sale-id'));
  const total=card?.querySelectorAll('.admin-sale-check').length||0;
  if(!ids.length||ids.length!==total){closeAdminSaleReview();toast('Tick every sale before confirming');return;}
  const button=document.getElementById('admin-sale-final-confirm');
  if(button)button.disabled=true;
  try{
    const result=await api('/api/sales/confirmations/'+id+'/confirm',{method:'POST',body:JSON.stringify({checked_sale_ids:ids})});
    closeAdminSaleReview();
    await adminSalesConfirmations();
    showAdminSaleConfirmResult(true,'',`<div class="purchase-confirmation-row"><span>Confirmed sales</span><strong>${ids.length}</strong></div>`);
  }catch(e){
    if(button)button.disabled=false;
    showAdminSaleConfirmResult(false,e.message);
  }
}
async function confirmAdminSaleConfirmation(id){openAdminSaleReview(id);}
async function cancelAdminSaleConfirmation(id){
  if(!confirm('Cancel this pending sale record? The attendant will be able to record it again.'))return;
  try{await api('/api/sales/confirmations/'+id+'/cancel',{method:'POST',body:'{}'});toast('Sale confirmation cancelled');await adminSalesConfirmations();}catch(e){toast(e.message);}
}

function settingsMoveHandle(key,id,label){return '<button type="button" class="settings-move-handle" data-settings-key="'+h(key)+'" data-settings-id="'+h(id)+'" title="Hold and drag to move" aria-label="Hold and drag '+h(label||'item')+'" onclick="event.stopPropagation()">⋮</button>';}
function applySavedSettingsOrder(records,key,orders){const saved=Array.isArray(orders?.[key])?orders[key].map(String):[];const rank=new Map(saved.map((id,i)=>[id,i]));return [...records].sort((a,b)=>(rank.has(String(a.id))?rank.get(String(a.id)):Number.MAX_SAFE_INTEGER)-(rank.has(String(b.id))?rank.get(String(b.id)):Number.MAX_SAFE_INTEGER));}
function settingsOrderFromContainer(container){return Array.from(container?.querySelectorAll(':scope > .settings-item-card[data-settings-id]')||[]).map(x=>String(x.dataset.settingsId));}
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
async function cancelPendingDispenserDeactivation(event,id){
  event?.stopPropagation();
  const request=(window.pendingDispenserDeactivationRequests||[]).find(x=>String(x.id)===String(id));
  const nozzleCode=request?.nozzle?.nozzle_code||request?.nozzle_id||'this dispenser';
  const details='<p><b>Dispenser:</b> '+h(nozzleCode)+'</p>'+
    settingsDiff('Deactivation status','Pending','Cancelled')+
    '<p class="muted">The dispenser will remain active and the assigned attendant will no longer be asked to close the shift.</p>';
  showSettingsConfirmation('Cancel Pending Deactivation',details,async()=>{
    await api('/api/dispenser-deactivation-requests/'+encodeURIComponent(id)+'/cancel',{method:'POST',body:'{}'});
    await loadSettingsData();
  },'Deactivation request cancelled','<p>The pending deactivation request was cancelled. The dispenser remains active.</p>'+details);
}

async function _cancelAdminPendingShift(id){
  try{
    await api('/api/shifts/'+id+'/cancel',{method:'POST',body:'{}'});
    await loadSettingsData();
  }catch(e){throw e;}
}
async function loadSettingsData(){
  let [employees,tanks,dispensers,products,shifts,saleTypes,stationSettings,deactivationRequests]=await Promise.all([api('/api/users'),api('/api/tanks'),api('/api/nozzles'),api('/api/products'),api('/api/shifts'),api('/api/sale-types'),api('/api/settings'),api('/api/dispenser-deactivation-requests').catch(()=>[])]);
  const savedOrders=stationSettings?.item_orders||{};
  products=applySavedSettingsOrder(products,'products',savedOrders);saleTypes=applySavedSettingsOrder(saleTypes,'saleTypes',savedOrders);employees=applySavedSettingsOrder(employees,'employees',savedOrders);tanks=applySavedSettingsOrder(tanks,'tanks',savedOrders);dispensers=applySavedSettingsOrder(dispensers,'dispensers',savedOrders);
  const stationCurrency=String(stationSettings?.currency||'ETB').trim();
  window.stationCurrency=stationCurrency;
  const currencyInput=document.getElementById('station-currency');
  if(currencyInput)currencyInput.value=stationCurrency;
  const productByName=Object.fromEntries(products.map(p=>[String(p.name).toLowerCase(),p]));
  const codeForProduct=product=>productByName[String(product||'').toLowerCase()]?.code_name||product;
  const colorForProduct=product=>productByName[String(product||'').toLowerCase()]?.color||'#98A2B3';
  const pendingHandovers=shifts.filter(x=>x.status==='assigned');
  const pendingByDispenser=Object.fromEntries(pendingHandovers.map(x=>[x.nozzle_id,x]));
  const pendingDeactivationByDispenser=Object.fromEntries((Array.isArray(deactivationRequests)?deactivationRequests:[]).map(x=>[x.nozzle_id,x]));
  window.pendingDispenserDeactivationRequests=Array.isArray(deactivationRequests)?deactivationRequests:[];
  const names=Object.fromEntries(employees.map(e=>[e.id,e.name]));
  // Pending assignments are rendered in place of their dispenser card.
  // The separate pending-handover box is kept empty to avoid duplicate cards.
  const pendingBox=document.getElementById('pending-handovers');
  if(pendingBox) pendingBox.innerHTML='';

  document.getElementById('products').innerHTML=products.length?products.map(p=>`<div class="card settings-item-card ${p.active?'settings-active-card':''}" data-settings-key="products" data-settings-id="${p.id}" onclick="toggleSettingsItem(event,this)"><div class="top"><button type="button" class="settings-move-handle" title="Hold and drag to move" aria-label="Hold and drag to move" onclick="event.stopPropagation()">⋮</button><div><b><span style="display:inline-block;width:14px;height:14px;border-radius:50%;background:${h(p.color)};vertical-align:-1px;margin-right:6px"></span>${h(p.code_name)}</b><div class="settings-card-details"><div><span>Name:</span> <b>${h(p.name)}</b></div><div><span>Status:</span> <b>${p.active?'Active':'Inactive'}</b></div><div><span>Price:</span> <b>${p.selling_price==null?'Not set':h(stationCurrency+' '+Number(p.selling_price).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2}))}</b></div></div></div><div class="row settings-card-actions"><button type="button" class="settings-toggle-action" onclick="toggleProduct('${p.id}',${p.active})">${p.active?'Deactivate':'Activate'}</button><button type="button" onclick="openProductEdit('${p.id}')">Edit</button><button type="button" class="settings-remove-action" onclick="removeProduct('${p.id}')">Remove</button></div></div></div>`).join(''):'<p class="muted">No products.</p>';
  window.productRecords=products;
  const saleBox=document.getElementById('sale-types');
  if(saleBox){
    saleBox.innerHTML=saleTypes.length?saleTypes.map(s=>'<div class="card settings-item-card '+(s.active?'settings-active-card':'')+'" data-settings-key="saleTypes" data-settings-id="'+h(s.id)+'" onclick="toggleSettingsItem(event,this)"><div class="top"><button type="button" class="settings-move-handle" title="Hold and drag to move" aria-label="Hold and drag to move" onclick="event.stopPropagation()">⋮</button><div><b>'+h(s.name)+'</b><div class="settings-card-details"><div><span>Description:</span> <b>'+h(s.description||'No description')+'</b></div><div><span>Reason:</span> <b>'+(s.reason_required?'Required':'Optional')+'</b></div><div><span>Status:</span> <b>'+(s.active?'Active':'Inactive')+'</b></div></div></div><div class="row settings-card-actions"><button type="button" class="settings-toggle-action" onclick="toggleSaleType(\''+s.id+'\','+s.active+')">'+(s.active?'Deactivate':'Activate')+'</button><button type="button" onclick="openSaleTypeEdit(\''+s.id+'\')">Edit</button><button type="button" class="settings-remove-action" onclick="removeSaleType(\''+s.id+'\')">Remove</button></div></div></div>').join(''):'<p class="muted">No sales configured.</p>';
  }
  window.saleTypeRecords=saleTypes;
  document.getElementById('employees').innerHTML=employees.length?employees.map(e=>`<div class="card settings-item-card ${e.active?'settings-active-card':''}" data-settings-key="employees" data-settings-id="${e.id}" onclick="toggleSettingsItem(event,this)"><div class="top"><button type="button" class="settings-move-handle" title="Hold and drag to move" aria-label="Hold and drag to move" onclick="event.stopPropagation()">⋮</button><div><b>${h(e.name)}</b><div class="settings-card-details"><div><span>Operator ID:</span> <b>${h(e.operator_id)}</b></div><div><span>Phone:</span> <b>${h(e.phone)}</b></div><div><span>Role:</span> <b>${h(e.role)}</b></div><div><span>Status:</span> <b>${e.active?'Active':'Inactive'}</b></div></div></div><div class="row settings-card-actions"><button type="button" class="settings-toggle-action" onclick="toggleUser('${e.id}',${e.active})">${e.active?'Deactivate':'Activate'}</button><button type="button" onclick="openUserEdit('${e.id}')">Edit</button><button type="button" class="settings-remove-action" onclick="removeUser('${e.id}')">Remove</button></div></div></div>`).join(''):'<p class="muted">No users.</p>';
  window.employeeRecords=employees;
  const tankGroups=[];
  const tankGroupMap=new Map();
  tanks.forEach(t=>{
    const groupKey=String(t.product||'').trim().toLowerCase()||'unassigned';
    if(!tankGroupMap.has(groupKey)){
      const group={key:groupKey,items:[]};
      tankGroupMap.set(groupKey,group);
      tankGroups.push(group);
    }
    tankGroupMap.get(groupKey).items.push(t);
  });
  const groupedTanks=tankGroups.flatMap((group,groupIndex)=>group.items.map((t,itemIndex)=>({t,groupIndex,itemIndex,groupKey:group.key})));
  document.getElementById('tanks').innerHTML=groupedTanks.length?groupedTanks.map(({t,groupIndex,itemIndex,groupKey})=>`
    ${itemIndex===0?'<div class="settings-product-group-label '+(groupIndex>0?'settings-product-group-start':'')+'"><span class="settings-product-group-color" style="background:'+h(colorForProduct(t.product))+'"></span>'+h(codeForProduct(t.product))+'</div>':''}
    <div class="card settings-item-card ${t.active!==false?'settings-active-card':''} ${itemIndex===0&&groupIndex>0?'settings-group-card-start':''}" data-tank-product-group="${h(groupKey)}" data-settings-key="tanks" data-settings-id="${t.id}" onclick="toggleSettingsItem(event,this)">
      <div class="top"><button type="button" class="settings-move-handle" title="Hold and drag to move" aria-label="Hold and drag to move" onclick="event.stopPropagation()">⋮</button><div><b>${h(t.tank_code)}</b><div class="settings-card-details"><div><span>Capacity:</span> <b>${liters(t.capacity_liters)} L</b></div><div><span>Status:</span> <b>${t.active===false?'Inactive':'Active'}</b></div><div><span>Opening stock:</span> <b>${t.opening_stock_liters==null?'Not recorded':liters(t.opening_stock_liters)+' L'}</b></div></div></div><div class="row settings-card-actions"><button type="button" class="settings-toggle-action" onclick="toggleTank('${t.id}',${t.active!==false})">${t.active===false?'Activate':'Deactivate'}</button><button type="button" onclick="openTankEdit('${t.id}')">Edit</button><button type="button" class="settings-remove-action" onclick="removeTank('${t.id}')">Remove</button></div></div>
    </div>`).join(''):'<p class="muted">No tanks.</p>';
  window.tankRecords=tanks;
  const dispenserGroups=[];
  const dispenserGroupMap=new Map();
  dispensers.forEach(n=>{
    const groupKey=String(n.product||'').trim().toLowerCase()||'unassigned';
    if(!dispenserGroupMap.has(groupKey)){
      const group={key:groupKey,items:[]};
      dispenserGroupMap.set(groupKey,group);
      dispenserGroups.push(group);
    }
    dispenserGroupMap.get(groupKey).items.push(n);
  });
  const groupedDispensers=dispenserGroups.flatMap((group,groupIndex)=>group.items.map((n,itemIndex)=>({n,groupIndex,itemIndex,groupKey:group.key})));
  document.getElementById('dispensers').innerHTML=groupedDispensers.length?groupedDispensers.map(({n,groupIndex,itemIndex,groupKey})=>{
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
    const nozzleRows=(n.nozzle_ids||[]).map((id,idx)=>{
      const reading=(activeReadings||[]).find(r=>String(r.nozzle_id)===String(id));
      return '<div class="dispenser-nozzle-row"><span class="dispenser-nozzle-dot" style="background:'+h(colorForProduct(n.product))+'"></span><div class="dispenser-nozzle-main"><b>Nozzle '+(idx+1)+'</b><span>'+h(id)+'</span></div><div class="dispenser-nozzle-reading">'+(reading?'<span>Opening</span><b>'+Number(reading.opening_reading||0).toFixed(0)+'</b>':'<span>Meter</span><b>—</b>')+'</div></div>';
    }).join('');
    if(pending){
      const readings=Array.isArray(pending.activation_nozzles)?pending.activation_nozzles:[];
      const readingText=readings.length
        ?readings.map(r=>'<div class="dispenser-reading-row"><span>'+h(r.nozzle_id)+'</span><b>'+Number(r.opening_reading||0).toFixed(0)+'</b></div>').join('')
        :'<span class="muted">No opening readings recorded</span>';
      return (itemIndex===0?'<div class="settings-product-group-label"><span class="settings-product-group-color" style="background:'+h(colorForProduct(n.product))+'"></span>'+h(productCode)+'</div>':'')+'<div class="card settings-item-card dispenser-settings-card dispenser-pending-card '+(itemIndex===0&&groupIndex>0?'dispenser-group-start':'')+'" data-dispenser-product-group="'+h(groupKey)+'" data-settings-key="dispensers" data-settings-id="'+pending.id+'" onclick="toggleSettingsItem(event,this)">'+
        '<div class="dispenser-card-head"><button type="button" class="settings-move-handle" title="Hold and drag to move" aria-label="Hold and drag to move" onclick="event.stopPropagation()">⋮</button><div><span class="section-kicker">SHIFT ASSIGNMENT</span><h3>Pending shift</h3><span class="badge">Awaiting attendant confirmation</span></div></div>'+
        '<div class="dispenser-identity"><div class="dispenser-name">'+h(n.nozzle_code)+'</div><div class="dispenser-product">'+h(productCode)+' <span>•</span> '+h(nozzleLabel)+'</div></div>'+
        '<div class="dispenser-info-grid">'+
          '<div><span>Connected tank</span><b>'+h(tank?.tank_code||n.tank_id||'Not connected')+'</b></div>'+
          '<div><span>Tank opening</span><b>'+liters(pending.opening_tank_liters)+' L</b></div>'+
          '<div><span>Assigned attendant</span><b>'+h(names[pending.employee_id]||pending.employee_id)+'</b></div>'+
          '<div><span>Dispenser status</span><b>Inactive</b></div>'+
        '</div>'+
        '<div class="dispenser-detail-block"><span class="dispenser-detail-title">Nozzle opening readings</span>'+readingText+'</div>'+
        '<p class="dispenser-note">The dispenser will remain inactive until the assigned attendant confirms the readings with their PIN.</p>'+
        '<div class="dispenser-card-actions"><button type="button" class="dispenser-danger-action" onclick="cancelAdminPendingShift(\''+pending.id+'\')">Cancel assignment</button></div>'+
      '</div>';
    }
    const pendingDeactivation=pendingDeactivationByDispenser[n.id];
    if(pendingDeactivation){
      const requestReadings=Array.isArray(pendingDeactivation.nozzle_readings)?pendingDeactivation.nozzle_readings:[];
      const requestReadingText=requestReadings.length
        ?requestReadings.map((r,idx)=>'<div class="dispenser-reading-row"><span>'+h(r.nozzle_code||r.nozzle_id||('Nozzle '+(idx+1)))+'</span><b>'+reading(r.opening_reading)+'</b></div>').join('')
        :'<span class="muted">No opening readings recorded</span>';
      const requestShift=pendingDeactivation.shift||{};
      const requestAttendant=names[requestShift.employee_id]||requestShift.employee_id||'Assigned attendant';
      return (itemIndex===0?'<div class="settings-product-group-label"><span class="settings-product-group-color" style="background:'+h(colorForProduct(n.product))+'"></span>'+h(productCode)+'</div>':'')+'<div class="card settings-item-card dispenser-settings-card dispenser-pending-card '+(n.active?'dispenser-active-card settings-active-card':'')+' '+(itemIndex===0&&groupIndex>0?'dispenser-group-start':'')+'" data-dispenser-product-group="'+h(groupKey)+'" data-settings-key="dispensers" data-settings-id="'+h(n.id)+'" onclick="toggleSettingsItem(event,this)">'+
        '<div class="dispenser-card-head"><span></span><div><span class="section-kicker">DISPENSER DEACTIVATION</span><h3>'+h(n.nozzle_code)+'</h3><span class="badge">Deactivation pending</span></div><div class="dispenser-status is-active"><span></span>Pending</div></div>'+
        '<div class="dispenser-info-grid"><div><span>Connected tank</span><b>'+h(tank?.tank_code||n.tank_id||'Not connected')+'</b></div><div><span>Assigned attendant</span><b>'+h(requestAttendant)+'</b></div><div><span>Dispenser status</span><b>Awaiting attendant</b></div></div>'+
        '<div class="dispenser-detail-block"><span class="dispenser-detail-title">Opening readings</span>'+requestReadingText+'</div>'+
        '<p class="dispenser-note">Waiting for the assigned attendant to enter the closing nozzle readings, closing tank stock, and PIN.</p>'+
        '<div class="dispenser-card-actions"><button type="button" class="dispenser-danger-action" onclick="cancelPendingDispenserDeactivation(event,\''+pendingDeactivation.id+'\')">Cancel deactivation</button></div>'+
      '</div>';
    }
    return (itemIndex===0?'<div class="settings-product-group-label">'+h(productCode)+'</div>':'')+'<div class="card settings-item-card dispenser-settings-card '+(n.active?'dispenser-active-card settings-active-card':'')+' '+(itemIndex===0&&groupIndex>0?'dispenser-group-start':'')+'" data-dispenser-product-group="'+h(groupKey)+'" data-settings-key="dispensers" data-settings-id="'+h(n.id)+'" onclick="toggleSettingsItem(event,this)">'+
      '<div class="dispenser-card-head"><button type="button" class="settings-move-handle" title="Hold and drag to move" aria-label="Hold and drag to move" onclick="event.stopPropagation()">⋮</button><div><span class="section-kicker">FUEL DISPENSER</span><h3>'+h(n.nozzle_code)+'</h3><div class="dispenser-product">'+h(productCode)+' <span>•</span> '+h(nozzleLabel)+'</div></div>'+
      '<div class="dispenser-status '+(n.active?'is-active':'is-inactive')+'"><span></span>'+(n.active?'Active':'Inactive')+'</div></div>'+
      '<div class="dispenser-main-body">'+
      '<div class="dispenser-info-grid">'+
        '<div><span>Connected tank</span><b>'+h(tank?.tank_code||n.tank_id||'Not connected')+'</b></div>'+
        '<div><span>Tank opening</span><b>'+(n.opening_tank_liters==null?'Not recorded':liters(n.opening_tank_liters)+' L')+'</b></div>'+
        (n.active?'<div><span>Current shift</span><b>'+(attendant?h(attendant.name):'No active shift')+'</b></div>':'')+
      '</div>'+
      '<div class="dispenser-detail-block"><span class="dispenser-detail-title">Nozzle opening readings</span>'+activeReadingText+'</div>'+
      '<div class="dispenser-detail-block"><span class="dispenser-detail-title">Physical nozzles</span><div class="dispenser-nozzle-rows">'+(nozzleRows||'<span class="muted">No nozzle identifiers</span>')+'</div></div>'+
      '</div>'+
      '<div class="dispenser-card-actions">'+
        '<button type="button" class="primary" onclick="toggleNozzle(\''+n.id+'\','+n.active+')">'+(n.active?'DEACTIVATE':'ACTIVATE DISPENSER')+'</button>'+
        (!n.active?'<button type="button" onclick="openDispenserEdit(\''+n.id+'\')">Edit dispenser</button>':'')+
        '<button type="button" class="dispenser-remove-action" onclick="removeDispenser(\''+n.id+'\')">Remove</button>'+
      '</div>'+
    '</div>';
  }).join(''):'<p class="muted">No dispensers configured yet.</p>';
window.dispenserRecords=dispensers;
  initSettingsItemDrag();
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
  const currencyLabel=document.getElementById('edit-product-currency'); if(currencyLabel)currencyLabel.textContent='('+String(document.getElementById('station-currency')?.value||'ETB').trim()+')';
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
function openStationCurrencyModal(){
  const modal=document.getElementById('station-currency-modal');
  const input=document.getElementById('station-currency');
  if(!modal||!input)return;
  input.value=String(window.stationCurrency||'ETB');
  modal.classList.add('open');
  modal.setAttribute('aria-hidden','false');
  input.focus();
}
function closeStationCurrencyModal(){
  const modal=document.getElementById('station-currency-modal');
  if(modal){modal.classList.remove('open');modal.setAttribute('aria-hidden','true');}
}
async function saveStationCurrency(event){
  event.preventDefault();
  const input=document.getElementById('station-currency');
  const currency=String(input?.value||'').trim().toUpperCase();
  if(!currency){toast('Enter a currency');return;}
  try{
    await api('/api/settings',{method:'PATCH',body:JSON.stringify({currency})});
    closeStationCurrencyModal();
    await loadSettingsData();
    toast('Currency updated successfully');
  }catch(e){throw e;}
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
async function createSaleType(event){
  event.preventDefault();
  try{
    await api('/api/sale-types',{method:'POST',body:JSON.stringify({
      name:document.getElementById('sale-type-name').value.trim(),
      description:document.getElementById('sale-type-description').value.trim(),
      reason_required:document.getElementById('sale-type-reason').checked
    })});
    closeAddModal('add-sale-type-modal');
    document.getElementById('sale-type-name').value='';
    document.getElementById('sale-type-description').value='';
    document.getElementById('sale-type-reason').checked=false;
    await loadSettingsData();
  }catch(e){throw e;}
}
function openSaleTypeEdit(id){
  const s=(window.saleTypeRecords||[]).find(x=>String(x.id)===String(id)); if(!s)return;
  document.getElementById('edit-sale-type-id').value=s.id;
  document.getElementById('edit-sale-type-name').value=s.name||'';
  document.getElementById('edit-sale-type-description').value=s.description||'';
  document.getElementById('edit-sale-type-reason').checked=!!s.reason_required;
  const modal=document.getElementById('sale-type-edit-modal');
  modal.classList.add('open');modal.setAttribute('aria-hidden','false');
}
function closeSaleTypeEdit(){
  const modal=document.getElementById('sale-type-edit-modal');
  if(modal){modal.classList.remove('open');modal.setAttribute('aria-hidden','true');}
}
async function saveSaleTypeEdit(event){
  event.preventDefault();
  const id=document.getElementById('edit-sale-type-id').value;
  try{
    await api('/api/sale-types/'+id,{method:'PATCH',body:JSON.stringify({
      name:document.getElementById('edit-sale-type-name').value.trim(),
      description:document.getElementById('edit-sale-type-description').value.trim(),
      reason_required:document.getElementById('edit-sale-type-reason').checked
    })});
    closeSaleTypeEdit();await loadSettingsData();
  }catch(e){throw e;}
}
async function _removeSaleType(id){await api('/api/sale-types/'+id,{method:'DELETE'});await loadSettingsData();}
function removeSaleType(id){
  const s=settingsRecord(window.saleTypeRecords,id);
  const details='<p><b>Sale:</b> '+h(s?.name||id)+'</p>'+settingsStatus('Will be permanently removed');
  showSettingsConfirmation('Review Sale Removal',details,()=>_removeSaleType(id),'Sale removed successfully','<p>The sale was removed successfully.</p>'+details);
}
async function _toggleSaleType(id,active){await api('/api/sale-types/'+id,{method:'PATCH',body:JSON.stringify({active:!active})});await loadSettingsData();}
function toggleSaleType(id,active){showSettingsConfirmation(active?'Deactivate Sale':'Activate Sale','<p><b>Sale:</b> '+h((window.saleTypeRecords||[]).find(x=>String(x.id)===String(id))?.name||id)+'</p>',()=>_toggleSaleType(id,active),active?'Sale deactivated':'Sale activated','The sale status was updated.');}

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
  const currencyLabel=document.getElementById('activation-product-currency'); if(currencyLabel)currencyLabel.textContent='('+String(document.getElementById('station-currency')?.value||'ETB').trim()+')';
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
  const productKey=String(t.product||'').toLowerCase();
  document.getElementById('edit-tank-id').value=t.id;
  document.getElementById('edit-tank-capacity').value=t.capacity_liters||'';
  const calMm=document.getElementById('edit-tank-calibration-mm');
  const calLiters=document.getElementById('edit-tank-calibration-liters');
  if(calMm)calMm.value=t.calibration_mm??'';
  if(calLiters)calLiters.value=t.calibration_liters??'';
  const modal=document.getElementById('tank-edit-modal');
  modal.classList.add('open');
  modal.setAttribute('aria-hidden','false');
  document.getElementById('edit-tank-capacity').focus();
}
function closeTankEdit(){
  const modal=document.getElementById('tank-edit-modal');
  modal.classList.remove('open');
  modal.setAttribute('aria-hidden','true');
  document.getElementById('tank-edit-form').reset();
}
async function _saveTankEdit(){
  const id=document.getElementById('edit-tank-id').value;
  const capacity=Number(document.getElementById('edit-tank-capacity').value);
  const mmEl=document.getElementById('edit-tank-calibration-mm');
  const litersEl=document.getElementById('edit-tank-calibration-liters');
  const mmRaw=(mmEl?.value||'').trim();
  const litersRaw=(litersEl?.value||'').trim();
  if(!id)throw new Error('Tank ID is missing.');
  if(!Number.isFinite(capacity)||capacity<=0)throw new Error('Enter a valid tank capacity.');
  if((mmRaw && !litersRaw)||(!mmRaw && litersRaw)){
    throw new Error('Enter both calibration mm and calibration liters, or leave both blank.');
  }
  const body={capacity_liters:capacity};
  if(mmRaw&&litersRaw){
    const calibrationMm=Number(mmRaw);
    const calibrationLiters=Number(litersRaw);
    if(!Number.isFinite(calibrationMm)||calibrationMm<=0)throw new Error('Calibration mm must be greater than zero.');
    if(!Number.isFinite(calibrationLiters)||calibrationLiters<0)throw new Error('Calibration liters cannot be negative.');
    if(calibrationLiters>capacity)throw new Error('Calibration liters cannot exceed tank capacity.');
    body.calibration_mm=calibrationMm;
    body.calibration_liters=calibrationLiters;
  }
  await api('/api/tanks/'+encodeURIComponent(id),{method:'PATCH',body:JSON.stringify(body)});
  closeTankEdit();
  await loadSettingsData();
}
function tankLitersFromDip(t,mm){const v=Number(mm);if(!t||!Number.isFinite(v)||v<0)return null;const p=Array.isArray(t.calibration_points)?t.calibration_points.map(x=>({height_mm:Number(x?.height_mm),liters:Number(x?.liters)})).filter(x=>Number.isFinite(x.height_mm)&&Number.isFinite(x.liters)&&x.height_mm>=0&&x.liters>=0).sort((a,b)=>a.height_mm-b.height_mm):[];if(p.length>=2){if(v<=p[0].height_mm)return p[0].liters;if(v>=p[p.length-1].height_mm)return p[p.length-1].liters;for(let i=1;i<p.length;i++){const a=p[i-1],b=p[i];if(v<=b.height_mm)return a.liters+(b.liters-a.liters)*(v-a.height_mm)/(b.height_mm-a.height_mm);}}const rm=Number(t.calibration_mm),rl=Number(t.calibration_liters);return Number.isFinite(rm)&&rm>0&&Number.isFinite(rl)?v*rl/rm:null;}
function setTankDipEquivalent(t,mm,id){const o=document.getElementById(id);if(!o)return null;const v=tankLitersFromDip(t,mm);o.textContent=v===null?'Set calibration first':v>Number(t?.capacity_liters||0)?'Over capacity':liters(v)+' L';return v;}
function convertTankDip(id,input){const t=(window.tankRecords||[]).find(x=>String(x.id)===String(id));setTankDipEquivalent(t,Number(input?.value),'tank-dip-liters-'+id);}

function updateTankOpeningDip(value){const id=document.getElementById('activation-target-id')?.value;const tank=(window.tankRecords||[]).find(x=>String(x.id)===String(id));setTankDipEquivalent(tank,Number(value),'tank-opening-stock-equivalent');}
function updateDispenserActivationDip(value){const id=document.getElementById('dispenser-activation-tank-dip')?.dataset.tankId;const tank=(window.tankRecords||[]).find(x=>String(x.id)===String(id));setTankDipEquivalent(tank,Number(value),'dispenser-activation-tank-equivalent');}
function updateHandoverClosingDip(value){setTankDipEquivalent(window.handoverDraft?.tank,Number(value),'handover-closing-equivalent');}

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
  const stockInput=document.getElementById('tank-opening-stock'); if(stockInput)stockInput.value=''; const stockEq=document.getElementById('tank-opening-stock-equivalent'); if(stockEq)stockEq.textContent='Enter a dip to calculate liters.';
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
  productSelect.onchange=()=>{fillTanks();};
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
      const tank=(window.tankRecords||[]).find(x=>String(x.id)===String(id));
      const stockLiters=tankLitersFromDip(tank,stock);
      if(!Number.isFinite(stock)||stock<0||stockLiters===null){toast('Enter a valid opening dip and ensure calibration is set.');return false;}
      body.opening_stock_liters=stockLiters;
      body.opening_stock_mm=stock;
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
  if(tankLabel)tankLabel.firstChild.textContent=''+(tank?.tank_code||'Tank')+' opening dip (mm)';
  const tankDipInput=document.getElementById('dispenser-activation-tank-dip');
  if(tankDipInput){
    tankDipInput.value='';
    tankDipInput.dataset.tankId=tank.id;
  }
  const tankEquivalent=document.getElementById('dispenser-activation-tank-equivalent');
  if(tankEquivalent)tankEquivalent.textContent='Enter a dip to calculate liters.';
  const tankLitersInput=document.getElementById('dispenser-activation-tank-liters');
  if(tankLitersInput)tankLitersInput.value='';
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
  const tank= (window.tankRecords||[]).find(x=>String(x.id)===String(d.tank_id));
  const openingTankMm=Number(document.getElementById('dispenser-activation-tank-dip')?.value);
  const openingTankLiters=tankLitersFromDip(tank,openingTankMm);
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
    error.textContent='Enter a valid tank opening dip and ensure calibration is set.';
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
  if(review)review.innerHTML='<div class="card" style="margin:0"><b>Attendant reading confirmation</b><p style="margin:6px 0">Attendant: <b>'+h(attendantName)+'</b></p><p style="margin:6px 0">Tank opening liters: <b>'+liters(openingTankLiters)+' L</b></p><p style="margin:6px 0">Nozzle opening readings: '+selected.map(x=>'<b>'+h(x.nozzle_id)+'</b> = '+liters(x.activation_number)).join(' • ')+'</p><p class="muted" style="margin:6px 0 0">The selected Attendant must review these readings and confirm they are correct before the shift is activated.</p></div>';
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

let pendingDispenserDeactivationId=null;

function openAdminPinConfirmation(id){
  const d=(window.dispenserRecords||[]).find(x=>String(x.id)===String(id));
  if(!d)return;
  pendingDispenserDeactivationId=id;
  let modal=document.getElementById('admin-pin-confirm-modal');
  if(!modal){
    modal=document.createElement('div');
    modal.id='admin-pin-confirm-modal';
    modal.className='modal';
    modal.setAttribute('aria-hidden','true');
    modal.innerHTML='<div class="modal-backdrop" onclick="closeAdminPinConfirmation()"></div><form class="modal-card form" onsubmit="confirmDispenserDeactivation(event)"><div class="top"><h3>Admin confirmation required</h3><button type="button" class="modal-close" onclick="closeAdminPinConfirmation()" aria-label="Close">×</button></div><p id="admin-pin-confirm-message">Enter the admin PIN to deactivate this active dispenser.</p><label>Admin PIN<input id="admin-pin-confirm-input" type="password" inputmode="numeric" autocomplete="current-password" minlength="4" required placeholder="Enter admin PIN"></label><p id="admin-pin-confirm-error" class="muted" style="display:none"></p><div class="row"><button type="button" onclick="closeAdminPinConfirmation()">Cancel</button><button type="submit" class="primary">Confirm deactivation</button></div></form></div>';
    document.body.appendChild(modal);
  }
  const msg=document.getElementById('admin-pin-confirm-message');
  if(msg)msg.innerHTML='Enter the <b>admin PIN</b> to deactivate <b>'+h(d.nozzle_code||'this dispenser')+'</b>.';
  const input=document.getElementById('admin-pin-confirm-input');
  const error=document.getElementById('admin-pin-confirm-error');
  if(input)input.value='';
  if(error){error.textContent='';error.style.display='none';}
  modal.classList.add('open');
  modal.setAttribute('aria-hidden','false');
  setTimeout(()=>input?.focus(),0);
}

function closeAdminPinConfirmation(){
  const modal=document.getElementById('admin-pin-confirm-modal');
  if(modal){modal.classList.remove('open');modal.setAttribute('aria-hidden','true');}
  pendingDispenserDeactivationId=null;
}

async function confirmDispenserDeactivation(event){
  event?.preventDefault();
  const id=pendingDispenserDeactivationId;
  const pin=document.getElementById('admin-pin-confirm-input')?.value.trim()||'';
  const error=document.getElementById('admin-pin-confirm-error');
  if(!id)return;
  if(!pin){
    if(error){error.textContent='Enter the admin PIN.';error.style.display='block';}
    return;
  }
  try{
    const me=await currentUser();
    if(!me||me.role!=='admin')throw new Error('Only an admin can confirm dispenser deactivation.');
    const verified=await api('/api/admin-login',{method:'POST',body:JSON.stringify({operator_id:me.operator_id,pin})});
    if(!verified||verified.role!=='admin')throw new Error('Invalid admin PIN.');
    await api('/api/nozzles/'+encodeURIComponent(id)+'/deactivation-request',{method:'POST',body:JSON.stringify({pin})});
    closeAdminPinConfirmation();
    await loadSettingsData();
    toast('Deactivation pending — waiting for the assigned attendant to confirm the closing readings.');
  }catch(e){
    if(error){error.textContent=e.message||'Admin PIN verification failed.';error.style.display='block';}
    else toast(e.message);
  }
}

async function _toggleNozzle(id,active){
  if(!active){openDispenserActivation(id);return;}
  openAdminPinConfirmation(id);
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
    await window.stationCurrencyReady;
    const saleCurrency=document.getElementById('sale-currency'); if(saleCurrency)saleCurrency.textContent='('+currencyLabel()+')';
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
  await window.stationCurrencyReady;
  const box=document.getElementById('sales-history');
  if(!box)return;
  try{
    const [rows,products]=await Promise.all([api('/api/sales'),api('/api/products')]);
    const productCodes=Object.fromEntries(products.map(p=>[String(p.name).toLowerCase(),p.code_name]));
    const codeForProduct=product=>productCodes[String(product||'').toLowerCase()]||product;
    box.innerHTML=rows.length?rows.slice(0,20).map(s=>`<div class="card"><b>${h(codeForProduct(s.product))}</b> — ${liters(s.quantity_liters)} L × ${money(s.unit_price)}<br><span class="muted">${money(s.amount)} • ${h(s.payment_method)} • ${new Date(s.sale_time).toLocaleString()}</span></div>`).join(''):'No sales recorded yet.';
  }catch(e){box.textContent=e.message;}
}

async function openDashboardHandover(shiftId){
  try{
    const me=await currentUser();
    const [shifts,employees,nozzles,tanks]=await Promise.all([
      api('/api/shifts'),
      api('/api/handover-receivers').catch(()=>[]),
      api('/api/nozzles'),
      api('/api/tanks')
    ]);
    const active=shifts.filter(s=>s.status==='active'&&String(s.employee_id)===String(me.id));
    const selected=active.find(s=>String(s.id)===String(shiftId))||active[0];
    if(!selected){toast('No active shift available for handover.');return;}

    const nozzle=nozzles.find(n=>String(n.id)===String(selected.nozzle_id));
    const tank=tanks.find(t=>String(t.id)===String(nozzle?.tank_id));
    const nozzleIds=Array.isArray(nozzle?.nozzle_ids)&&nozzle.nozzle_ids.length
      ?nozzle.nozzle_ids
      :[nozzle?.nozzle_code||selected.nozzle_id];
    window.handoverDraft={
      shift_id:selected.id,
      nozzle_id:selected.nozzle_id,
      nozzle_code:nozzle?.nozzle_code||selected.nozzle_id,
      nozzle_ids:nozzleIds,
      tank_id:nozzle?.tank_id||'',
      tank_code:tank?.tank_code||nozzle?.tank_id||'Not connected',
      tank:tank||null,
      to_employee_id:'',
      closing_reading:null,
      closing_nozzle_readings:[],
      closing_liters:null,
      nozzle_readings:Array.isArray(selected.nozzle_readings)?selected.nozzle_readings:[],
      shift_nozzle_readings:Array.isArray(selected.nozzle_readings)?selected.nozzle_readings:[],
      activation_nozzles:Array.isArray(selected.activation_nozzles)?selected.activation_nozzles:[]
    };

    const receiving=employees.filter(e=>String(e.id)!==String(me.id));
    const select=document.getElementById('handover-to-employee');
    if(!select){toast('Handover form is unavailable.');return;}
    select.innerHTML='<option value="">Select receiving attendant</option>'+
      receiving.map(e=>'<option value="'+h(e.id)+'">'+h(e.name)+' — ID '+h(e.operator_id)+'</option>').join('');
    if(!receiving.length)select.innerHTML='<option value="">No available receiving attendant</option>';
    let picker=select.parentElement?.querySelector('.handover-attendant-picker');
    if(picker)picker.remove();
    picker=document.createElement('div');
    picker.className='handover-attendant-picker';
    const options=[{value:'',label:'Select receiving attendant'}].concat(receiving.map(e=>({value:String(e.id),label:String(e.name)+' — ID '+String(e.operator_id||'')})));
    picker.innerHTML='<button type="button" class="handover-attendant-picker-button"><span class="handover-attendant-picker-label">Select receiving attendant</span><span class="handover-attendant-picker-arrow">⌄</span></button><div class="handover-attendant-picker-list">'+options.map(o=>'<button type="button" class="handover-attendant-picker-option'+(o.value?'':' placeholder')+'" data-value="'+h(o.value)+'">'+h(o.label)+'</button>').join('')+'</div>';
    select.parentElement?.appendChild(picker);
    select.style.position='absolute';
    const pickerButton=picker.querySelector('.handover-attendant-picker-button');
    const pickerLabel=picker.querySelector('.handover-attendant-picker-label');
    pickerButton?.addEventListener('click',()=>picker.classList.toggle('open'));
    picker.querySelectorAll('.handover-attendant-picker-option').forEach(option=>{
      option.addEventListener('click',()=>{
        select.value=option.dataset.value||'';
        pickerLabel.textContent=option.textContent;
        picker.querySelectorAll('.handover-attendant-picker-option').forEach(x=>x.classList.remove('selected'));
        option.classList.add('selected');
        picker.classList.remove('open');
      });
    });
    document.addEventListener('click',function closeAttendantPicker(ev){
      if(!picker.contains(ev.target)){
        picker.classList.remove('open');
      }
    },{once:false});
    if(!receiving.length)picker.querySelector('.handover-attendant-picker-button').disabled=true;

    const dispenser=document.getElementById('handover-dispenser');
    const dispenserTitle=document.getElementById('handover-dispenser-title');
    const tankEl=document.getElementById('handover-tank');
    if(dispenser)dispenser.textContent=nozzle?.nozzle_code||selected.nozzle_id||'—';
    if(dispenserTitle)dispenserTitle.textContent=nozzle?.nozzle_code||selected.nozzle_id||'Dispenser';
    if(tankEl)tankEl.textContent=tank?.tank_code||nozzle?.tank_id||'Not connected';

    const nozzleInputs=document.getElementById('handover-nozzle-readings');
    const normalizedOpenings=Array.isArray(selected.nozzle_readings)?selected.nozzle_readings:[];
    const activationOpenings=Array.isArray(selected.activation_nozzles)?selected.activation_nozzles:[];
    const openingForNozzle=(id)=>{
      const nr=normalizedOpenings.find(r=>String(r.nozzle_code||r.nozzle_id)===String(id));
      if(nr&&Number.isFinite(Number(nr.opening_reading)))return Number(nr.opening_reading);
      const ar=activationOpenings.find(r=>String(r.nozzle_id)===String(id));
      return ar&&Number.isFinite(Number(ar.opening_reading))?Number(ar.opening_reading):null;
    };
    if(nozzleInputs){
      nozzleInputs.innerHTML=nozzleIds.map((id,i)=>{
        const opening=openingForNozzle(id);
        const minAttr=opening!==null?' min="'+opening+'"':' min="0"';
        const placeholder=opening!==null?'Closing must be '+opening+' or higher':'Enter closing meter reading';
        return '<label class="handover-nozzle-input"><span>Nozzle '+(i+1)+' — '+h(id)+'</span>'+
          '<small class="muted">Opening: '+(opening!==null?String(opening):'Not recorded')+'</small>'+
          '<input id="handover-nozzle-reading-'+i+'" type="number"'+minAttr+' step="0.01" placeholder="'+placeholder+'" required></label>';
      }).join('');
    }
    const closingLiters=document.getElementById('handover-closing-liters');
    if(closingLiters)closingLiters.value='';
    if(closingLiters)closingLiters.setAttribute('data-tank-id',nozzle?.tank_id||'');

    openHandoverInputModal();
  }catch(e){toast(e.message);}
}
async function loadHandover(){
  try{
    const me=await currentUser(),[shifts,employees,nozzles,tanks]=await Promise.all([api('/api/shifts'),api('/api/handover-receivers').catch(()=>[]),api('/api/nozzles'),api('/api/tanks').catch(()=>[])]);
    const active=shifts.filter(s=>s.status==='active'&&String(s.employee_id)===String(me.id));
    const requested=new URLSearchParams(location.search).get('shift_id');
    const selected=active.find(s=>s.id===requested)||active[0];
    if(!selected){
      document.getElementById('handover-status').textContent='No active shift available for handover.';
      return;
    }
    const selectedNozzle=nozzles.find(n=>String(n.id)===String(selected.nozzle_id));const handoverTank=tanks.find(t=>String(t.id)===String(selectedNozzle?.tank_id||''));window.handoverDraft={shift_id:selected.id,to_employee_id:'',closing_reading:null,closing_liters:null,tank:handoverTank,nozzle_ids:selected.nozzle_ids||selectedNozzle?.nozzle_ids||[]};
    document.getElementById('handover-status').textContent='Review the closing readings and receiving attendant.';
    const receiving=employees.filter(e=>String(e.id)!==String(me.id));
    document.getElementById('handover-to-employee').innerHTML='<option value="">Select receiving attendant</option>'+
      receiving.map(e=>'<option value="'+h(e.id)+'">'+h(e.name)+' — ID '+h(e.operator_id)+'</option>').join('');
    if(!receiving.length)document.getElementById('handover-to-employee').innerHTML='<option value="">No available receiving attendant</option>';
    openHandoverInputModal();
  }catch(e){document.getElementById('handover-status').textContent=e.message;}
}
function openHandoverInputModal(){
  const modal=document.getElementById('handover-input-modal');
  if(modal){modal.classList.add('open');modal.setAttribute('aria-hidden','false');}
}
function closeHandoverModal(id){
  const modal=document.getElementById(id);
  if(modal){modal.classList.remove('open');modal.setAttribute('aria-hidden','true');}
}
function cancelHandoverForm(){
  closeHandoverModal('handover-input-modal');
  window.handoverDraft=null;
}
function continueHandover(event){
  event.preventDefault();
  const to=document.getElementById('handover-to-employee').value;
  const nozzleIds=window.handoverDraft?.nozzle_ids||[];
  const closingNozzleReadings=nozzleIds.map((id,i)=>{
    const value=Number(document.getElementById('handover-nozzle-reading-'+i)?.value);
    return {nozzle_id:id,reading:value};
  });
  const closingMm=Number(document.getElementById('handover-closing-dip').value),closingLiters=tankLitersFromDip(window.handoverDraft?.tank,closingMm);
  if(!to){toast('Select a receiving attendant');return;}
  if(!closingNozzleReadings.length||closingNozzleReadings.some(x=>!Number.isFinite(x.reading)||x.reading<0)){toast('Enter a valid closing reading for every dispenser nozzle');return;}
  const normalizedOpenings=Array.isArray(window.handoverDraft?.nozzle_readings)?window.handoverDraft.nozzle_readings:[];
  const selectedShiftOpening=window.handoverDraft?.shift_nozzle_readings||[];
  const activationOpenings=Array.isArray(window.handoverDraft?.activation_nozzles)?window.handoverDraft.activation_nozzles:[];
  for(const item of closingNozzleReadings){
    const nr=normalizedOpenings.find(r=>String(r.nozzle_code||r.nozzle_id)===String(item.nozzle_id))||selectedShiftOpening.find(r=>String(r.nozzle_code||r.nozzle_id)===String(item.nozzle_id));
    const ar=activationOpenings.find(r=>String(r.nozzle_id)===String(item.nozzle_id));
    const opening=nr&&Number.isFinite(Number(nr.opening_reading))?Number(nr.opening_reading):(ar&&Number.isFinite(Number(ar.opening_reading))?Number(ar.opening_reading):null);
    if(opening!==null&&item.reading<opening){
      toast('Closing reading for '+item.nozzle_id+' cannot be lower than opening reading ('+opening+').');
      return;
    }
  }
  if(!Number.isFinite(closingLiters)||closingLiters<0){toast('Enter a valid tank closing dip and ensure calibration is set.');return;}
  const primaryReading=closingNozzleReadings[0].reading;
  window.handoverDraft={...window.handoverDraft,to_employee_id:to,closing_reading:primaryReading,closing_nozzle_readings:closingNozzleReadings,closing_liters:closingLiters,closing_mm:closingMm};
  const employeeSelect=document.getElementById('handover-to-employee');
  const employeeName=employeeSelect?.selectedOptions?.[0]?.textContent||to;
  const reviewNozzles=closingNozzleReadings.map((x,i)=>
    '<div class="handover-review-row"><span><b>Nozzle '+(i+1)+'</b><small>'+h(x.nozzle_id)+'</small></span><strong>'+Number(x.reading).toFixed(2).replace(/\\.?0+$/,'')+'</strong></div>'
  ).join('');
  document.getElementById('handover-review-details').innerHTML=
    '<div class="handover-review-summary">'+
      '<div class="handover-review-main"><span>Receiving attendant</span><strong>'+h(employeeName)+'</strong></div>'+
      '<div class="handover-review-section"><div class="handover-review-section-title">Closing meter readings</div>'+reviewNozzles+'</div>'+
      '<div class="handover-review-main"><span>Tank closing dip</span><strong>'+Number(closingMm).toLocaleString(undefined,{maximumFractionDigits:1})+' mm</strong></div><div class="handover-review-main"><span>Liter equivalent</span><strong>'+closingLiters.toLocaleString(undefined,{maximumFractionDigits:2})+' L</strong></div>'+
    '</div>';
  closeHandoverModal('handover-input-modal');
  const review=document.getElementById('handover-review-modal');
  if(review){review.classList.add('open');review.setAttribute('aria-hidden','false');}
}
function cancelHandoverReview(){
  closeHandoverModal('handover-review-modal');
  openHandoverInputModal();
}
async function confirmHandoverSubmission(){
  const d=window.handoverDraft;
  if(!d?.shift_id)return;
  try{
    await api('/api/handovers',{method:'POST',body:JSON.stringify({
      shift_id:d.shift_id,
      to_employee_id:d.to_employee_id,
      closing_reading:d.closing_reading,
      closing_mm:0,
      closing_liters:d.closing_liters,
      closing_nozzle_readings:d.closing_nozzle_readings||[]
    })});
    closeHandoverModal('handover-review-modal');
    showAttendantActionResult('success','Handover submitted','The handover was sent successfully for receiving-attendant confirmation.',()=>userDashboard());
  }catch(e){
    showAttendantActionResult('failed','Handover submission failed',e.message||'The handover could not be submitted.');
  }
}
async function loadPendingHandovers(){
  try{
    const [hs,emps,tanks]=await Promise.all([api('/api/handovers'),api('/api/users').catch(()=>[]),api('/api/tanks').catch(()=>[])]);
    const names=Object.fromEntries(emps.map(e=>[e.id,e.name]));
    const pending=hs.filter(x=>x.status==='pending');window.pendingHandoverTanks=Object.fromEntries(pending.map(x=>[String(x.id),tanks.find(t=>String(t.id)===String(x.source_tank_id))]).filter(x=>x[1]));
    document.getElementById('pending-list').innerHTML=pending.length?pending.map(x=>`<div class="card"><h3>Handover ${h(x.id.slice(0,8))}</h3><p>From: <b>${h(names[x.from_employee_id]||x.from_employee_id)}</b><br>To: <b>${h(names[x.to_employee_id]||x.to_employee_id)}</b></p><p>Closing meter: ${liters(x.closing_reading)} • Tank: ${liters(x.closing_liters)} L</p><form class="form" onsubmit="confirmHandover(event,'${x.id}')"><input id="confirm-reading-${x.id}" type="number" min="0" step="0.01" placeholder="Opening meter" required><input id="confirm-mm-${x.id}" type="number" min="0" step="0.1" placeholder="Tank opening dip (mm)" oninput="updatePendingHandoverDip(&quot;${x.id}&quot;,this.value)" required><div id="confirm-liters-${x.id}" class="muted">Enter a dip to see liters.</div><button class="primary">Confirm & Start Shift</button></form></div>`).join(''):'<div class="card"><p>No pending handovers.</p></div>';
  }catch(e){document.getElementById('pending-list').textContent=e.message;}
}
function updatePendingHandoverDip(id,value){setTankDipEquivalent(window.pendingHandoverTanks?.[String(id)],Number(value),'confirm-liters-'+id);}
async function confirmHandover(e,id){e.preventDefault();try{const mm=Number(document.getElementById('confirm-mm-'+id).value),tank=window.pendingHandoverTanks?.[String(id)],litersValue=tankLitersFromDip(tank,mm);if(!Number.isFinite(litersValue)){toast('Enter a valid tank opening dip and ensure calibration is set.');return;}await api('/api/handovers/'+id+'/confirm',{method:'POST',body:JSON.stringify({opening_reading:Number(document.getElementById('confirm-reading-'+id).value),opening_mm:mm,opening_liters:litersValue,pin:document.getElementById('confirm-pin-'+id).value})});toast('Handover confirmed');setTimeout(()=>location.href='attendant-dashboard.html',700);}catch(x){toast(x.message);}}

async function loadPurchases(){
  const statusEl=document.getElementById('purchase-status');
  try{
    await window.stationCurrencyReady;
    const [tanks,purchases,products]=await Promise.all([
      api('/api/tanks'),
      api('/api/purchases'),
      api('/api/products')
    ]);
    const activeTanks=(Array.isArray(tanks)?tanks:[]).filter(t=>t.active!==false);
    const activeProducts=(Array.isArray(products)?products:[]).filter(p=>p.active!==false);
    const productByName=Object.fromEntries(activeProducts.map(p=>[String(p.name).trim().toLowerCase(),p]));
    const codeForProduct=p=>productByName[String(p||'').trim().toLowerCase()]?.code_name||p;
    const colorForProduct=p=>productByName[String(p||'').trim().toLowerCase()]?.color||'#98A2B3';
    const tankById=Object.fromEntries(activeTanks.map(t=>[String(t.id),t]));
    const ts=document.getElementById('purchase-tank');
    const ps=document.getElementById('purchase-product');

    if(ts){
      ts.innerHTML='<option value="">Select tank</option>'+
        activeTanks.map(t=>'<option value="'+h(t.id)+'">'+h(t.tank_code)+' — '+h(codeForProduct(t.product))+'</option>').join('');
    }
    if(ps){
      ps.innerHTML='<option value="">Select product</option>'+
        activeProducts.map(p=>'<option value="'+h(p.name)+'">'+h(p.code_name||p.name)+'</option>').join('');
    }

    if(ts)ts.onchange=()=>{
      const tank=tankById[String(ts.value)];
      if(tank&&ps)ps.value=tank.product||'';
    };
    if(ps)ps.onchange=()=>{
      const product=String(ps.value||'').trim().toLowerCase();
      const tank=tankById[String(ts?.value||'')];
      if(tank&&String(tank.product||'').trim().toLowerCase()!==product){
        if(ts)ts.value='';
      }
    };

    if(statusEl)statusEl.textContent='';

    const list=document.getElementById('purchase-list');
    const rows=Array.isArray(purchases)?purchases:[];
    if(list){
      list.innerHTML=rows.length
        ?rows.map(p=>{
          const t=tankById[String(p.tank_id)];
          return '<div class="purchase-card">'+
            '<div class="purchase-card-top">'+
              '<div class="purchase-product-name"><span style="display:inline-block;width:9px;height:9px;border-radius:50%;background:'+h(colorForProduct(p.product))+';margin-right:6px"></span>'+h(codeForProduct(p.product))+'</div>'+
              '<div class="purchase-quantity">'+liters(p.quantity_liters)+' L</div>'+
            '</div>'+
            '<div class="purchase-card-meta">'+
              '<span>Tank: <b>'+h(t?.tank_code||'—')+'</b></span>'+
              '<span>Attendant: <b>'+h(p.attendant?.name||'No ongoing shift')+'</b></span>'+
              '<span>Shift: '+h(p.shift?.id?p.shift.id.slice(0,8):'—')+'</span>'+
              '<span>Supplier: '+h(p.supplier||'Not provided')+'</span>'+
              '<span>Invoice: '+h(p.invoice_number||'Not provided')+'</span>'+
              '<span>'+new Date(p.purchase_date).toLocaleString()+'</span>'+
            '</div>'+
          '</div>';
        }).join('')
        :'<div class="purchase-empty">No purchases recorded yet.</div>';
    }
  }catch(e){
    if(statusEl)statusEl.textContent=e.message||'Unable to load purchase data';
    const list=document.getElementById('purchase-list');
    if(list)list.innerHTML='<div class="purchase-empty">Unable to load purchase history.</div>';
  }
}
async function createPurchase(e){
  e.preventDefault();
  const tank=document.getElementById('purchase-tank')?.value||'',
        product=document.getElementById('purchase-product')?.value||'',
        q=Number(document.getElementById('purchase-liters')?.value),
        supplier=document.getElementById('purchase-supplier')?.value.trim()||'',
        invoice=document.getElementById('purchase-invoice')?.value.trim()||'';
  if(!tank||!product||!Number.isFinite(q)||q<=0){
    toast('Select a tank and product and enter a valid quantity');
    return;
  }
  const selectedTank=[...document.getElementById('purchase-tank').options]
    .find(o=>String(o.value)===String(tank));
  const tankProduct=selectedTank?.textContent?.split('—').slice(1).join('—').trim()||'';
  const selectedProduct=document.getElementById('purchase-product').selectedOptions[0]?.textContent?.trim()||'';
  if(tankProduct&&selectedProduct&&tankProduct!==selectedProduct){
    toast('The selected product does not match the selected tank');
    return;
  }
  try{
    await api('/api/purchases',{
      method:'POST',
      body:JSON.stringify({
        product,
        tank_id:tank,
        quantity_liters:q,
        supplier,
        invoice_number:invoice
      })
    });
    e.target.reset();
    toast('Purchase recorded and tank updated');
    await loadPurchases();
  }catch(x){
    toast(x.message);
  }
}
function dailyReportDateLabel(value){
  if(!value)return 'Selected day';
  const d=new Date(value+'T00:00:00');
  return Number.isNaN(d.getTime())?value:d.toLocaleDateString(undefined,{weekday:'long',year:'numeric',month:'long',day:'numeric'});
}
function dailyReportIdLabel(value){
  if(!value)return 'DSR';
  const d=new Date(value+'T00:00:00');
  return Number.isNaN(d.getTime())?String(value)+' DSR':d.toLocaleDateString(undefined,{month:'short',day:'numeric',year:'numeric'})+' DSR';
}
function dailyReportIdFromTimestamp(value){
  if(!value)return 'DSR';
  const d=new Date(value);
  if(Number.isNaN(d.getTime()))return dailyReportIdLabel(String(value).slice(0,10));
  const localDate=new Intl.DateTimeFormat('en-CA',{timeZone:'Africa/Addis_Ababa',year:'numeric',month:'2-digit',day:'2-digit'}).format(d);
  return dailyReportIdLabel(localDate);
}
function updateDailyDsrConfirmButton(card){
  if(!card)return;
  const checks=Array.from(card.querySelectorAll('.daily-dsr-method-check'));
  const selectAll=card.querySelector('.daily-dsr-select-all');
  const button=card.querySelector('[data-confirm-dsr]');
  const ready=checks.length>0&&checks.every(x=>x.checked);
  if(selectAll){
    selectAll.checked=ready;
    selectAll.indeterminate=checks.some(x=>x.checked)&&!ready;
  }
  if(button)button.disabled=checks.length===0||!ready;
}
function bindDailyDsrChecks(){
  document.querySelectorAll('.daily-confirm-card').forEach(card=>{
    const checks=Array.from(card.querySelectorAll('.daily-dsr-method-check'));
    checks.forEach(check=>check.addEventListener('change',()=>updateDailyDsrConfirmButton(card)));
    const selectAll=card.querySelector('.daily-dsr-select-all');
    if(selectAll){
      selectAll.addEventListener('change',()=>{
        checks.forEach(check=>{ if(!check.disabled)check.checked=selectAll.checked; });
        updateDailyDsrConfirmButton(card);
      });
    }
    updateDailyDsrConfirmButton(card);
  });
}
function dailyReportTime(value){
  if(!value)return '—';
  const d=new Date(value);
  return Number.isNaN(d.getTime())?String(value):d.toLocaleTimeString(undefined,{hour:'2-digit',minute:'2-digit'});
}
function dailyReportVarianceClass(value){
  const n=Number(value||0);
  return Math.abs(n)<0.0001?'ok':(n>0?'positive':'negative');
}
async function loadDailyReportConfirmations(){
  const pendingEl=document.getElementById('daily-report-pending-confirmations');
  const dateEl=document.getElementById('daily-report-date-cards');
  try{
    const cards=await api('/api/reports/daily/confirmations');
    const rows=Array.isArray(cards)?cards:[];
    const active=rows.filter(x=>x.status==='pending'||x.status==='waiting');
    const history=rows.filter(x=>x.status==='confirmed');
    if(pendingEl){
      pendingEl.innerHTML=active.length
        ?active.map(renderDailyPendingConfirmationCard).join('')
        :'<div class="daily-empty">No DSRs are currently waiting for completion or confirmation.</div>';
      bindDailyDsrChecks();
    }
    if(dateEl){
      // Paint the interactive confirmation card first. History is intentionally
      // deferred one frame so a reload becomes responsive before the larger
      // history DOM is built.
      const renderHistory=()=>{
        if(!dateEl.isConnected)return;
        dateEl.innerHTML=history.length
          ?history.map(renderDailyHistoryCard).join('')
          :'<div class="daily-empty daily-dsr-empty"><div>No confirmed DSR history yet.</div><button type="button" class="daily-dsr-preview-btn" onclick="previewDailyReport()">Preview current DSR design</button><small>This preview uses current report data only and does not confirm or change the DSR.</small></div>';
      };
      if(typeof requestAnimationFrame==='function'){
        requestAnimationFrame(()=>requestAnimationFrame(renderHistory));
      }else{
        setTimeout(renderHistory,0);
      }
    }
    return rows;
  }catch(e){
    console.error('DSR confirmation load failed',e);
    if(pendingEl)pendingEl.innerHTML='<div class="daily-empty">Could not load DSR cards: '+h(e.message||'Unknown error')+'</div>';
    if(dateEl)dateEl.innerHTML='<div class="daily-empty">Could not load DSR history: '+h(e.message||'Unknown error')+'</div>';
    return [];
  }
}
async function previewDailyReport(selectedDate=null){
  try{
    let date=selectedDate;
    if(!date){
      const rows=await api('/api/reports/daily/confirmations');
      const list=Array.isArray(rows)?rows:[];
      const available=list
        .filter(x=>x && x.date)
        .sort((a,b)=>String(b.date).localeCompare(String(a.date)));
      if(!available.length){
        toast('No DSR data is available for preview yet.');
        return;
      }
      date=available[0].date;
    }

    // History reports must open the modal immediately. The modal itself
    // shows the loading state while the authoritative DSR is fetched.
    return openDailyHistoryReport(date);
  }catch(e){
    console.error('DSR preview failed',e);
    toast('Could not load DSR preview: '+String(e.message||'Request failed'));
  }
}
function closeDailyDsrPreview(){
  const modal=document.getElementById('daily-dsr-preview-modal');
  if(modal){
    modal.classList.remove('open');
    modal.setAttribute('aria-hidden','true');
  }
  document.body.classList.remove('daily-preview-open');
}
function renderDailyPreviewHistoryCard(item){
  const dateLabel=dailyReportIdLabel(item.date);
  return '<article class="dsr-history-card" data-dsr-date="'+h(item.date)+'">'+
    '<button type="button" class="dsr-history-card-head" onclick="toggleDailyHistoryCard(event,this)" aria-expanded="false"><span class="dsr-history-card-title"><strong>'+h(dateLabel)+'</strong><small>DSR preview · not confirmed</small></span><span class="dsr-history-card-right"><span class="dsr-history-badge">PREVIEW</span><span class="dsr-history-toggle">⌄</span></span></button>'+
    '<div class="dsr-history-card-body" hidden><div class="dsr-history-stats"><div class="dsr-history-stat"><span>Fuel sold</span><strong>'+liters(item.total_sales_liters)+' L</strong></div><div class="dsr-history-stat"><span>Total sales</span><strong>'+money(item.total_sales_amount)+'</strong></div><div class="dsr-history-stat"><span>Shifts</span><strong>'+Number(item.shift_count||0)+'</strong></div><div class="dsr-history-stat"><span>Dispensers</span><strong>'+Number(item.dispenser_count||0)+'</strong></div></div><div class="dsr-history-actions" style="display:flex;justify-content:flex-end;margin-top:10px"><button type="button" class="primary dsr-history-report-button" style="width:50%;min-height:38px;display:inline-flex;align-items:center;justify-content:center;box-sizing:border-box;padding:0 12px;border:1px solid #4b83bd;border-radius:9px;background:#4b83bd;color:#fff;box-shadow:0 3px 9px rgba(75,131,189,.16);font:inherit;font-size:12px;font-weight:800;cursor:pointer" onclick="previewDailyReport(this.closest(\'.dsr-history-card\').dataset.dsrDate)">View Full Report</button></div></div></article>';
}
function renderDsrHistoryCard(item){
  const date=String(item?.date||'');
  const confirmedAt=item?.confirmed_at ? new Date(item.confirmed_at).toLocaleString() : 'Confirmed';
  const dateLabel=dailyReportIdLabel(date);
  return '<article class="dsr-history-card" data-dsr-date="'+h(date)+'">'+
    '<button type="button" class="dsr-history-card-head" onclick="toggleDsrCardFromShared(this)" aria-expanded="false"><span class="dsr-history-card-title"><strong>'+h(dateLabel)+'</strong><small>Confirmed '+h(confirmedAt)+'</small></span><span class="dsr-history-card-right"><span class="dsr-history-badge">✓ CONFIRMED</span><span class="dsr-history-toggle">⌄</span></span></button>'+
    '<div class="dsr-history-card-body" hidden><div class="dsr-history-stats"><div class="dsr-history-stat"><span>Fuel sold</span><strong>'+liters(item.total_sales_liters)+' L</strong></div><div class="dsr-history-stat"><span>Total sales</span><strong>'+money(item.total_sales_amount)+'</strong></div><div class="dsr-history-stat"><span>Shifts</span><strong>'+Number(item.shift_count||0)+'</strong></div><div class="dsr-history-stat"><span>Dispensers</span><strong>'+Number(item.dispenser_count||0)+'</strong></div></div><div class="dsr-history-actions" style="display:flex;justify-content:flex-end;margin-top:10px"><a class="primary dsr-history-report-button" style="width:50%;min-height:38px;display:inline-flex;align-items:center;justify-content:center;box-sizing:border-box;padding:0 12px;border:1px solid #4b83bd;border-radius:9px;background:#4b83bd;color:#fff;box-shadow:0 3px 9px rgba(75,131,189,.16);font:inherit;font-size:12px;font-weight:800;text-decoration:none;cursor:pointer" href="admin-dsr-detail.html?date='+encodeURIComponent(date)+'" onclick="if(typeof window.openDsrDetailPopup===\'function\'){window.openDsrDetailPopup('+JSON.stringify(date)+');return false;}">View Full Report</a></div></div></article>';
}
function openDsrDetailPopup(date){
  if(!date)return;
  let modal=document.getElementById('dsr-detail-popup');
  if(!modal){
    modal=document.createElement('div');
    modal.id='dsr-detail-popup';
    modal.className='dsr-detail-popup';
    modal.innerHTML='<div class="dsr-detail-popup-backdrop" onclick="closeDsrDetailPopup()"></div><div class="dsr-detail-popup-card" role="dialog" aria-modal="true" aria-label="DSR Detail"><button type="button" class="dsr-detail-popup-close" onclick="closeDsrDetailPopup()" aria-label="Close">×</button><iframe id="dsr-detail-popup-frame" title="DSR Detail" loading="eager"></iframe></div>';
    document.body.appendChild(modal);
  }
  const frame=document.getElementById('dsr-detail-popup-frame');
  if(frame)frame.src='admin-dsr-detail.html?embedded=1&date='+encodeURIComponent(date);
  modal.classList.add('open');
  document.body.classList.add('dsr-detail-popup-open');
}
function closeDsrDetailPopup(){
  const modal=document.getElementById('dsr-detail-popup');
  if(!modal)return;
  modal.classList.remove('open');
  document.body.classList.remove('dsr-detail-popup-open');
  const frame=document.getElementById('dsr-detail-popup-frame');
  if(frame)frame.src='about:blank';
}
window.openDsrDetailPopup=openDsrDetailPopup;
window.closeDsrDetailPopup=closeDsrDetailPopup;

function toggleDsrCardFromShared(button){
  const card=button?.closest('.dsr-history-card');
  if(!card)return;
  const expanded=card.classList.toggle('expanded');
  const body=card.querySelector('.dsr-history-card-body');
  const toggle=card.querySelector('.dsr-history-toggle');
  if(body)body.hidden=!expanded;
  button.setAttribute('aria-expanded',expanded?'true':'false');
  if(toggle)toggle.textContent=expanded?'⌃':'⌄';
}
function renderDailyHistoryCard(item){ return renderDsrHistoryCard(item); }
function renderDailyPendingConfirmationCard(item){
  const waiting=item.status==='waiting';
  const methodEntries=Object.entries(item.sales_by_method||{}).sort((a,b)=>Number(b[1])-Number(a[1]));
  const methods=methodEntries.map(([method,amount])=>
    '<label class="admin-sale-check-row daily-dsr-method-row"><input type="checkbox" class="daily-dsr-method-check" '+(waiting?'disabled':'')+'><span><strong>'+h(method)+'</strong><small>Recorded for '+h(dailyReportIdLabel(item.date))+'</small></span><strong>'+money(amount)+'</strong></label>'
  ).join('');
  const methodCount=methodEntries.length;
  const methodControls=methodCount&&!waiting
    ?'<label class="daily-dsr-select-all-row"><input type="checkbox" class="daily-dsr-select-all"><span><strong>Select all sales</strong><small>Mark every recorded payment method as checked</small></span><em>'+methodCount+' method'+(methodCount===1?'':'s')+'</em></label>'
    :'';
  const missing=[];
  if(!item.all_shifts_complete)missing.push('Shift completion is still pending');
  if(!item.all_handover_recorded){
    if(Array.isArray(item.duplicate_handover_shifts)&&item.duplicate_handover_shifts.length){
      missing.push(item.duplicate_handover_shifts.length+' shift(s) have duplicate handover records');
    }else if(Array.isArray(item.missing_handover_shifts)&&item.missing_handover_shifts.length){
      missing.push(item.missing_handover_shifts.length+' shift(s) still need a handover');
    }else{
      missing.push('Handover completion is still pending');
    }
  }
  if(!item.all_sales_recorded){
    if(Array.isArray(item.missing_sales_shifts)&&item.missing_sales_shifts.length){
      missing.push(item.missing_sales_shifts.length+' shift(s) have no recorded sales');
    }else if(Array.isArray(item.unsubmitted_sales_shifts)&&item.unsubmitted_sales_shifts.length){
      missing.push(item.unsubmitted_sales_shifts.length+' shift(s) have sales not submitted');
    }else{
      missing.push('Sales recording is still pending');
    }
  }
  const readiness=waiting
    ?'<div class="daily-dsr-readiness"><div class="daily-confirm-label">Completion required</div>'+missing.map(x=>'<div class="daily-dsr-readiness-row"><span>•</span><strong>'+h(x)+'</strong></div>').join('')+'</div>'
    :'';
  return '<article class="card daily-confirm-card '+(waiting?'is-waiting':'')+'" data-report-date="'+h(item.date)+'" data-dsr-id="'+h(dailyReportIdLabel(item.date))+'">'+
    '<div class="daily-confirm-head"><div><span class="section-kicker">'+(waiting?'DSR NOT READY':'DSR READY FOR CONFIRMATION')+'</span><h3>'+h(dailyReportIdLabel(item.date))+'</h3><p class="muted">'+Number(item.dispenser_count||0)+' dispenser(s) • '+Number(item.shift_count||0)+' shift(s)</p></div><span class="pending-sale-badge">'+(waiting?'Waiting':'Pending')+'</span></div>'+
    '<div class="daily-confirm-summary"><div><span>Fuel sold</span><strong>'+liters(item.total_sales_liters)+' L</strong></div><div><span>Total sales</span><strong>'+money(item.total_sales_amount)+'</strong></div></div>'+
    readiness+
    '<div class="daily-confirm-methods"><div class="daily-confirm-label"><span>Sales awaiting confirmation</span><small>'+(waiting?'Sales will appear after recording is complete.':methodCount+' payment method'+(methodCount===1?'':'s')+' recorded')+'</small></div>'+methodControls+(methods||'<div class="daily-empty">'+(waiting?'Sales will appear here after they are recorded.':'No recorded sale methods.')+'</div>')+'</div>'+
    '<div class="daily-confirm-note">'+(waiting?'This report is not ready yet. Complete all shifts, record the required handovers, and finish sales recording before confirmation.':'Review each recorded sales method, then confirm the DSR. Confirmation finalizes the linked shift sales for this report date.')+'</div>'+
    '<div class="row daily-confirm-actions"><button type="button" '+(waiting?'disabled':'')+' onclick="selectDailyReportDate(\''+item.date+'\')">Review DSR</button><button type="button" class="primary" '+(waiting?'disabled ':'')+'disabled data-confirm-dsr="'+h(item.date)+'" onclick="confirmDailyReport(\''+item.date+'\')">Confirm DSR</button></div>'+
  '</article>';
}
async function confirmDailyReport(reportDate){
  try{
    if(!reportDate)return;
    await api('/api/reports/daily/confirmations/'+encodeURIComponent(reportDate)+'/confirm',{method:'POST',body:'{}'});
    toast('Daily sales confirmed and report finalized');
    await loadDailyReportConfirmations();
    const input=document.getElementById('report-date');
    if(input)input.value=reportDate;
    await loadDailyReport();
  }catch(e){toast(e.message);}
}
async function loadDailyReportDates(){
  return loadDailyReportConfirmations();
}

function toggleDailyHistoryCard(event,button){
  if(event)event.stopPropagation();
  const card=button&&button.closest('.daily-dsr-history-card,.dsr-history-card');
  if(!card)return;
  const expanded=card.classList.toggle('expanded');
  const body=card.querySelector('.daily-dsr-history-body,.dsr-history-card-body');
  const toggle=card.querySelector('.daily-dsr-history-toggle,.dsr-history-toggle');
  const head=card.querySelector('.daily-dsr-history-head,.dsr-history-card-head');
  if(body)body.hidden=!expanded;
  if(head)head.setAttribute('aria-expanded',expanded?'true':'false');
  if(toggle)toggle.textContent=expanded?'⌃':'⌄';
}
function closeDailyReportDetail(){
  const details=document.getElementById('daily-report-details');
  if(details)details.hidden=true;
  document.body.classList.remove('daily-detail-open');
  window.scrollTo({top:0,behavior:'smooth'});
}
document.addEventListener('keydown',event=>{
  if(event.key==='Escape')closeDailyDsrPreview();
});
function openDailyHistoryReport(date){
  if(!date)return;
  window.location.href='admin-dsr-detail.html?date='+encodeURIComponent(date);
}

function selectDailyReportDate(date){
  openDailyHistoryReport(date);
}

function downloadDailyReportPdf(){
  const r=window.currentDailyReportData;
  const d=window.currentDailyReportDate||document.getElementById('report-date')?.value;
  if(!r){toast('Open a DSR detail page first.');return;}

  const pdfSafe=s=>String(s??'')
    .replace(/â¢|â€¢|•/g,' - ')
    .replace(/â|–|—/g,'-').replace(/â|→/g,'->').replace(/â|−/g,'-')
    .replace(/Â/g,'').replace(/â|“/g,'"').replace(/â|”/g,'"')
    .replace(/â|’/g,"'").replace(/Ã©|é/g,'e').replace(/Ã¨|è/g,'e')
    .replace(/Ã|à/g,'a').replace(/[^\x00-\xFF]/g,'?');
  const escPdf=s=>pdfSafe(s).replace(/\\/g,'\\\\').replace(/\(/g,'\\(').replace(/\)/g,'\\)');
  const num=v=>Number.isFinite(Number(v))?Number(v):0;
  const pct=v=>Number.isFinite(Number(v))?Number(v).toFixed(1)+'%':'-';
  const fmtL=v=>liters(num(v))+' L';
  const fmtM=v=>money(num(v));
  const signedL=v=>(num(v)>=0?'+':'')+fmtL(v);
  const perf=r.dsr_performance||{}, summary=r.summary||{}, sales=r.dsr_sales_summary||{};
  const dispensers=Array.isArray(r.dsr_dispenser_details)?r.dsr_dispenser_details:[];
  const tanks=Array.isArray(r.dsr_tank_details)?r.dsr_tank_details:[];
  const shifts=Array.isArray(r.shift_summary)?r.shift_summary:[];
  const methods=Array.isArray(sales.by_type)?sales.by_type:[];
  const products=Array.isArray(sales.by_product)?sales.by_product:[];
  const productInfo=window.currentDsrProductInfo||{};
  const productFor=p=>productInfo[String(p||'').toLowerCase()]||{code:p||'Unknown',name:p||'Unknown',color:''};
  const hexRgb=hex=>{
    const m=String(hex||'').replace('#','').match(/^[0-9a-fA-F]{6}$/);
    if(!m)return null;
    return [parseInt(m[0].slice(0,2),16)/255,parseInt(m[0].slice(2,4),16)/255,parseInt(m[0].slice(4,6),16)/255];
  };

  const W=595,H=842,margin=38,contentW=W-margin*2;
  const pages=[];let page=[],y=H-48,pageNo=0;
  const newPage=()=>{if(page.length)pages.push(page);page=[];y=H-48;pageNo++;};
  const finish=()=>{if(page.length)pages.push(page);};
  const line=yy=>page.push('0.6 w 0.84 0.87 0.91 RG '+margin+' '+yy+' m '+(W-margin)+' '+yy+' l S');
  const rect=(x,yy,w,h,fill='0.97 0.98 1')=>{
    page.push(fill+' rg '+x+' '+yy+' '+w+' '+h+' re f');
    page.push('0.65 w 0.82 0.86 0.91 RG '+x+' '+yy+' '+w+' '+h+' re S');
  };
  const text=(x,yy,s,size=8,bold=false,fill='0.12 0.17 0.23')=>{
    page.push('BT /'+(bold?'F2':'F1')+' '+size+' Tf '+fill+' rg '+x+' '+yy+' Td ('+escPdf(s)+') Tj ET');
  };
  const ensure=h=>{if(y-h<62)newPage();};
  const footer=()=>{
    line(39);
    text(margin,25,'DSR - '+dailyReportIdLabel(d),6,false,'0.48 0.52 0.58');
    text(W-margin-48,25,'Page '+pageNo,6,false,'0.48 0.52 0.58');
  };
  const header=(continued=false)=>{
    text(margin,y,continued?'DAILY SALES REPORT - CONTINUED':'DAILY SALES REPORT',20,true);
    y-=19;
    text(margin,y,'STATION DAILY RECONCILIATION',7,true,'0.07 0.39 0.82');
    if(!continued){
      y-=13;
      text(margin,y,'DSR - '+dailyReportIdLabel(d),9,false,'0.38 0.43 0.50');
      const status=r.report_ready?'CONFIRMED':'PENDING';
      text(W-margin-(status.length*4.1),y,status,7,true,r.report_ready?'0.05 0.48 0.28':'0.58 0.40 0.02');
    }
    y-=12;line(y);y-=16;
  };
  const section=title=>{
    ensure(31);y-=2;text(margin,y,title.toUpperCase(),10,true,'0.13 0.20 0.29');y-=7;line(y);y-=13;
  };
  const kv=(label,value)=>{
    ensure(18);text(margin,y,label,7.5,false,'0.40 0.45 0.51');text(margin+178,y,value,8,true);y-=16;
  };
  const tableHeader=(cols,widths)=>{
    const h=20;ensure(h+34);
    rect(margin,y-h,contentW,h,'0.10 0.25 0.40');
    let x=margin+8;
    cols.forEach((c,i)=>{text(x,y-13,c,6.3,true,'1 1 1');x+=widths[i];});
    y-=h+7;
  };
  const colorDot=(x,yy,hex,size=7)=>{
    const rgb=hexRgb(hex);
    if(rgb)page.push(rgb[0]+' '+rgb[1]+' '+rgb[2]+' rg '+x+' '+(yy-size/2)+' '+size+' '+size+' re f');
  };

  // PAGE 1: overview + core reconciliation
  newPage();header();

  const kpis=[
    ['FUEL SOLD',fmtL(perf.total_sales_liters??summary.sales_liters),'0.90 0.96 1.00'],
    ['TOTAL SALES',fmtM(perf.total_sales_amount??summary.sales_amount),'0.95 0.97 1.00'],
    ['SHIFTS',String(num(perf.shift_count)),'0.96 0.98 0.99'],
    ['DISPENSERS',String(num(perf.dispenser_count)),'0.96 0.98 0.99'],
    ['TANKS',String(num(perf.tank_count)),'0.96 0.98 0.99']
  ];
  const kw=(contentW-12)/2;
  kpis.forEach((k,i)=>{
    const row=Math.floor(i/2),col=i%2,xx=margin+col*(kw+12),yy=y-row*50;
    rect(xx,yy-37,kw,41,k[2]);
    text(xx+10,yy-11,k[0],6.5,true,'0.39 0.45 0.52');
    text(xx+10,yy-29,k[1],13,true,'0.08 0.38 0.76');
  });
  y-=Math.ceil(kpis.length/2)*50+3;

  section('Reconciliation overview');
  const avgNozzle=num(perf.average_nozzle_reconciliation_pct);
  const meterDiff=num(perf.sales_amount_difference);
  const tankDiff=num(perf.tank_difference_liters);
  const avgL=num(perf.average_liters_per_shift);
  const avgSales=num(perf.average_sales_per_shift);
  const calculatedSales=num(perf.calculated_sales_amount);
  [
    ['Avg. liters / shift',fmtL(avgL)],['Avg. sales / shift',fmtM(avgSales)],
    ['Meter-calculated sales',fmtM(calculatedSales)],['Recorded vs meter',fmtM(meterDiff)],
    ['Avg. nozzle reconciliation',pct(avgNozzle)],['Total tank difference',signedL(tankDiff)]
  ].forEach((s,i)=>{
    const col=i%2,row=Math.floor(i/2),xx=margin+col*(contentW/2),yy=y-row*26;
    text(xx,yy,s[0],7,false,'0.43 0.48 0.54');text(xx+136,yy,s[1],8,true);
  });
  y-=78;

  section('Performance statistics');
  const topDisp=[...dispensers].sort((a,b)=>num(b.sales_liters)-num(a.sales_liters))[0];
  const topProduct=[...products].sort((a,b)=>num(b.amount)-num(a.amount))[0];
  [
    ['Top dispenser',topDisp?.dispenser||'-',topDisp?fmtL(topDisp.sales_liters):'-'],
    ['Top product',topProduct?.product||'-',topProduct?fmtL(topProduct.liters):'-'],
    ['Average nozzle reconciliation',pct(avgNozzle),''],
    ['Nozzle count',String(num(perf.nozzle_count)),''],
    ['Attendants',String(num(perf.attendant_count)),'']
  ].forEach(row=>{
    ensure(17);text(margin,y,row[0],7.5,false,'0.40 0.45 0.51');text(margin+170,y,pdfSafe(row[1]),8,true);text(margin+430,y,row[2],8,true);y-=16;
  });

  section('Dispenser and nozzle performance');
  tableHeader(['DISPENSER / NOZZLE','OPENING','CLOSING','SOLD','METER','RECON.'],[145,65,65,65,65,55]);
  dispensers.forEach(disp=>{
    (disp.nozzles||[]).forEach(n=>{
      ensure(30);
      const yy=y,pc=productFor(n.product);
      colorDot(margin+8,yy-4,pc.color,7);
      const nozzleLabel=n.nozzle_code&&String(n.nozzle_code).toLowerCase()!==String(disp.dispenser||'').toLowerCase()
        ? n.nozzle_code : 'N'+(n.nozzle_number||1);
      text(margin+19,yy,pdfSafe((disp.dispenser||'Dispenser')+' / '+nozzleLabel),7.1,true);
      text(margin+19,yy-10,pdfSafe(pc.code||pc.name||'Unknown'),5.9,false,'0.38 0.43 0.50');
      text(margin+153,yy,reading(n.opening_reading),7.1);
      text(margin+218,yy,reading(n.closing_reading),7.1);
      text(margin+283,yy,fmtL(n.sales_liters),7.1);
      text(margin+348,yy,fmtL(n.meter_delta_liters),7.1);
      text(margin+413,yy,pct(n.meter_reconciliation_pct),7.1,true);
      y-=27;
    });
  });

  section('Tank reconciliation');
  tableHeader(['TANK / PRODUCT','OPENING','PURCHASES','SOLD','EXPECTED','RECORDED'],[150,68,68,65,70,65]);
  tanks.forEach(t=>{
    ensure(42);
    const yy=y,pc=productFor(t.product);
    colorDot(margin+8,yy-4,pc.color,7);
    text(margin+19,yy,pdfSafe((t.tank||'Tank')+' / '+(pc.code||t.product||'')),7.1,true);
    text(margin+19,yy-10,pdfSafe(pc.name||''),5.9,false,'0.38 0.43 0.50');
    text(margin+158,yy,fmtL(t.opening_stock_liters),7.1);
    text(margin+226,yy,'+'+fmtL(t.purchase_discharged_liters),7.1);
    text(margin+294,yy,fmtL(t.nozzle_sales_liters),7.1);
    text(margin+359,yy,fmtL(t.expected_closing_liters),7.1);
    text(margin+429,yy,fmtL(t.closing_stock_liters),7.1,true);
    text(margin+19,yy-22,'Adjustment '+signedL(t.documented_stock_adjustment_liters)+'  |  Continuity '+signedL(t.opening_adjustment_liters)+'  |  Difference '+signedL(t.difference_liters)+'  |  Variance '+pct(t.variance_pct),6.6,false,'0.40 0.45 0.51');
    y-=35;
  });

  // PAGE 2: sales, shifts, final performance
  newPage();header(true);
  section('Sales statistics');
  if(products.length){
    text(margin,y,'BY PRODUCT',7,true,'0.07 0.39 0.82');y-=13;
    products.forEach(x=>{
      ensure(18);
      const pc=productFor(x.product);
      colorDot(margin+3,y-3,pc.color,7);
      text(margin+14,y,pdfSafe(pc.code||x.product||'Product'),7.5);
      text(margin+245,y,fmtL(x.liters),7.5);
      text(margin+350,y,fmtM(x.amount),7.5,true);
      text(margin+470,y,pct(x.percentage),7.5,true);
      y-=16;
    });
  }else{
    text(margin,y,'No product sales recorded for this DSR.',7.5,false,'0.45 0.50 0.56');y-=17;
  }
  y-=3;
  if(methods.length){
    text(margin,y,'BY SALES METHOD',7,true,'0.07 0.39 0.82');y-=13;
    methods.forEach(x=>{
      ensure(18);text(margin,y,pdfSafe(x.type||'Method'),7.5);
      text(margin+350,y,fmtM(x.amount),7.5,true);
      text(margin+470,y,pct(x.percentage),7.5,true);y-=16;
    });
  }else{
    text(margin,y,'No payment-method sales recorded for this DSR.',7.5,false,'0.45 0.50 0.56');y-=17;
  }
  y-=2;line(y);y-=14;
  kv('Sales total',fmtM(sales.total_amount??perf.total_sales_amount));
  kv('Liters total',fmtL(sales.total_liters??perf.total_sales_liters));

  section('Shift summary');
  shifts.forEach((s,i)=>{
    ensure(57);
    rect(margin,y-48,contentW,52,'0.97 0.98 0.99');
    text(margin+10,y-12,'SHIFT '+(i+1)+' - '+pdfSafe(s.attendant||s.employee_name||'Unknown'),8.5,true);
    const pc=productFor(s.product);
    colorDot(margin+10,y-27,pc.color,7);
    text(margin+20,y-25,pdfSafe((s.dispenser||'-')+' / '+(pc.code||s.product||'')),7.2,false,'0.40 0.45 0.51');
    text(margin+10,y-39,'Start '+dailyReportTime(s.started_at||s.start_time)+'  End '+dailyReportTime(s.ended_at||s.end_time),7.1);
    text(margin+310,y-25,'Sold '+fmtL(s.sales_liters||s.total_sales_liters),7.2,true);
    text(margin+310,y-39,'Sales '+fmtM(s.sales_amount||s.total_sales_amount),7.2,true);
    y-=62;
  });

  section('Final daily performance');
  const finalRows=[
    ['Report status',r.report_ready?'CONFIRMED':'PENDING'],
    ['Fuel sold',fmtL(perf.total_sales_liters)],
    ['Total sales',fmtM(perf.total_sales_amount)],
    ['Calculated sales',fmtM(perf.calculated_sales_amount)],
    ['Sales amount difference',fmtM(perf.sales_amount_difference)],
    ['Average nozzle reconciliation',pct(perf.average_nozzle_reconciliation_pct)],
    ['Tank difference',signedL(perf.tank_difference_liters)],
    ['Shifts / attendants',num(perf.shift_count)+' / '+num(perf.attendant_count)],
    ['Dispensers / nozzles',num(perf.dispenser_count)+' / '+num(perf.nozzle_count)]
  ];
  finalRows.forEach((row,i)=>{
    ensure(18);
    const bg=i%2===0?'0.97 0.98 0.99':'1 1 1';
    rect(margin,y-14,contentW,18,bg);
    text(margin+8,y-11,row[0],7.4,false,'0.40 0.45 0.51');
    text(margin+300,y-11,row[1],8,true);
    y-=21;
  });

  finish();
  pages.forEach((p,i)=>{page=p;pageNo=i+1;footer();});

  const objects=[],add=s=>{objects.push(s);return objects.length};
  const font1=add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
  const font2=add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');
  const contentIds=pages.map(p=>add('<< /Length '+p.join('\n').length+' >>\nstream\n'+p.join('\n')+'\nendstream'));
  const pagesId=add('<< /Type /Pages /Kids [] /Count 0 >>');
  const pageIds=pages.map(()=>add(''));
  const catalogId=add('<< /Type /Catalog /Pages '+pagesId+' 0 R >>');
  objects[pagesId-1]='<< /Type /Pages /Kids ['+pageIds.map(id=>id+' 0 R').join(' ')+'] /Count '+pageIds.length+' >>';
  pageIds.forEach((id,i)=>objects[id-1]='<< /Type /Page /Parent '+pagesId+' 0 R /MediaBox [0 0 '+W+' '+H+'] /Resources << /Font << /F1 '+font1+' 0 R /F2 '+font2+' 0 R >> >> /Contents '+contentIds[i]+' 0 R >>');

  let pdf='%PDF-1.4\n';const offsets=[0];
  objects.forEach((obj,i)=>{offsets[i+1]=pdf.length;pdf+=(i+1)+' 0 obj\n'+obj+'\nendobj\n';});
  const xref=pdf.length;
  pdf+='xref\n0 '+(objects.length+1)+'\n0000000000 65535 f \n';
  for(let i=1;i<offsets.length;i++)pdf+=String(offsets[i]).padStart(10,'0')+' 00000 n \n';
  pdf+='trailer\n<< /Size '+(objects.length+1)+' /Root '+catalogId+' 0 R >>\nstartxref\n'+xref+'\n%%EOF';

  const blob=new Blob([pdf],{type:'application/pdf'});
  const url=URL.createObjectURL(blob),link=document.createElement('a');
  link.href=url;link.download='DSR-'+String(d||'report').replace(/[^A-Za-z0-9_-]/g,'_')+'.pdf';
  document.body.appendChild(link);link.click();link.remove();
  setTimeout(()=>URL.revokeObjectURL(url),1500);
  toast('DSR PDF downloaded');
}

async function loadDailyReport(showDetails=false){
  const details=document.getElementById('daily-report-details');
  // Normal report refreshes keep the detail card hidden. Full-report navigation
  // passes showDetails=true so the actual DSR detail card is the visible viewer.
  if(details && !showDetails)details.hidden=true;
  const status=document.getElementById('report-status');
  try{
    // Do not block DSR opening on the separate settings/currency request.
    // The currency is already initialized with ETB and will be updated asynchronously.
    const d=document.getElementById('report-date').value||new Date().toISOString().slice(0,10);
    if(status)status.textContent='Loading report…';
    const [r,products]=await Promise.all([
      api('/api/reports/daily?date='+encodeURIComponent(d)),
      api('/api/products')
    ]);
    // Let the browser paint the already-open loading state before the heavy report build.
    await new Promise(resolve=>requestAnimationFrame(resolve));
    const productInfo=Object.fromEntries((products||[]).map(p=>[String(p.name||'').toLowerCase(),{
      code:p.code_name||p.name||'Unknown',
      name:p.name||'Unknown',
      color:p.color||''
    }]));
    const productFor=p=>productInfo[String(p||'').toLowerCase()]||{code:p||'Unknown',name:p||'Unknown',color:''};
    const codeForProduct=p=>productFor(p).code;
    window.currentDsrProductInfo=productInfo;
    const s=r.summary||{}, perf=r.dsr_performance||{};
    const dispenserDetails=Array.isArray(r.dsr_dispenser_details)?r.dsr_dispenser_details:(Array.isArray(r.dispenser_summary)?r.dispenser_summary:[]);
    const tankDetails=Array.isArray(r.dsr_tank_details)?r.dsr_tank_details:(Array.isArray(r.tank_details)?r.tank_details:[]);
    const salesSummary=r.dsr_sales_summary||{by_product:Array.isArray(r.sales_summary?.by_product)?r.sales_summary.by_product:[],by_type:Array.isArray(r.sales_summary?.by_type)?r.sales_summary.by_type:[],total_amount:Number(r.total_sales_amount||0),total_liters:Number(r.total_sales_liters||0)};
    const shifts=Array.isArray(r.shift_summary)?r.shift_summary:[];
    const ready=Boolean(r.report_ready);
    window.currentDailyReportData=r;
    window.currentDailyReportDate=d;

    const reportSubtitle=document.getElementById('report-subtitle');
    if(reportSubtitle)reportSubtitle.textContent=dailyReportDateLabel(d);
    const detailTitle=document.getElementById('daily-detail-title');
    const detailSubtitle=document.getElementById('daily-detail-subtitle');
    if(detailTitle)detailTitle.textContent=dailyReportIdLabel(d)+' · Detail';
    if(detailSubtitle)detailSubtitle.textContent=ready?'CONFIRMED DSR · Daily reconciliation':'Daily reconciliation';
    if(status)status.textContent=ready
      ?'Confirmed report — all completed shifts and sales confirmations are included.'
      :'Report waiting — '+Number(r.completion?.incomplete_shift_count||0)+' shift(s) incomplete or '+Number(r.completion?.unconfirmed_shift_count||0)+' shift(s) not fully confirmed.';

    document.getElementById('report-summary').innerHTML=
      '<div class="daily-stat primary-stat"><span>Total fuel sold</span><b>'+liters(perf.total_sales_liters||s.sales_liters)+' L</b><small>All dispensers</small></div>'+
      '<div class="daily-stat"><span>Total sales</span><b>'+money(perf.total_sales_amount||s.sales_amount)+'</b><small>Station total</small></div>'+
      '<div class="daily-stat"><span>Shifts</span><b>'+Number(perf.shift_count||0)+'</b><small>'+Number(perf.attendant_count||0)+' attendants</small></div>'+
      '<div class="daily-stat"><span>Dispensers</span><b>'+Number(perf.dispenser_count||0)+'</b><small>'+Number(perf.nozzle_count||0)+' nozzles</small></div>'+
      '<div class="daily-stat"><span>Tanks</span><b>'+Number(perf.tank_count||0)+'</b><small>Reconciliation</small></div>';

    const dispenserHtml=dispenserDetails.map(disp=>{
      const nozzles=(disp.nozzles||[]).map(n=>{
        const attendants=(n.attendant_shifts||[]).map(z=>{
          const meter=z.meter_delta_liters==null?'Boundary':liters(z.meter_delta_liters)+' L';
          const meterDiff=z.meter_difference_liters==null?'':(' · '+(Number(z.meter_difference_liters)>=0?'+':'')+liters(z.meter_difference_liters)+' L');
          return '<div class="dsr-attendant-shift"><span>'+h(z.attendant||'Unknown')+'</span><small>'+h(dailyReportTime(z.started_at))+' → '+h(dailyReportTime(z.ended_at))+'</small><strong>'+liters(z.sales_liters)+' L · '+money(z.sales_amount)+'</strong><em>Meter '+h(meter)+h(meterDiff)+'</em></div>';
        }).join('');
        const meterPct=n.meter_reconciliation_pct==null?'—':Number(n.meter_reconciliation_pct).toFixed(1)+'%';
        const meterDiff=n.meter_difference_liters==null?'—':(Number(n.meter_difference_liters)>=0?'+':'')+liters(n.meter_difference_liters)+' L';
        return '<article class="dsr-nozzle-card">'+
          '<div class="dsr-nozzle-head"><div><span class="daily-card-kicker">NOZZLE '+Number(n.nozzle_number||0)+'</span><h4>'+h(n.nozzle_code||'Nozzle')+'</h4><p><i class="dsr-product-dot" style="'+(productFor(n.product).color?'background:'+h(productFor(n.product).color)+';':'')+'"></i>'+h(codeForProduct(n.product))+'</p></div><span class="dsr-percent">'+Number(n.sales_share_pct||0).toFixed(1)+'% of dispenser</span></div>'+
          '<div class="dsr-reading-grid"><div><span>Opening reading</span><b>'+reading(n.opening_reading)+'</b><small>First applicable shift</small></div><div><span>Closing reading</span><b>'+reading(n.closing_reading)+'</b><small>Last applicable shift</small></div><div><span>Liters sold</span><b>'+liters(n.sales_liters)+' L</b></div><div><span>Sales amount</span><b>'+money(n.sales_amount)+'</b></div></div>'+
          '<div class="dsr-nozzle-performance"><div><span>Meter delta</span><strong>'+liters(n.meter_delta_liters)+' L</strong><small>Sum of valid shift segments</small></div><div><span>Meter difference</span><strong>'+meterDiff+'</strong><small>Sold − meter</small></div><div><span>Meter reconciliation</span><strong>'+meterPct+'</strong><small>'+(Number((n.meter_segments||[]).length)||0)+' meter segment(s)</small></div></div>'+
          '<div class="dsr-attendants"><div class="dsr-subhead">Attendant shifts</div>'+(attendants||'<div class="daily-empty">No attendant shift records.</div>')+'</div>'+
        '</article>';
      }).join('');
      return '<article class="dsr-dispenser-card" data-product-group="'+h(codeForProduct(disp.nozzles?.[0]?.product||'Unknown'))+'">'+
        '<div class="dsr-dispenser-head"><div><span class="daily-card-kicker">DISPENSER</span><h3>'+h(disp.dispenser||'—')+'</h3><p>'+Number(disp.shift_count||0)+' shift(s) · '+Number(disp.attendant_count||0)+' attendant(s)</p></div><div class="dsr-dispenser-total"><b>'+liters(disp.sales_liters)+' L</b><span>'+money(disp.sales_amount)+'</span><small>'+Number(disp.sales_share_pct||0).toFixed(1)+'% of station</small></div></div>'+
        '<div class="dsr-dispenser-meta"><div><span>Product</span><b><i class="dsr-product-dot" style="'+(productFor(disp.nozzles?.[0]?.product||'').color?'background:'+h(productFor(disp.nozzles?.[0]?.product||'').color)+';':'')+'"></i>'+h(codeForProduct(disp.nozzles?.[0]?.product||'Unknown'))+'</b></div><div><span>Average / shift</span><b>'+liters(disp.average_liters_per_shift)+' L</b></div><div><span>Average sales / shift</span><b>'+money(disp.average_sales_per_shift)+'</b></div><div><span>Nozzles</span><b>'+Number((disp.nozzles||[]).length)+'</b></div></div>'+
        '<div class="dsr-nozzles"><div class="dsr-subhead">Nozzle performance</div>'+(nozzles||'<div class="daily-empty">No nozzle records for this dispenser.</div>')+'</div>'+
      '</article>';
    }).join('');
    document.getElementById('report-dispensers').innerHTML=dispenserHtml||'<div class="daily-empty">No dispenser activity recorded for this date.</div>';


    function groupDsrCardsByProduct(containerId, cardSelector){
      const container=document.getElementById(containerId);
      if(!container)return;
      const cards=Array.from(container.querySelectorAll(':scope > '+cardSelector));
      if(!cards.length)return;
      const groups=new Map();
      cards.forEach(card=>{
        const key=card.getAttribute('data-product-group')||'Unknown';
        if(!groups.has(key))groups.set(key,[]);
        groups.get(key).push(card);
      });
      const frag=document.createDocumentFragment();
      groups.forEach((items,key)=>{
        const section=document.createElement('section');
        section.className='dsr-product-group';
        const title=document.createElement('div');
        title.className='dsr-product-group-title';
        const rawKey=String(key||'');
        const directInfo=productFor(rawKey)||{};
        const productInfo=directInfo.color?directInfo:(Object.values(window.currentDsrProductInfo||{}).find(p=>String(p?.code||'').toLowerCase()===rawKey.toLowerCase()||String(p?.name||'').toLowerCase()===rawKey.toLowerCase())||directInfo);
        const productColor=productInfo.color||'';
        title.innerHTML='<b class="dsr-product-group-name"><i class="dsr-product-group-dot" style="'+(productColor?'background:'+h(productColor)+';':'')+'"></i>'+h(key)+'</b>';
        section.appendChild(title);
        items.forEach(card=>section.appendChild(card));
        frag.appendChild(section);
      });
      container.replaceChildren(frag);
    }
    const tankHtml=tankDetails.map(t=>{
      const diff=Number(t.difference_liters||0), diffClass=Math.abs(diff)<0.001?'ok':(diff>0?'positive':'negative');
      const shiftRows=(t.shift_reconciliation||[]).map((s,idx)=>{
        const sd=Number(s.difference_liters||0), sc=Math.abs(sd)<0.001?'ok':(sd>0?'positive':'negative');
        const adj=Number(s.documented_stock_adjustment_liters||0);
        const continuity=Number(s.continuity_adjustment_liters||0);
        const purchase=Number(s.purchase_liters||0);
        const adjustmentTotal=adj+continuity;
        return '<div class="dsr-tank-shift-row"><div><b>Shift '+(idx+1)+'</b><small>'+h(dailyReportTime(s.started_at))+' → '+h(dailyReportTime(s.ended_at))+'</small></div><span>Opening<br><strong>'+liters(s.opening_liters)+' L</strong></span><span>Purchase<br><strong>+'+liters(purchase)+' L</strong></span><span>Adjustment<br><strong>'+(adjustmentTotal>=0?'+':'')+liters(adjustmentTotal)+' L</strong></span><span>Sales<br><strong>−'+liters(s.nozzle_sales_liters||0)+' L</strong></span><span>Expected<br><strong>'+liters(s.expected_closing_liters)+' L</strong></span><span>Closing<br><strong>'+liters(s.closing_liters)+' L</strong></span><span class="'+sc+'">Diff<br><strong>'+(sd>=0?'+':'')+liters(sd)+' L</strong></span></div>';
      }).join('');
      const dischargeRows=(t.discharge_operations||[]).map((op,idx)=>{
        const adj=Number(op.stock_adjustment_liters||0);
        const attribution=String(op.shift_attribution_status||'outside_shift');
        const attributionLabel=attribution==='inside_shift'?'Inside shift':(attribution==='ambiguous_overlap'?'Overlapping shifts':(attribution==='invalid_timestamp'?'Invalid timestamp':'Outside shift'));
        const attributionClass=attribution==='inside_shift'?'ok':(attribution==='ambiguous_overlap'||attribution==='invalid_timestamp'?'warning':'negative');
        const shiftText=op.shift_id
          ? h(op.shift_employee_name||'Unknown attendant')+' · Shift '+h(String(op.shift_id).slice(0,8))+' · '+h(dailyReportTime(op.shift_started_at))+' → '+h(dailyReportTime(op.shift_ended_at))
          : (attribution==='ambiguous_overlap'?'Multiple matching shifts':(attribution==='invalid_timestamp'?'Timestamp could not be parsed':'No active shift matched'));
        return '<div class="dsr-tank-discharge-row"><div><b>Discharge '+(idx+1)+'</b><small>'+h(dailyReportTime(op.discharge_datetime))+'</small><small class="dsr-discharge-shift '+attributionClass+'">'+attributionLabel+' · '+shiftText+'</small></div><span>Delivered<br><strong>+'+liters(op.discharged_liters||0)+' L</strong></span><span>Before<br><strong>'+liters(op.tank_liters_before||0)+' L</strong></span><span>Recorded<br><strong>'+liters(op.tank_stock_recorded_liters||0)+' L</strong></span><span>Adjustment<br><strong>'+(adj>=0?'+':'')+liters(adj)+' L</strong></span><span>Compartments<br><strong>'+h((op.compartment_indexes||[]).map(x=>Number(x)).join(', ')||'—')+'</strong></span></div>';
      }).join('');
      return '<article class="dsr-tank-card" data-product-group="'+h(codeForProduct(t.product))+'">'+
        '<div class="dsr-tank-head"><div><span class="daily-card-kicker">TANK</span><h3>'+h(t.tank||'—')+'</h3><p><i class="dsr-product-dot" style="'+(productFor(t.product).color?'background:'+h(productFor(t.product).color)+';':'')+'"></i>'+h(codeForProduct(t.product))+' · '+Number(t.shift_count||0)+' shift(s)</p></div><span class="dsr-tank-status '+diffClass+'">'+(Math.abs(diff)<0.001?'Reconciled':'Variance')+'</span></div>'+
        '<div class="dsr-tank-grid"><div><span>Opening stock</span><b>'+liters(t.opening_stock_liters)+' L</b><small>First applicable shift</small></div><div><span>Purchase contribution</span><b>+'+liters(t.purchase_discharged_liters)+' L</b><small>'+Number(t.purchase_count||0)+' purchase(s) · '+Number(t.purchase_operation_count||t.discharge_operation_count||0)+' discharge operation(s)</small></div><div><span>Documented adjustment</span><b>'+(Number(t.documented_stock_adjustment_liters||0)>=0?'+':'')+liters(t.documented_stock_adjustment_liters||0)+' L</b><small>Discharge-operation physical variance</small></div><div><span>Continuity adjustment</span><b>'+(Number(t.opening_adjustment_liters||0)>=0?'+':'')+liters(t.opening_adjustment_liters||0)+' L</b><small>Gap between consecutive shift readings</small></div><div><span>Nozzle sales</span><b>−'+liters(t.nozzle_sales_liters||0)+' L</b><small>Authoritative nozzle total</small></div><div><span>Expected closing</span><b>'+liters(t.expected_closing_liters)+' L</b><small>Opening + purchase + adjustments − authoritative nozzle sales</small></div><div><span>Recorded closing</span><b>'+liters(t.closing_stock_liters)+' L</b><small>Last applicable shift</small></div><div><span>Difference / shortage</span><b class="'+(diffClass==='ok'?'':'negative')+'">'+(diff>=0?'+':'')+liters(diff)+' L</b><small>'+(diffClass==='ok'?'No variance':'Genuine reconciliation variance remains visible')+'</small></div></div>'+
        '<div class="dsr-tank-performance"><div><span>Variance</span><strong>'+Number(t.variance_pct||0).toFixed(2)+'%</strong></div><div><span>Tank reconciliation</span><strong>'+Number(t.reconciliation_pct||0).toFixed(1)+'%</strong></div><div><span>Nozzle reconciliation</span><strong>'+Number(t.nozzle_reconciliation_pct||0).toFixed(1)+'%</strong><small>'+((Number(t.nozzle_sales_difference_liters||0)>=0?'+':'')+liters(t.nozzle_sales_difference_liters||0))+' L</small></div><div><span>Capacity</span><strong>'+liters(t.capacity_liters)+' L</strong></div></div>'+
        (dischargeRows?'<div class="dsr-tank-shifts"><div class="dsr-subhead">Discharge operations</div>'+dischargeRows+'</div>':'')+
        ((Number(t.discharge_outside_shift_count||0)||Number(t.discharge_ambiguous_shift_count||0)||Number(t.discharge_invalid_timestamp_count||0))?'<div class="dsr-discharge-attribution-note">Shift attribution: '+(Number(t.discharge_outside_shift_count||0)?Number(t.discharge_outside_shift_count)+' operation(s) outside an active shift. ':'')+(Number(t.discharge_ambiguous_shift_count||0)?Number(t.discharge_ambiguous_shift_count)+' operation(s) overlap multiple shifts. ':'')+(Number(t.discharge_invalid_timestamp_count||0)?Number(t.discharge_invalid_timestamp_count)+' operation(s) have invalid timestamps.':'')+'</div>':'')+
        (shiftRows?'<div class="dsr-tank-shifts"><div class="dsr-subhead">Shift-by-shift reconciliation</div>'+shiftRows+'</div>':'')+
      '</article>';
    }).join('');
    document.getElementById('report-tanks').innerHTML=tankHtml||'<div class="daily-empty">No tanks configured.</div>';

    const productRows=(salesSummary.by_product||[]).map(x=>
      '<div class="dsr-sales-row"><div><b>'+h(codeForProduct(x.product))+'</b><small>'+liters(x.liters)+' L</small></div><strong>'+money(x.amount)+'</strong><span>'+Number(x.percentage||0).toFixed(1)+'%</span></div>'
    ).join('');
    const typeRows=(salesSummary.by_type||[]).map(x=>
      '<div class="dsr-sales-row"><div><b>'+h(x.type)+'</b><small>Payment / sale method</small></div><strong>'+money(x.amount)+'</strong><span>'+Number(x.percentage||0).toFixed(1)+'%</span></div>'
    ).join('');
    document.getElementById('report-sales-summary').innerHTML=
      '<div class="dsr-sales-column"><div class="dsr-subhead">Fuel sales by product</div>'+(productRows||'<div class="daily-empty">No product sales.</div>')+'</div>'+
      '<div class="dsr-sales-column"><div class="dsr-subhead">Sales methods</div>'+(typeRows||'<div class="daily-empty">No sale methods recorded.</div>')+'</div>'+
      '<div class="dsr-sales-total"><div class="dsr-sales-total-row"><span>Sales amount</span><strong>'+money(salesSummary.total_amount)+'</strong></div><div class="dsr-sales-total-row"><span>Liters sold</span><strong>'+liters(salesSummary.total_liters)+' L</strong></div></div>';

    const nozzleLabels={};
    dispenserDetails.forEach(disp=>(disp.nozzles||[]).forEach(n=>{
      if(n.nozzle_id)nozzleLabels[String(n.nozzle_id)]=n.nozzle_code||('Nozzle '+Number(n.nozzle_number||0));
    }));
    const shiftRows=shifts.map((x,i)=>{
      const nozzleLabel=v=>nozzleLabels[String(v.nozzle_id||'')]||v.nozzle_code||('Nozzle '+String(v.nozzle_id||'—').slice(0,8));
      const opening=(x.opening_readings||[]).map(v=>nozzleLabel(v)+': '+reading(v.reading)).join(' · ')||'—';
      const closing=(x.closing_readings||[]).map(v=>nozzleLabel(v)+': '+reading(v.reading)).join(' · ')||'—';
      return '<article class="dsr-shift-card" data-product-group="'+h(codeForProduct(x.product))+'"><div class="dsr-shift-head"><div><span class="daily-card-kicker">SHIFT '+(i+1)+'</span><h3>'+h(x.attendant||'Unknown')+'</h3><p>'+h(x.dispenser||'—')+' · '+h(codeForProduct(x.product))+' · '+h(dailyReportIdLabel(d))+'</p></div><span class="dsr-dsr-status '+(x.sales_status==='confirmed'?'confirmed':'pending')+'">'+h(x.sales_status||'pending')+'</span></div>'+
        '<div class="dsr-shift-grid"><div><span>Start</span><b>'+h(dailyReportTime(x.started_at))+'</b></div><div><span>End</span><b>'+h(dailyReportTime(x.ended_at))+'</b></div><div><span>Liters sold</span><b>'+liters(x.sales_liters)+' L</b></div><div><span>Sales amount</span><b>'+money(x.sales_amount)+'</b></div><div><span>Tank opening</span><b>'+liters(x.tank_opening_liters)+' L</b></div><div><span>Tank closing</span><b>'+liters(x.tank_closing_liters)+' L</b></div></div>'+
        '<div class="dsr-shift-readings"><div><span>Opening readings</span><b>'+opening+'</b></div><div><span>Closing readings</span><b>'+closing+'</b></div></div></article>';
    }).join('');
    document.getElementById('report-shifts').innerHTML=shiftRows||'<div class="daily-empty">No shifts recorded for this DSR.</div>';
    groupDsrCardsByProduct('report-dispensers','.dsr-dispenser-card');
    groupDsrCardsByProduct('report-tanks','.dsr-tank-card');
    groupDsrCardsByProduct('report-shifts','.dsr-shift-card');


    const contributionRows=(perf.dispenser_contribution||[]).map(x=>
      '<div class="dsr-performance-metric"><span>'+h(x.dispenser||'Dispenser')+'</span><b>'+Number(x.percentage||0).toFixed(1)+'%</b></div>'
    ).join('');
    const methodPerf=(perf.sales_method_performance||salesSummary.by_type||[]).map(x=>
      '<div class="dsr-performance-metric"><span>'+h(x.type||'Sale method')+'</span><b>'+Number(x.percentage||0).toFixed(1)+'%</b></div>'
    ).join('');
    const tankPerf=(perf.tank_reconciliation||[]).map(x=>
      '<div class="dsr-performance-metric"><span>'+h(x.tank||'Tank')+'</span><b>'+Number(x.reconciliation_pct||0).toFixed(1)+'%</b></div>'
    ).join('');
    const attribution=perf.discharge_attribution||{};
    const auditBlock='<div class="dsr-performance-block dsr-discharge-audit-block"><div class="dsr-subhead">Discharge attribution audit</div><p class="dsr-audit-note">Timestamp-to-shift matching only. This audit does not change station-wide DSR purchase or reconciliation totals.</p><div class="dsr-discharge-audit-grid">'+
      '<div><span>Total operations</span><b>'+Number(attribution.operation_count||0)+'</b></div>'+
      '<div class="ok"><span>Inside active shift</span><b>'+Number(attribution.inside_shift_count||0)+'</b></div>'+
      '<div class="negative"><span>Outside active shift</span><b>'+Number(attribution.outside_shift_count||0)+'</b></div>'+
      '<div class="warning"><span>Overlapping shifts</span><b>'+Number(attribution.ambiguous_overlap_count||0)+'</b></div>'+
      '<div class="warning"><span>Invalid timestamp</span><b>'+Number(attribution.invalid_timestamp_count||0)+'</b></div></div>'+
      '<div class="dsr-discharge-audit-liters"><span>Outside-shift volume</span><b>'+liters(attribution.outside_shift_liters||0)+' L</b><span>Overlap volume</span><b>'+liters(attribution.ambiguous_overlap_liters||0)+' L</b></div></div>';

    const perfRows=[
      ['Fuel sold',liters(perf.total_sales_liters)+' L'],
      ['Sales amount',money(perf.total_sales_amount)],
      ['Meter-calculated sales',money(perf.calculated_sales_amount||0)],
      ['Recorded − meter',money(perf.sales_amount_difference||0)],
      ['Average liters / shift',liters(perf.average_liters_per_shift)+' L'],
      ['Average sales / shift',money(perf.average_sales_per_shift)],
      ['Dispensers',Number(perf.dispenser_count||0)],
      ['Nozzles',Number(perf.nozzle_count||0)],
      ['Tanks',Number(perf.tank_count||0)],
      ['Shifts',Number(perf.shift_count||0)],
      ['Attendants',Number(perf.attendant_count||0)],
      ['Tank difference',(Number(perf.tank_difference_liters||0)>=0?'+':'')+liters(perf.tank_difference_liters||0)+' L'],
      ['Avg. nozzle reconciliation',Number(perf.average_nozzle_reconciliation_pct||0).toFixed(1)+'%']
    ].map(x=>'<div class="dsr-performance-metric"><span>'+h(x[0])+'</span><b>'+h(x[1])+'</b></div>').join('');
    document.getElementById('report-performance').innerHTML=
      '<div class="dsr-performance-block"><div class="dsr-subhead">Station performance</div>'+perfRows+'</div>'+
      '<div class="dsr-performance-block"><div class="dsr-subhead">Dispenser contribution</div>'+(contributionRows||'<div class="daily-empty">No dispenser contribution data.</div>')+'</div>'+
      '<div class="dsr-performance-block"><div class="dsr-subhead">Sales method performance</div>'+(methodPerf||'<div class="daily-empty">No sales method data.</div>')+'</div>'+
      '<div class="dsr-performance-block"><div class="dsr-subhead">Tank reconciliation</div>'+(tankPerf||'<div class="daily-empty">No tank reconciliation data.</div>')+'</div>'+auditBlock;

    if(status)status.textContent='';
  }catch(e){
    if(status)status.textContent=e.message||'Unable to load the daily report.';
    ['report-summary','report-dispensers','report-tanks','report-sales-summary','report-shifts','report-performance'].forEach(id=>{const el=document.getElementById(id);if(el)el.innerHTML='';});
  }
}
async function loadDailyReportRevisions(){
  const section=document.getElementById('daily-report-revisions');
  const list=document.getElementById('daily-report-revisions-list');
  const date=document.getElementById('report-date')?.value;
  if(!section||!list||!date)return;
  section.hidden=false;
  list.innerHTML='<div class="daily-empty">Loading previous DSR versions…</div>';
  try{
    const rows=await api('/api/reports/daily/revisions?date='+encodeURIComponent(date));
    if(!Array.isArray(rows)||!rows.length){
      list.innerHTML='<div class="daily-empty">No previous version has been archived for this DSR.</div>';
      return;
    }
    list.innerHTML=rows.map(r=>{
      const snap=r.report_snapshot||{};
      return '<article class="daily-revision-card"><div class="daily-revision-head"><div><span class="daily-card-kicker">ARCHIVED VERSION</span><h3>Revision '+h(r.revision_no)+'</h3><small>'+h(r.archived_at?new Date(r.archived_at).toLocaleString():'—')+'</small></div><span class="daily-dsr-status-preview">Archived</span></div><div class="daily-revision-grid"><div><span>Fuel sold</span><strong>'+liters(snap.total_sales_liters||0)+' L</strong></div><div><span>Total sales</span><strong>'+money(snap.total_sales_amount||0)+'</strong></div><div><span>Purchase contribution</span><strong>'+liters(snap.total_purchases_liters||0)+' L</strong></div><div><span>Reason</span><strong>'+h(r.revision_reason||'DSR regenerated')+'</strong></div></div></article>';
    }).join('');
  }catch(e){list.innerHTML='<div class="daily-empty">Could not load revision history: '+h(e.message||'Request failed')+'</div>';}
}
async function regenerateDailyReport(){
  const date=document.getElementById('report-date')?.value;
  if(!date){toast('Select a DSR date first');return;}
  if(!confirm('Correct/regenerate this DSR? The current saved version will be archived first and shown in Revision History. Historical DSRs created before the confirmation workflow are also supported.'))return;
  try{
    await api('/api/reports/daily',{method:'POST',body:JSON.stringify({date,revision_reason:'Explicit DSR correction / regeneration'})});
    toast('DSR regenerated. Previous version archived.');
    await loadDailyReportRevisions();
    await loadDailyReport();
    await loadDailyReportConfirmations();
  }catch(e){toast(e.message||'DSR regeneration failed');}
}

async function saveDailyReport(){
  try{
    const dateValue=document.getElementById('report-date').value;
    if(!dateValue){toast('Select a report date');return;}
    await api('/api/reports/daily',{method:'POST',body:JSON.stringify({date:dateValue})});
    toast('Daily report snapshot saved');
  }catch(e){toast(e.message);}
}

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
function saveTankEdit(event){
  event.preventDefault();
  try{
    const id=document.getElementById('edit-tank-id')?.value||'';
    const old=settingsRecord(window.tankRecords,id);
    if(!old || !old.id){
      toast('Tank record could not be found. Please reload the page and try again.');
      return;
    }
    const cap=document.getElementById('edit-tank-capacity')?.value||'';
    const mmRaw=(document.getElementById('edit-tank-calibration-mm')?.value||'').trim();
    const litersRaw=(document.getElementById('edit-tank-calibration-liters')?.value||'').trim();
    if((mmRaw&&!litersRaw)||(!mmRaw&&litersRaw)){
      toast('Enter both calibration mm and calibration liters, or leave both blank.');
      return;
    }
    const details='<p><b>Tank:</b> '+h(old.tank_code||id)+'</p>'+settingsDiff('Capacity',liters(old.capacity_liters),liters(cap),'L')+
      ((mmRaw&&litersRaw)?'<p><b>Calibration:</b> '+h(mmRaw)+' mm = '+h(litersRaw)+' L</p>':'<p><b>Calibration:</b> Unchanged</p>');
    showSettingsConfirmation('Review Tank Update',details,()=>_saveTankEdit(),'Tank updated successfully','<p><b>'+h(old.tank_code||id)+'</b> was updated successfully.</p>'+details);
  }catch(e){
    toast(e?.message||'Unable to prepare tank update.');
  }
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
  const details='<p><b>Dispenser:</b> '+h(old.nozzle_code||id)+'</p>'+settingsDiff('Product',old.product,product)+settingsDiff('Tank',oldTank?.tank_code||old.tank_id,tank?.tank_code||tankId)+settingsDiff('Nozzles',old.nozzle_count,count);
  showSettingsConfirmation('Review Dispenser Update',details,()=>_saveDispenserEdit(event),'Dispenser updated successfully','<p><b>'+h(old.nozzle_code||id)+'</b> was updated successfully.</p>'+details);
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
    details+='<p style="margin:7px 0"><b>Opening liters:</b> '+h(liters(stockNumber))+' L</p>';
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
  if(!Number.isFinite(tankNumber)||tankNumber<0){toast('Enter the tank opening liters in liters.');return;}
  if(!employeeId){toast('Select an attendant before continuing.');return;}
  if(!selected.length){toast('Activate at least one nozzle and enter its opening meter reading before continuing.');return;}
  const readings=selected.map(x=>'<p style="margin:5px 0"><b>'+h(x.nozzleId)+':</b> '+h(liters(x.value))+'</p>').join('');
  const details='<p><b>Dispenser:</b> '+h(d.nozzle_code||id)+'</p><p><b>Attendant:</b> '+h(employee)+'</p><p><b>Opening liters:</b> '+h(liters(tankNumber))+' L</p><p><b>Nozzle opening readings:</b></p>'+readings+settingsStatus('Pending — dispenser remains inactive until attendant confirms');
  showSettingsConfirmation('Review Dispenser Shift Assignment',details,()=>_confirmDispenserActivation(),
    'Shift assignment created successfully','<p>The assignment was sent to <b>'+h(employee)+'</b>.</p>'+details);
}
async function _toggleNozzleConfirmed(id){return _toggleNozzle(id,true);}
function toggleNozzle(id,active){
  if(!active)return _toggleNozzle(id,active);
  openAdminPinConfirmation(id);
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

function initSettingsItemDrag(){
document.querySelectorAll('.settings-item-card:not(.settings-active-card) .settings-move-handle:not([data-drag-bound])').forEach(handle=>{
handle.dataset.dragBound='1';
let state=null,timer=null,raf=0,pendingY=0;

const cancelFrame=()=>{if(raf){cancelAnimationFrame(raf);raf=0;}};
const cleanup=()=>{
  if(timer){clearTimeout(timer);timer=null;}
  cancelFrame();
  document.querySelectorAll('.settings-drag-ghost,.settings-drag-placeholder').forEach(x=>x.remove());
  document.querySelectorAll('.settings-dragging').forEach(x=>x.classList.remove('settings-dragging'));
  state=null;
};

const updateDrag=()=>{
  raf=0;
  if(!state||!state.dragging)return;
  const y=pendingY;
  if(state.ghost){
    state.ghost.style.transform='translate3d(0,'+(y-state.rect.top-state.offsetY)+'px,0)';
  }
  const cards=Array.from(state.container.querySelectorAll(':scope > .settings-item-card[data-settings-id]'));
  const movable=cards.filter(x=>x!==state.card&&!x.classList.contains('settings-active-card'));
  const beforeActive=state.beforeActive;
  const afterActive=state.afterActive;
  const sameProductGroup=x=>!state.groupKey||x.dataset.dispenserProductGroup===state.groupKey||x.dataset.tankProductGroup===state.groupKey;
  const bounded=movable.filter(x=>{
    if(!sameProductGroup(x))return false;
    if(beforeActive && (x===beforeActive || !state.isAfter(beforeActive,x)))return false;
    if(afterActive && (x===afterActive || !state.isBefore(x,afterActive)))return false;
    return true;
  });
  let target=null;
  for(const x of bounded){
    const rect=x.getBoundingClientRect();
    if(y<rect.top+rect.height/2){target=x;break;}
  }
  if(target){
    if(state.placeholder.nextElementSibling!==target)state.container.insertBefore(state.placeholder,target);
  }else if(state.placeholder.parentElement===state.container){
    if(afterActive){
      if(state.placeholder.nextElementSibling!==afterActive)state.container.insertBefore(state.placeholder,afterActive);
    }else if(state.groupKey){
      const nextGroup=cards.find(x=>{
        const xGroup=x.dataset.tankProductGroup||x.dataset.dispenserProductGroup||'';
        return xGroup!==state.groupKey;
      });
      if(nextGroup&&state.placeholder.nextElementSibling!==nextGroup)state.container.insertBefore(state.placeholder,nextGroup);
      else if(state.container.lastElementChild!==state.placeholder)state.container.appendChild(state.placeholder);
    }else if(state.container.lastElementChild!==state.placeholder){
      state.container.appendChild(state.placeholder);
    }
  }
};

const scheduleDragUpdate=()=>{
  if(!raf)raf=requestAnimationFrame(updateDrag);
};

handle.addEventListener('pointerdown',e=>{
  if(e.button!==undefined&&e.button!==0)return;
  e.preventDefault();
  const card=handle.closest('.settings-item-card'),container=card?.parentElement;
  if(!card||!container)return;
  const rect=card.getBoundingClientRect();
  const cardsAtStart=Array.from(container.querySelectorAll(':scope > .settings-item-card[data-settings-id]'));
  const cardIndex=cardsAtStart.indexOf(card);
  const settingsKey=card.dataset.settingsKey||'';
  const groupKey=(settingsKey==='tanks'||settingsKey==='dispensers')
    ?(card.dataset.tankProductGroup||card.dataset.dispenserProductGroup||'')
    :'';
  const sameGroupAtStart=x=>!groupKey||x.dataset.tankProductGroup===groupKey||x.dataset.dispenserProductGroup===groupKey;
  const beforeActive=[...cardsAtStart].slice(0,cardIndex).reverse().find(x=>x.classList.contains('settings-active-card')&&sameGroupAtStart(x))||null;
  const afterActive=[...cardsAtStart].slice(cardIndex+1).find(x=>x.classList.contains('settings-active-card')&&sameGroupAtStart(x))||null;
  const isAfter=(a,b)=>cardsAtStart.indexOf(a)<cardsAtStart.indexOf(b);
  const isBefore=(a,b)=>cardsAtStart.indexOf(a)>-1&&cardsAtStart.indexOf(a)<cardsAtStart.indexOf(b);
  state={card,container,key:handle.dataset.settingsKey,original:settingsOrderFromContainer(container),
    groupKey,beforeActive,afterActive,isAfter,isBefore,
    startY:e.clientY,startX:e.clientX,dragging:false,rect};
  pendingY=e.clientY;
  try{handle.setPointerCapture(e.pointerId);}catch(_){}
  timer=setTimeout(()=>{
    if(!state)return;
    state.dragging=true;
    card.classList.add('settings-dragging');
    const placeholder=document.createElement('div');
    placeholder.className='settings-drag-placeholder';
    placeholder.style.height=rect.height+'px';
    state.placeholder=placeholder;
    card.after(placeholder);

    const ghost=card.cloneNode(true);
    ghost.classList.add('settings-drag-ghost');
    ghost.classList.remove('expanded');
    ghost.style.width=rect.width+'px';
    ghost.style.left=rect.left+'px';
    ghost.style.top=rect.top+'px';
    ghost.style.transform='translate3d(0,0,0)';
    document.body.appendChild(ghost);
    state.ghost=ghost;
    state.offsetY=e.clientY-rect.top;
  },180);
});

handle.addEventListener('pointermove',e=>{
  if(!state)return;
  if(!state.dragging){
    if(Math.hypot(e.clientX-state.startX,e.clientY-state.startY)>8){
      if(timer){clearTimeout(timer);timer=null;}
      cleanup();
    }
    return;
  }
  e.preventDefault();
  pendingY=e.clientY;
  scheduleDragUpdate();
});

const end=e=>{
  if(!state)return;
  if(timer){clearTimeout(timer);timer=null;}
  if(!state.dragging){cleanup();return;}
  cancelFrame();
  if(state.ghost)state.ghost.remove();
  state.card.classList.remove('settings-dragging');
  state.container.insertBefore(state.card,state.placeholder);
  state.placeholder.remove();
  try{handle.releasePointerCapture(e.pointerId);}catch(_){}
  const s=state;state=null;
  const current=settingsOrderFromContainer(s.container);
  if(current.join('|')===s.original.join('|')){loadSettingsData();return;}
  const label=s.key==='products'?'products':s.key==='saleTypes'?'sale types':s.key==='employees'?'users':s.key==='tanks'?'fuel tanks':'fuel dispensers';
  window.pendingSettingsReorder={
    containerKey:s.key,
    originalOrder:[...s.original]
  };
  showSettingsConfirmation('Save New '+label+' Order','<p>The '+h(label)+' order was changed.</p><p><b>Save these new positions?</b></p>',async()=>{
    try{await api('/api/settings/reorder',{method:'POST',body:JSON.stringify({key:s.key,ids:current})});await loadSettingsData();}
    catch(err){await loadSettingsData();throw err;}
  },'Order saved successfully','<p>The new '+h(label)+' positions have been saved.</p>');
};
handle.addEventListener('pointerup',end);
handle.addEventListener('pointercancel',()=>{if(state)cleanup();});
});}
function toggleSettingsSection(event,section){
  if(!section)return;
  if(event && event.target && event.target.closest('button,a,input,select,textarea'))return;
  section.classList.toggle('expanded');
}

function toggleSettingsItem(event,item){
  if(!item)return;
  if(event && event.target && event.target.closest('button,a,input,select,textarea'))return;
  item.classList.toggle('expanded');
}


function adminSalesHistoryMatches(item,search,period){
  const t=item.takeover||{};
  const hay=[
    item.dispenser?.name,item.dispenser?.nozzle_code,item.from_employee?.name,item.to_employee?.name,
    item.shift?.name,t.shift_id
  ].filter(Boolean).join(' ').toLowerCase();
  if(search && !hay.includes(search.toLowerCase()))return false;
  if(period && period!=='all'){
    const raw=t.sales_confirmed_at||t.shift_ended_at||t.shift_started_at;
    const d=raw?new Date(raw):null;
    if(!d || Number.isNaN(d.getTime()))return false;
    const now=new Date();
    if(period==='today'){
      if(d.toDateString()!==now.toDateString())return false;
    }else{
      const days=Number(period);
      if(Number.isFinite(days) && d < new Date(now.getTime()-days*86400000))return false;
    }
  }
  return true;
}
function filterAdminSalesHistoryPage(){
  const box=document.getElementById('full-sales-history-list');
  if(!box)return;
  const isFullHistory=document.body.classList.contains('admin-sales-history-page');
  const search=(document.getElementById('full-sales-history-search')?.value||'').trim();
  const period=document.getElementById('full-sales-history-period')?.value||'all';
  const rows=(adminSalesHistoryData.history||[]).filter(x=>isFullHistory?adminSalesHistoryMatches(x,search,period):adminSalesHistoryMatches(x,search,period));
  if(isFullHistory){
    const count=document.getElementById('full-sales-history-count');
    if(count)count.textContent=rows.length+' confirmed';
  }
  if(!rows.length){
    box.innerHTML='<div class="card admin-sales-empty"><div class="empty-icon">—</div><strong>No sales history found</strong><p class="muted">Try a different search or date filter.</p></div>';
    return;
  }

  const monthGroups={};
  rows.forEach(item=>{
    const dsrId=dailyReportIdFromTimestamp(item.takeover?.shift_started_at);
    const rawDate=item.takeover?.shift_started_at;
    const date=new Date(rawDate);
    const monthKey=Number.isNaN(date.getTime())
      ?String(dsrId).replace(/\s+DSR$/,'').slice(0,7)
      :new Intl.DateTimeFormat('en-CA',{timeZone:'Africa/Addis_Ababa',year:'numeric',month:'2-digit'}).format(date);
    (monthGroups[monthKey]||(monthGroups[monthKey]={}))[dsrId]||(monthGroups[monthKey][dsrId]=[]);
    monthGroups[monthKey][dsrId].push(item);
  });

  const monthKeys=Object.keys(monthGroups).sort((a,b)=>b.localeCompare(a));
  box.innerHTML=monthKeys.map(monthKey=>{
    const monthDate=new Date(monthKey+'-01T00:00:00');
    const monthLabel=Number.isNaN(monthDate.getTime())?monthKey:monthDate.toLocaleDateString(undefined,{month:'long',year:'numeric'});
    const dsrGroups=monthGroups[monthKey];
    const dsrKeys=Object.keys(dsrGroups).sort((a,b)=>b.localeCompare(a));
    return '<section class="admin-full-history-month-group" data-month-key="'+h(monthKey)+'">'+
      '<button type="button" class="admin-full-history-month-head" onclick="toggleAdminFullHistoryMonth(\''+h(monthKey)+'\')" aria-expanded="false">'+
        '<span class="admin-full-history-month-title"><span class="section-kicker">MONTH</span><strong>'+h(monthLabel)+'</strong></span>'+
        '<span class="admin-full-history-month-right"><small>'+dsrKeys.length+' DSR'+(dsrKeys.length===1?'':'s')+'</small><span class="admin-full-history-month-toggle" aria-hidden="true">⌄</span></span>'+
      '</button>'+
      '<div class="admin-full-history-month-body" hidden>'+
        dsrKeys.map(dsrId=>
          '<section class="admin-full-history-dsr-group" data-dsr-id="'+h(dsrId)+'">'+
            '<button type="button" class="admin-full-history-dsr-head" onclick="toggleAdminFullHistoryDsrGroup(\''+h(dsrId)+'\')" aria-expanded="false">'+
              '<span class="admin-full-history-dsr-title"><span class="section-kicker">DSR</span><strong>'+h(dsrId)+'</strong></span>'+
              '<span class="admin-full-history-dsr-right"><small>'+dsrGroups[dsrId].length+' confirmed sale'+(dsrGroups[dsrId].length===1?'':'s')+'</small><span class="admin-full-history-dsr-toggle" aria-hidden="true">⌄</span></span>'+
            '</button>'+
            '<div class="admin-full-history-dsr-cards" hidden>'+dsrGroups[dsrId].map(renderAdminHistorySaleCard).join('')+'</div>'+
          '</section>'
        ).join('')+
      '</div>'+
    '</section>';
  }).join('');
}
function toggleAdminFullHistoryMonth(monthKey){
  const group=document.querySelector('.admin-full-history-month-group[data-month-key="'+CSS.escape(String(monthKey))+'"]');
  if(!group)return;
  const body=group.querySelector('.admin-full-history-month-body');
  const head=group.querySelector('.admin-full-history-month-head');
  const toggle=group.querySelector('.admin-full-history-month-toggle');
  const expanded=group.classList.toggle('expanded');
  if(body)body.hidden=!expanded;
  if(head)head.setAttribute('aria-expanded',expanded?'true':'false');
  if(toggle)toggle.textContent=expanded?'⌃':'⌄';
}
async function toggleAdminFullHistoryDsrGroup(dsrId){
  const groups=document.querySelectorAll('.admin-full-history-dsr-group');
  let group=null;
  groups.forEach(el=>{if(String(el.getAttribute('data-dsr-id'))===String(dsrId))group=el;});
  if(!group)return;
  const cards=group.querySelector('.admin-full-history-dsr-cards');
  const head=group.querySelector('.admin-full-history-dsr-head');
  const toggle=group.querySelector('.admin-full-history-dsr-toggle');
  const expanded=group.classList.toggle('expanded');
  if(cards)cards.hidden=!expanded;
  if(head)head.setAttribute('aria-expanded',expanded?'true':'false');
  if(toggle)toggle.textContent=expanded?'⌃':'⌄';
}
async function adminSalesHistory(){
  try{
    const me=await currentUser();
    if(me.role!=='admin')return location.href='admin-login.html';
    await window.stationCurrencyReady;
    const history=await api('/api/sales/history');
    adminSalesHistoryData={history:Array.isArray(history)?history:[]};
    const count=document.getElementById('full-sales-history-count');
    if(count)count.textContent=adminSalesHistoryData.history.length+' confirmed';
    filterAdminSalesHistoryPage();
    const status=document.getElementById('full-sales-history-status');
    if(status)status.textContent='';
  }catch(e){
    const status=document.getElementById('full-sales-history-status');
    if(status)status.textContent=e.message;
    if(e.message==='Unauthorized')location.href='admin-login.html';
  }
}
function refreshAdminSalesHistory(){
  const search=document.getElementById('full-sales-history-search');
  const period=document.getElementById('full-sales-history-period');
  if(search)search.value='';
  if(period)period.value='all';
  return adminSalesHistory();
}

// Explicit page entry exports for the boot loader.
window.adminDashboard=adminDashboard;
window.adminSalesConfirmations=adminSalesConfirmations;
window.adminSalesHistory=adminSalesHistory;
window.adminSettings=adminSettings;
window.userDashboard=userDashboard;

// Unified admin sidebar toggle
function toggleAdminSidebar(){
  const body=document.body;
  if(!body || !body.classList.contains('admin-shell'))return;
  const mobile=window.matchMedia('(max-width:800px)').matches;
  const open=mobile
    ? body.classList.toggle('admin-sidebar-open')
    : !body.classList.toggle('admin-sidebar-collapsed');
  const btn=document.querySelector('.admin-sidebar-toggle');
  if(btn)btn.setAttribute('aria-expanded',String(open));
  try{localStorage.setItem('admin-sidebar-open',String(open));}catch(_){}
}
document.addEventListener('DOMContentLoaded',()=>{
  const body=document.body;
  const btn=document.querySelector('.admin-sidebar-toggle');
  if(!body||!btn||!body.classList.contains('admin-shell'))return;
  let open=true;
  try{open=localStorage.getItem('admin-sidebar-open')!=='false';}catch(_){}
  if(window.matchMedia('(max-width:800px)').matches){
    body.classList.toggle('admin-sidebar-open',open);
    body.classList.remove('admin-sidebar-collapsed');
  }else{
    body.classList.toggle('admin-sidebar-collapsed',!open);
    body.classList.remove('admin-sidebar-open');
  }
  btn.setAttribute('aria-expanded',String(open));
  window.addEventListener('resize',()=>{
    if(window.matchMedia('(max-width:800px)').matches){
      body.classList.remove('admin-sidebar-collapsed');
    }else{
      body.classList.remove('admin-sidebar-open');
    }
  });
});

// DSR History is intentionally not a sidebar destination; keep it hidden even on cached/legacy markup.
document.addEventListener('DOMContentLoaded',()=>{
  document.querySelectorAll('.admin-sidebar-nav a[data-admin-nav="dsr-history"], .admin-sidebar-nav a[href="admin-dsr-history.html"]').forEach(link=>link.remove());
});

// Unified admin sidebar active-state
document.addEventListener('DOMContentLoaded',()=>{
  const links=document.querySelectorAll('.admin-sidebar-nav a[data-admin-nav]');
  if(!links.length)return;
  const page=(location.pathname.split('/').pop()||'admin-dashboard.html').toLowerCase();
  const map={
    'admin-dashboard.html':'dashboard',
    'admin-purchases.html':'purchases',
    'admin-sales.html':'sales',
    'admin-daily-report.html':'daily-report',
        'admin-settings.html':'settings'
  };
  const active=map[page]||'';
  links.forEach(link=>{
    const on=link.dataset.adminNav===active;
    link.classList.toggle('active',on);
    if(on)link.setAttribute('aria-current','page');else link.removeAttribute('aria-current');
  });
});
