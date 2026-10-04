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
    const user=await api('/api/login',{method:'POST',body:JSON.stringify({operator_id,pin})});
    if(role==='admin' && user.role!=='admin') throw new Error('This account is not an admin account');
    localStorage.setItem('fuelRole',user.role);
    location.href=user.role==='admin'?'admin-dashboard.html':'attendant-dashboard.html';
  } catch(e) { toast(e.message); }
}
async function logout(){try{await api('/api/logout',{method:'POST',body:'{}'});}catch(_){} localStorage.removeItem('fuelRole');location.href='index.html';}
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
      return '<div class="takeover-sale-entry" data-sale-type="'+h(s.id)+'"><div class="takeover-sale-entry-head"><div><strong>'+h(s.name)+'</strong>'+(s.description?'<small>'+h(s.description)+'</small>':'')+'</div><input class="takeover-sale-amount" data-sale-id="'+h(s.id)+'" type="number" min="0" step="0.01" inputmode="decimal" value="'+(x?x.amount:'')+'" placeholder="0.00" oninput="updateTakeoverSaleConfirmation()"></div>'+(s.reason_required?'<label class="takeover-sale-reason-label">Reason<textarea class="takeover-sale-reason" data-reason-id="'+h(s.id)+'" rows="2" placeholder="Enter reason" oninput="updateTakeoverSaleConfirmation()">'+h(x?.reason||'')+'</textarea></label>':'')+'</div>';
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
  const sales=[];
  let missingReason='';
  document.querySelectorAll('#takeover-sale-type-list-confirm .takeover-sale-entry').forEach(row=>{
    const input=row.querySelector('.takeover-sale-amount');
    const raw=input?.value??'';
    if(raw.trim()==='')return;
    const amount=Number(raw);
    if(!Number.isFinite(amount)||amount<=0)return;
    const typeId=row.getAttribute('data-sale-type');
    const type=(window.takeoverSaleTypes||[]).find(x=>String(x.id)===String(typeId));
    const reason=row.querySelector('.takeover-sale-reason')?.value.trim()||'';
    if(type?.reason_required&&!reason)missingReason=type.name;
    sales.push({sale_type_id:typeId,name:type?.name||'Sale',amount,reason,reason_required:!!type?.reason_required});
  });
  const total=sales.reduce((sum,x)=>sum+x.amount,0);
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
  window.pendingTakeoverSales=sales;
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

function openTakeoverDetails(id){
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
  const sales=Array.isArray(takeover.nozzle_sales_liters)?takeover.nozzle_sales_liters:[];
  const rows=sales.map((s,i)=>{
    const o=opening.find(x=>String(x.nozzle_id)===String(s.nozzle_id))||opening[i]||{};
    const cl=closing.find(x=>String(x.nozzle_id)===String(s.nozzle_id))||closing[i]||{};
    return '<div class="takeover-detail-row"><div><b>Nozzle '+(i+1)+'</b><small>'+h(s.nozzle_id||o.nozzle_id||cl.nozzle_id||'')+'</small></div><span>Opening <b>'+reading(o.opening_reading??o.reading)+'</b></span><span>Closing <b>'+reading(cl.reading??cl.closing_reading)+'</b></span><span>Sold <b>'+liters(s.liters_sold)+' L</b></span><span>Price <b>'+money(s.unit_price)+'</b></span><span>Amount <b>'+money(s.amount)+'</b></span></div>';
  }).join('');
  const details=document.getElementById('takeover-details-content');
  if(details)details.innerHTML=
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
  const modal=document.getElementById('takeover-details-modal');
  if(modal){modal.classList.add('open');modal.setAttribute('aria-hidden','false');}
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

async function userDashboard(){
  try{
    await window.stationCurrencyReady;
    const me=await currentUser();
    if(me.role!=='attendant')return location.href='attendant-login.html';
    document.getElementById('name').textContent=me.name;
    const [shifts,nozzles,products,tanks,handovers,employees,takeovers,saleTypes]=await Promise.all([
      api('/api/shifts').catch(()=>[]),
      api('/api/nozzles').catch(()=>[]),
      api('/api/products').catch(()=>[]),
      api('/api/tanks').catch(()=>[]),
      api('/api/handovers').catch(()=>[]),
      api('/api/users').catch(()=>[]),
      api('/api/shift-takeovers').catch(()=>[]),
      api('/api/sale-types').catch(()=>[])
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
      return '<div class="card pending-confirmation-card">'+
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
      return '<div class="card pending-confirmation-card handover-pending-card">'+
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
      return '<div class="card pending-confirmation-card handover-receive-card">'+
        '<div class="pending-hero"><div class="pending-hero-icon">◷</div><div><div class="pending-card-title">Pending Shift Confirmation</div><div class="pending-card-subtitle">Please review the shift details and confirm when ready.</div></div></div>'+
        '<div class="pending-shift-info">'+
          '<div class="pending-info-block"><span class="pending-info-icon dispenser-icon">▣</span><div><span class="pending-label">Dispenser</span><strong>'+h(x.source_nozzle_code||n?.nozzle_code||shift?.nozzle_id||x.shift_id)+'</strong></div></div>'+
          '<div class="pending-info-divider"></div>'+
          '<div class="pending-info-block"><span class="pending-info-icon tank-icon">▤</span><div><span class="pending-label">Tank</span><strong>'+h(x.source_tank_code||tankNames[n?.tank_id]||n?.tank_id||'Not connected')+'</strong></div></div>'+
          '<div class="pending-tank-opening"><span class="pending-info-icon tank-icon">▤</span><div><span class="pending-label">Tank opening</span><strong>'+liters(x.closing_liters)+' <small>L</small></strong></div></div>'+
        '</div>'+
        '<div class="pending-nozzle-section"><div class="pending-nozzle-heading"><span class="pending-section-icon">⌁</span> Nozzle opening readings</div>'+nozzleReadings+'</div>'+
        '<form class="form" onsubmit="confirmHandoverFromDashboard(event,&quot;'+x.id+'&quot;)">'+
          '<input id="dashboard-handover-pin-'+x.id+'" type="password" inputmode="numeric" autocomplete="current-password" placeholder="Enter your PIN" required>'+
          '<div class="row"><button class="primary">Confirm Readings & Start Shift</button><button type="button" onclick="cancelPendingHandover(&quot;'+x.id+'&quot;)">Cancel Shift</button></div>'+
        '</form>'+
      '</div>';
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

    const pendingTakeoverHtml=pendingTakeovers.slice(0,5).map(t=>{
      const takeoverShift=shifts.find(s=>String(s.id)===String(t.shift_id));
      const takeoverNozzle=nozzles.find(n=>String(n.id)===String(takeoverShift?.nozzle_id));
      const takeoverDispenser=takeoverNozzle?.nozzle_code||t.dispenser_code||'Dispenser';
      return '<div class="card shift-takeover-card pending-takeover-sale-card">'+
        '<div class="takeover-hero"><div class="takeover-hero-icon">◷</div><div><div class="takeover-card-title">Pending Record Sale Confirmation</div><div class="takeover-card-subtitle">'+h(takeoverDispenser)+' • Waiting for admin</div></div></div>'+
        '<div class="takeover-total-grid">'+
          '<div><span>Liters sold</span><strong>'+liters(t.total_sales_liters)+' L</strong></div>'+
          '<div><span>Sales amount</span><strong>'+money(t.total_sales_amount)+'</strong></div>'+
        '</div>'+
        '<div class="row takeover-sale-action">'+
          '<button class="btn" type="button" onclick="cancelPendingTakeoverSale(\''+t.id+'\')">Cancel</button>'+
          '<button class="btn" type="button" onclick="openTakeoverDetails(\''+t.id+'\')">Details</button>'+
        '</div>'+
      '</div>';
    }).join('');
    const takeoverHtml=readyTakeovers.map(t=>{
      const takeoverShift=shifts.find(s=>String(s.id)===String(t.shift_id));
      const takeoverNozzle=nozzles.find(n=>String(n.id)===String(takeoverShift?.nozzle_id));
      const takeoverDispenser=takeoverNozzle?.nozzle_code||t.dispenser_code||'Dispenser';
      return '<div class="card shift-takeover-card">'+
        '<div class="takeover-hero"><div class="takeover-hero-icon">↔</div><div><div class="takeover-card-title">Record Sale</div><div class="takeover-card-subtitle">'+h(takeoverDispenser)+' • Handover completed</div></div></div>'+
        '<div class="takeover-total-grid"><div><span>Liters sold</span><strong>'+liters(t.total_sales_liters)+' L</strong></div><div><span>Sales amount</span><strong>'+money(t.total_sales_amount)+'</strong></div></div>'+
        '<div class="row takeover-sale-action"><button class="primary" type="button" onclick="openTakeoverSaleModal(\''+t.id+'\')">Record Sale</button><button class="btn" type="button" onclick="openTakeoverDetails(\''+t.id+'\')">Details</button></div>'+
      '</div>';
    }).join('');
    const activeForDisplay=active.filter(s=>!pendingOutgoingHandovers.some(x=>String(x.shift_id)===String(s.id)));
    const activeHtml=activeForDisplay.map(s=>{
      const n=nozzles.find(x=>x.id===s.nozzle_id);
      const readings=Array.isArray(s.activation_nozzles)&&s.activation_nozzles.length
        ?s.activation_nozzles
        :[{nozzle_id:n?.nozzle_code||s.nozzle_id,opening_reading:s.opening_reading}];
      const nozzleReadings=readings.map((x,i)=>
        '<div class="pending-nozzle-reading"><div class="pending-nozzle-top"><span class="pending-nozzle-pill">Nozzle '+(i+1)+'</span></div><div class="pending-nozzle-number">'+reading(x.opening_reading ?? x.reading)+'</div><div class="pending-nozzle-code">'+h(x.nozzle_id||n?.nozzle_code||s.nozzle_id)+'</div></div>'
      ).join('');
      return '<div class="card pending-confirmation-card active-shift-card">'+
        '<div class="pending-hero active-shift-hero"><div class="pending-hero-icon">✓</div><div><div class="pending-card-title">Active Shift</div><div class="pending-card-subtitle">Your shift is active and ready for fuel sales.</div></div></div>'+
        '<div class="pending-shift-info active-shift-info">'+
          '<div class="pending-info-block"><span class="pending-info-icon dispenser-icon">▣</span><div><span class="pending-label">Dispenser</span><strong>'+h(n?.nozzle_code||s.nozzle_id)+'</strong></div></div>'+
          '<div class="pending-info-divider"></div>'+
          '<div class="pending-info-block"><span class="pending-info-icon tank-icon">▤</span><div><span class="pending-label">Tank connected</span><strong>'+h(tankNames[n?.tank_id]||n?.tank_id||'Not connected')+'</strong></div></div>'+
          '<div class="pending-tank-opening active-opening-reading"><span class="pending-info-icon tank-icon">▤</span><div><span class="pending-label">Tank opening liters</span><strong>'+liters(s.opening_tank_liters)+' <small>L</small></strong></div></div>'+
        '</div>'+
        '<div class="pending-nozzle-section active-reading-section"><div class="pending-nozzle-heading"><span class="pending-section-icon">⌁</span> Shift nozzle readings</div>'+
          nozzleReadings+
        '</div>'+
        '<div class="row active-shift-actions"><button class="btn active-handover-btn" type="button" onclick="openDashboardHandover(\''+s.id+'\')">Handover</button></div></div>';
    }).join('');

    box.innerHTML=pendingShiftHtml+takeoverHtml+pendingTakeoverHtml+pendingOutgoingHtml+pendingIncomingHtml+activeHtml;
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
  const pin=document.getElementById('dashboard-handover-pin-'+id)?.value||'';
  try{
    await api('/api/handovers/'+id+'/confirm',{method:'POST',body:JSON.stringify({pin})});
    toast('Handover confirmed and shift started');
    await userDashboard();
  }catch(e){toast(e.message);}
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
  const historyRows=(adminSalesData.history||[]).filter(adminSalesMatches);
  if(pendingBox){
    pendingBox.innerHTML=pendingRows.length?pendingRows.map(renderAdminPendingSaleCard).join(''):'<div class="card admin-sales-empty"><div class="empty-icon">✓</div><strong>No pending sales confirmations</strong><p class="muted">All submitted shift sales have been reviewed.</p></div>';
  }
  if(historyBox){
    historyBox.innerHTML=historyRows.length?historyRows.map(renderAdminHistorySaleCard).join(''):'<div class="card admin-sales-empty"><div class="empty-icon">—</div><strong>No confirmed sales history</strong><p class="muted">Confirmed sales will appear here after admin review.</p></div>';
  }
  bindAdminSaleChecks();
}
function renderAdminPendingSaleCard(item){
  const t=item.takeover||{},sales=Array.isArray(item.sales)?item.sales:[],dispenser=item.dispenser?.name||'Dispenser',shift=item.shift?.name||((item.from_employee?.name||'')+' → '+(item.to_employee?.name||''));
  const submitted=sales.reduce((sum,x)=>sum+Number(x.amount||0),0),calculated=Number(t.total_sales_amount||0),variance=submitted-calculated;
  const checked=sales.map(s=>'<label class="admin-sale-check-row"><input type="checkbox" class="admin-sale-check" data-sale-id="'+h(s.id)+'"><span><strong>'+h(s.sale_type_name||'Sale')+'</strong><small>'+(s.sale_type_description?h(s.sale_type_description)+' • ':'')+'Amount: '+money(s.amount)+(s.reason?' • Reason: '+h(s.reason):'')+'</small></span></label>').join('');
  return '<article class="card admin-sale-confirm-card" data-takeover-id="'+h(t.id)+'"><div class="top"><div><span class="section-kicker">SALE CONFIRMATION</span><h3>'+h(dispenser)+'</h3><p class="muted">'+h(shift)+'</p></div><span class="pending-sale-badge">Pending</span></div>'+
    '<div class="admin-sale-context"><div><span>Shift started</span><strong>'+new Date(t.shift_started_at).toLocaleString()+'</strong></div><div><span>Shift ended</span><strong>'+new Date(t.shift_ended_at).toLocaleString()+'</strong></div><div><span>Liters sold</span><strong>'+liters(t.total_sales_liters)+' L</strong></div><div><span>Calculated amount</span><strong>'+money(calculated)+'</strong></div></div>'+
    '<div class="admin-sale-review-strip"><span><b>'+sales.length+'</b> sale entr'+(sales.length===1?'y':'ies')+'</span><span>Submitted <b>'+money(submitted)+'</b></span><span class="'+(Math.abs(variance)<0.005?'match':'difference')+'">'+(Math.abs(variance)<0.005?'Amount matches':'Amount difference')+' <b>'+money(Math.abs(variance))+'</b></span></div>'+
    '<div class="admin-sale-check-section"><div class="takeover-detail-heading">Sales to check <small>Check every entry before confirming</small></div>'+checked+'</div>'+
    '<div class="admin-sale-total"><span>Submitted sales total</span><strong>'+money(submitted)+'</strong></div><div class="row admin-sale-actions"><button type="button" onclick="cancelAdminSaleConfirmation(\''+t.id+'\')">Cancel</button><button type="button" class="primary" disabled data-confirm-sales="'+h(t.id)+'" onclick="confirmAdminSaleConfirmation(\''+t.id+'\')">Confirm sales</button></div></article>';
}
function renderAdminHistorySaleCard(item){
  const t=item.takeover||{},sales=Array.isArray(item.sales)?item.sales:[],from=item.from_employee?.name||'Attendant',to=item.to_employee?.name||'Attendant',dispenser=item.dispenser?.name||'Dispenser';
  return '<article class="card compact-confirmed-sale-card admin-history-sale-card"><div class="top"><div><span class="section-kicker">SALES CONFIRMED</span><h3>'+h(dispenser)+'</h3><p class="muted">'+h(from)+' → '+h(to)+'</p></div><span class="badge">Confirmed</span></div>'+
    '<div class="compact-sale-summary"><span>Shift '+h(String(t.shift_id||'').slice(0,8))+'</span><span>'+liters(t.total_sales_liters)+' L</span><strong>'+money(t.total_sales_amount)+'</strong></div>'+
    '<div class="admin-history-meta"><span>Confirmed <b>'+h(t.sales_confirmed_at?new Date(t.sales_confirmed_at).toLocaleString():'—')+'</b></span><span><b>'+sales.length+'</b> sale entr'+(sales.length===1?'y':'ies')+'</span></div>'+
    '<button type="button" class="btn compact-detail-button" onclick="openAdminSaleHistoryDetails(\''+h(t.id)+'\')">View details</button></article>';
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
function downloadAdminSaleHistoryDetails(id){
  const item=(adminSalesData.history||[]).find(x=>String(x.takeover?.id)===String(id));
  if(!item)return;
  const t=item.takeover||{};
  const sales=Array.isArray(item.sales)?item.sales:[];
  const total=Number(t.total_sales_amount||0);
  const entryTotal=sales.reduce((sum,s)=>sum+Number(s.amount||0),0);
  const clean=value=>String(value==null?'':value).replace(/[^ -~]/g,'?');
  const wrap=(value,width)=>{
    const words=clean(value).split(/\s+/);
    const out=[];
    let line='';
    words.forEach(word=>{
      if(!word)return;
      const next=line?line+' '+word:word;
      if(next.length>width){
        if(line)out.push(line);
        line=word;
      }else{
        line=next;
      }
    });
    if(line)out.push(line);
    return out.length?out:[''];
  };
  const lines=[
    'SALES HISTORY - SHIFT DETAIL','',
    'Dispenser: '+clean(item.dispenser?.name||'Dispenser'),
    'Product: '+clean(item.dispenser?.product_name||item.dispenser?.product||''),
    'From attendant: '+clean(item.from_employee?.name||''),
    'Received by: '+clean(item.to_employee?.name||''),
    'Shift ID: '+clean(t.shift_id||id),
    'Shift started: '+clean(t.shift_started_at?new Date(t.shift_started_at).toLocaleString():''),
    'Shift ended: '+clean(t.shift_ended_at?new Date(t.shift_ended_at).toLocaleString():''),
    'Confirmed by admin: '+clean(t.sales_confirmed_at?new Date(t.sales_confirmed_at).toLocaleString():''),
    'Liters sold: '+clean(liters(t.total_sales_liters))+' L',
    'Confirmed total: '+clean(money(total)),'','RECORDED SALES',
    '----------------------------------------'
  ];
  sales.forEach((sale,index)=>{
    lines.push((index+1)+'. '+clean(sale.sale_type_name||'Sale')+'  '+clean(money(sale.amount)));
    if(sale.sale_type_description)lines.push(...wrap('Description: '+sale.sale_type_description,88));
    if(sale.reason)lines.push(...wrap('Reason: '+sale.reason,88));
  });
  lines.push(
    '----------------------------------------',
    'Entries total: '+clean(money(entryTotal)),
    '',
    'Status: Confirmed by admin'
  );

  const pageLines=[];
  lines.forEach(line=>pageLines.push(...wrap(line,88)));
  const pages=[];
  for(let i=0;i<pageLines.length;i+=46)pages.push(pageLines.slice(i,i+46));

  const objects=[{id:1,body:'<< /Type /Catalog /Pages 2 0 R >>'}];
  const kids=[];
  let nextId=4;
  pages.forEach(pageLinesForPage=>{
    const pageId=nextId++;
    const contentId=nextId++;
    kids.push(pageId+' 0 R');
    const textCommands=pageLinesForPage.map((line,index)=>{
      const escaped=clean(line).replace(/\\/g,'\\\\').replace(/\(/g,'\\(').replace(/\)/g,'\\)');
      return (index?'0 -15 Td\n':'')+'('+escaped+') Tj';
    }).join('\n');
    const stream='BT\n/F1 11 Tf\n50 760 Td\n'+textCommands+'\nET';
    objects.push(
      {id:pageId,body:'<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents '+contentId+' 0 R >>'},
      {id:contentId,body:'<< /Length '+stream.length+' >>\nstream\n'+stream+'\nendstream'}
    );
  });
  objects.push(
    {id:2,body:'<< /Type /Pages /Kids ['+kids.join(' ')+'] /Count '+pages.length+' >>'},
    {id:3,body:'<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'}
  );
  objects.sort((a,b)=>a.id-b.id);

  let pdf='%PDF-1.4\n%PDF-1.4\n';
  const offsets=[];
  objects.forEach(object=>{
    offsets[object.id]=pdf.length;
    pdf+=object.id+' 0 obj\n'+object.body+'\nendobj\n';
  });
  const xrefOffset=pdf.length;
  pdf+='xref\n0 '+(objects.length+1)+'\n0000000000 65535 f \n';
  for(let i=1;i<=objects.length;i++){
    pdf+=String(offsets[i]||0).padStart(10,'0')+' 00000 n \n';
  }
  pdf+='trailer\n<< /Size '+(objects.length+1)+' /Root 1 0 R >>\nstartxref\n'+xrefOffset+'\n%%EOF';

  const url=URL.createObjectURL(new Blob([pdf],{type:'application/pdf'}));
  const link=document.createElement('a');
  const stamp=(p.purchase_date||p.created_at||new Date().toISOString()).replace(/[^0-9]/g,'').slice(0,14);
  link.href=url;
  link.download='shift-'+String(t.shift_id||id).slice(0,8)+'-'+stamp+'.pdf';
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
  toast('PDF downloaded');
}function downloadPurchaseDetailPdf(){
  const id=window.currentPurchaseDetailId;
  const item=window.currentPurchaseDetailData||((typeof purchaseDetailData!=='undefined'&&Array.isArray(purchaseDetailData)?purchaseDetailData:[]).find(x=>String(x.id)===String(id)));
  if(!item){toast('Purchase details are not available. Please reopen the detail card and try again.');return;}
  const p=item;
  const history=Array.isArray(p.discharge_history)?p.discharge_history:[];
  const compartments=Array.isArray(p.compartment_liters)?p.compartment_liters:[];
  const delivered=Number(p.delivered_quantity_liters||p.quantity_liters||p.ordered_quantity_liters||0);
  const discharged=Number(p.discharged_quantity_liters||0);
  const remaining=Math.max(0,delivered-discharged);
  const clean=value=>String(value==null?'':value).replace(/[^ -~]/g,'?');
  const wrap=(value,width)=>{
    const words=clean(value).split(/\s+/);
    const out=[];
    let line='';
    words.forEach(word=>{
      if(!word)return;
      const next=line?line+' '+word:word;
      if(next.length>width){
        if(line)out.push(line);
        line=word;
      }else{
        line=next;
      }
    });
    if(line)out.push(line);
    return out.length?out:[''];
  };
  const lines=[
    'PURCHASE HISTORY - PURCHASE DETAIL','',
    'Product: '+clean(p.product||p.product_code||''),
    'Invoice: '+clean(p.invoice_number||''),
    'Status: '+clean(p.status||''),
    'Purchase date: '+clean(p.purchase_date?new Date(p.purchase_date).toLocaleString():(p.created_at?new Date(p.created_at).toLocaleString():'')),
    'Ordered quantity: '+clean(Number(p.ordered_quantity_liters||p.quantity_liters||0).toLocaleString())+' L',
    'Delivered quantity: '+clean(delivered.toLocaleString())+' L',
    'Discharged quantity: '+clean(discharged.toLocaleString())+' L',
    'Undischarged quantity: '+clean(remaining.toLocaleString())+' L',
    '',
    'ORDER','----------------------------------------',
    'Invoice number: '+clean(p.invoice_number||'—'),
    'Purchase date: '+clean(p.purchase_date?new Date(p.purchase_date).toLocaleString():(p.created_at?new Date(p.created_at).toLocaleString():'—')),
    '',
    'TRUCK & DRIVER','----------------------------------------',
    'Driver: '+clean(p.driver_name||'—'),
    'Driver phone: '+clean(p.driver_phone||'—'),
    'Plate number: '+clean(p.plate_number||p.truck_plate||'—'),
    'Compartments: '+clean(p.truck_compartments||compartments.length||'—')
  ];
  compartments.forEach((q,index)=>lines.push('Compartment '+(index+1)+': '+clean(Number(q||0).toLocaleString())+' L'));
  lines.push('','DISCHARGE HISTORY','----------------------------------------');
  if(!history.length)lines.push('No discharge operations recorded.');
  history.forEach((e,index)=>{
    lines.push(
      'Discharge '+(index+1)+': '+clean(e.discharge_datetime||e.discharged_at||e.created_at||'—'),
      'Quantity: '+clean(Number(e.quantity_liters||e.discharged_quantity_liters||0).toLocaleString())+' L',
      'Tank: '+clean(e.tank_code||e.tank_id||'—'),
      'Shift attendant(s): '+clean(e.shift_attendants||e.attendant_name||e.employee_name||'—'),
      'Tank stock before: '+clean(Number(e.tank_liters_before||0).toLocaleString())+' L',
      'Expected closing: '+clean(Number(e.expected_closing_liters||0).toLocaleString())+' L',
      'Recorded closing: '+clean(Number(e.tank_liters_after||e.recorded_closing_liters||0).toLocaleString())+' L',
      'Stock status: '+clean(e.tank_stock_status||'—'),''
    );
  });
  lines.push('PURCHASE REMARK','----------------------------------------',clean(p.remark||p.purchase_remark||'No purchase remark recorded.'));

  const pageLines=[];
  lines.forEach(line=>pageLines.push(...wrap(line,88)));
  const pages=[];
  for(let i=0;i<pageLines.length;i+=46)pages.push(pageLines.slice(i,i+46));

  const objects=[{id:1,body:'<< /Type /Catalog /Pages 2 0 R >>'}];
  const kids=[];
  let nextId=4;
  pages.forEach(pageLinesForPage=>{
    const pageId=nextId++;
    const contentId=nextId++;
    kids.push(pageId+' 0 R');
    const textCommands=pageLinesForPage.map((line,index)=>{
      const escaped=clean(line).replace(/\\/g,'\\\\').replace(/\(/g,'\\(').replace(/\)/g,'\\)');
      return (index?'0 -15 Td\n':'')+'('+escaped+') Tj';
    }).join('\n');
    const stream='BT\n/F1 11 Tf\n50 760 Td\n'+textCommands+'\nET';
    objects.push(
      {id:pageId,body:'<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents '+contentId+' 0 R >>'},
      {id:contentId,body:'<< /Length '+stream.length+' >>\nstream\n'+stream+'\nendstream'}
    );
  });
  objects.push(
    {id:2,body:'<< /Type /Pages /Kids ['+kids.join(' ')+'] /Count '+pages.length+' >>'},
    {id:3,body:'<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'}
  );
  objects.sort((a,b)=>a.id-b.id);

  let pdf='%PDF-1.4\n%PDF-1.4\n';
  const offsets=[];
  objects.forEach(object=>{
    offsets[object.id]=pdf.length;
    pdf+=object.id+' 0 obj\n'+object.body+'\nendobj\n';
  });
  const xrefOffset=pdf.length;
  pdf+='xref\n0 '+(objects.length+1)+'\n0000000000 65535 f \n';
  for(let i=1;i<=objects.length;i++){
    pdf+=String(offsets[i]||0).padStart(10,'0')+' 00000 n \n';
  }
  pdf+='trailer\n<< /Size '+(objects.length+1)+' /Root 1 0 R >>\nstartxref\n'+xrefOffset+'\n%%EOF';

  const url=URL.createObjectURL(new Blob([pdf],{type:'application/pdf'}));
  const link=document.createElement('a');
  const stamp=(p.purchase_date||p.created_at||new Date().toISOString()).replace(/[^0-9]/g,'').slice(0,14);
  link.href=url;
  link.download='purchase-'+String(p.invoice_number||id).replace(/[^A-Za-z0-9_-]/g,'_')+'-'+stamp+'.pdf';
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
  toast('PDF downloaded');
}
window.downloadPurchaseDetailPdf=downloadPurchaseDetailPdf;
function openAdminSaleHistoryDetails(id){
  const item=(adminSalesData.history||[]).find(x=>String(x.takeover?.id)===String(id));
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
      '<div class="history-detail-main"><span class="section-kicker">CONFIRMED SALES</span><h4>'+h(item.dispenser?.name||'Dispenser')+'</h4><p>'+h(item.from_employee?.name||'—')+' <span>→</span> '+h(item.to_employee?.name||'—')+'</p></div>',
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
async function finalizeAdminSaleConfirmation(){
  const id=window.pendingAdminSaleReviewId;
  if(!id)return;
  const card=document.querySelector('.admin-sale-confirm-card[data-takeover-id="'+id+'"]');
  const ids=Array.from(card?.querySelectorAll('.admin-sale-check:checked')||[]).map(x=>x.getAttribute('data-sale-id'));
  const total=card?.querySelectorAll('.admin-sale-check').length||0;
  if(!ids.length||ids.length!==total){closeAdminSaleReview();toast('Tick every sale before confirming');return;}
  const button=document.getElementById('admin-sale-final-confirm');
  if(button)button.disabled=true;
  try{await api('/api/sales/confirmations/'+id+'/confirm',{method:'POST',body:JSON.stringify({checked_sale_ids:ids})});closeAdminSaleReview();toast('Sales confirmed');await adminSalesConfirmations();}catch(e){if(button)button.disabled=false;toast(e.message);}
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
async function _cancelAdminPendingShift(id){
  try{
    await api('/api/shifts/'+id+'/cancel',{method:'POST',body:'{}'});
    await loadSettingsData();
  }catch(e){throw e;}
}
async function loadSettingsData(){
  let [employees,tanks,dispensers,products,shifts,saleTypes,stationSettings]=await Promise.all([api('/api/users'),api('/api/tanks'),api('/api/nozzles'),api('/api/products'),api('/api/shifts'),api('/api/sale-types'),api('/api/settings')]);
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
  document.getElementById('tanks').innerHTML=groupedTanks.length?groupedTanks.map(({t,groupIndex,itemIndex,groupKey})=>`${itemIndex===0?`<div class="settings-product-group-label"><span class="settings-product-group-color" style="background:${h(colorForProduct(t.product))}"></span>${h(codeForProduct(t.product))}</div>`:''}<div class="card settings-item-card ${t.active!==false?'settings-active-card':''} ${itemIndex===0&&groupIndex>0?'tank-group-start':''}" data-tank-product-group="${h(groupKey)}" data-settings-key="tanks" data-settings-id="${t.id}" onclick="toggleSettingsItem(event,this)"><div class="top"><button type="button" class="settings-move-handle" title="Hold and drag to move" aria-label="Hold and drag to move" onclick="event.stopPropagation()">⋮</button><div><b>${h(t.tank_code)} — ${h(codeForProduct(t.product))}</b><div class="settings-card-details"><div><span>Capacity:</span> <b>${liters(t.capacity_liters)} L</b></div><div><span>Status:</span> <b>${t.active===false?'Inactive':'Active'}</b></div><div><span>Opening liters:</span> <b>${t.opening_stock_liters==null?'Not recorded':liters(t.opening_stock_liters)+' L'}</b></div></div></div><div class="row settings-card-actions"><button type="button" class="settings-toggle-action" onclick="toggleTank('${t.id}',${t.active!==false})">${t.active===false?'Activate':'Deactivate'}</button><button type="button" onclick="openTankEdit('${t.id}')">Edit</button><button type="button" class="settings-remove-action" onclick="removeTank('${t.id}')">Remove</button></div></div></div>`).join(''):'<p class="muted">No tanks.</p>';
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
async function _saveTankEdit(event){
  event.preventDefault();
  const id=document.getElementById('edit-tank-id').value;
  try{
    await api('/api/tanks/'+id,{method:'PATCH',body:JSON.stringify({
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
  if(tankLabel)tankLabel.firstChild.textContent=''+(tank?.tank_code||'Tank')+' opening liters';
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
    error.textContent='Enter the tank opening liters.';
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
          '<small class="muted">Opening: '+(opening!==null?Number(opening).toLocaleString():'Not recorded')+'</small>'+
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
    const me=await currentUser(),[shifts,employees,nozzles]=await Promise.all([api('/api/shifts'),api('/api/handover-receivers').catch(()=>[]),api('/api/nozzles')]);
    const active=shifts.filter(s=>s.status==='active'&&String(s.employee_id)===String(me.id));
    const requested=new URLSearchParams(location.search).get('shift_id');
    const selected=active.find(s=>s.id===requested)||active[0];
    if(!selected){
      document.getElementById('handover-status').textContent='No active shift available for handover.';
      return;
    }
    window.handoverDraft={shift_id:selected.id,to_employee_id:'',closing_reading:null,closing_liters:null};
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
  const closingLiters=Number(document.getElementById('handover-closing-liters').value);
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
  if(!Number.isFinite(closingLiters)||closingLiters<0){toast('Enter valid tank closing liters');return;}
  const primaryReading=closingNozzleReadings[0].reading;
  window.handoverDraft={...window.handoverDraft,to_employee_id:to,closing_reading:primaryReading,closing_nozzle_readings:closingNozzleReadings,closing_liters:closingLiters};
  const employeeSelect=document.getElementById('handover-to-employee');
  const employeeName=employeeSelect?.selectedOptions?.[0]?.textContent||to;
  const reviewNozzles=closingNozzleReadings.map((x,i)=>
    '<div class="handover-review-row"><span>Nozzle '+(i+1)+' <small>'+h(x.nozzle_id)+'</small></span><strong>'+Number(x.reading).toFixed(2).replace(/\\.?0+$/,'')+'</strong></div>'
  ).join('');
  document.getElementById('handover-review-details').innerHTML=
    '<div class="handover-review-summary">'+
      '<div class="handover-review-main"><span>Receiving attendant</span><strong>'+h(employeeName)+'</strong></div>'+
      '<div class="handover-review-section"><div class="handover-review-section-title">Closing meter readings</div>'+reviewNozzles+'</div>'+
      '<div class="handover-review-main"><span>Tank closing liters</span><strong>'+closingLiters.toLocaleString(undefined,{maximumFractionDigits:2})+' L</strong></div>'+
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
    toast('Handover submitted');
    setTimeout(()=>userDashboard(),500);
  }catch(e){toast(e.message);}
}
async function loadPendingHandovers(){
  try{
    const [hs,emps]=await Promise.all([api('/api/handovers'),api('/api/users').catch(()=>[])]);
    const names=Object.fromEntries(emps.map(e=>[e.id,e.name]));
    const pending=hs.filter(x=>x.status==='pending');
    document.getElementById('pending-list').innerHTML=pending.length?pending.map(x=>`<div class="card"><h3>Handover ${h(x.id.slice(0,8))}</h3><p>From: <b>${h(names[x.from_employee_id]||x.from_employee_id)}</b><br>To: <b>${h(names[x.to_employee_id]||x.to_employee_id)}</b></p><p>Closing meter: ${liters(x.closing_reading)} • Tank: ${liters(x.closing_liters)} L</p><form class="form" onsubmit="confirmHandover(event,'${x.id}')"><input id="confirm-reading-${x.id}" type="number" min="0" step="0.01" placeholder="Opening meter" required><input id="confirm-mm-${x.id}" type="number" min="0" step="0.01" placeholder="Tank opening dip (mm)" required><input id="confirm-liters-${x.id}" type="number" min="0" step="0.01" placeholder="Tank opening liters" required><button class="primary">Confirm & Start Shift</button></form></div>`).join(''):'<div class="card"><p>No pending handovers.</p></div>';
  }catch(e){document.getElementById('pending-list').textContent=e.message;}
}
async function confirmHandover(e,id){e.preventDefault();try{await api('/api/handovers/'+id+'/confirm',{method:'POST',body:JSON.stringify({opening_reading:Number(document.getElementById('confirm-reading-'+id).value),opening_mm:Number(document.getElementById('confirm-mm-'+id).value),opening_liters:Number(document.getElementById('confirm-liters-'+id).value),pin:document.getElementById('confirm-pin-'+id).value})});toast('Handover confirmed');setTimeout(()=>location.href='attendant-dashboard.html',700);}catch(x){toast(x.message);}}

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
function dailyReportTime(value){
  if(!value)return '—';
  const d=new Date(value);
  return Number.isNaN(d.getTime())?String(value):d.toLocaleTimeString(undefined,{hour:'2-digit',minute:'2-digit'});
}
function dailyReportVarianceClass(value){
  const n=Number(value||0);
  return Math.abs(n)<0.0001?'ok':(n>0?'positive':'negative');
}
async function loadDailyReport(){
  const status=document.getElementById('report-status');
  try{
    await window.stationCurrencyReady;
    const d=document.getElementById('report-date').value||new Date().toISOString().slice(0,10);
    status.textContent='Loading report…';
    const [r,products]=await Promise.all([api('/api/reports/daily?date='+encodeURIComponent(d)),api('/api/products')]);
    const productCodes=Object.fromEntries((products||[]).map(p=>[String(p.name||'').toLowerCase(),p.code_name||p.name]));
    const codeForProduct=p=>productCodes[String(p||'').toLowerCase()]||p||'Unknown';
    const s=r.summary||{};
    document.getElementById('report-subtitle').textContent=dailyReportDateLabel(d);
    const ready=Boolean(r.report_ready);
    status.textContent=ready ? 'Report ready — all shifts started on this date are complete.' :
      'Report waiting — '+Number(r.completion?.incomplete_shift_count||0)+' shift(s) still incomplete.'+
      (Number(r.completion?.unconfirmed_shift_count||0)?' Sales confirmation is also pending.':'');
    const saveButton=document.querySelector('.daily-filter-actions .primary');
    if(saveButton){
      saveButton.disabled=!ready;
      saveButton.title=ready?'Save the completed daily report':'Complete all shifts and sales confirmations first';
    }

    document.getElementById('report-summary').innerHTML=
      '<div class="daily-stat primary-stat"><span>Fuel volume sold</span><b>'+liters(s.sales_liters)+' L</b><small>All shift sales combined</small></div>'+
      '<div class="daily-stat"><span>Recorded sales</span><b>'+money(s.sales_amount)+'</b><small>Confirmed monetary sales</small></div>'+
      '<div class="daily-stat"><span>Fuel received</span><b>'+liters(s.purchases_liters)+' L</b><small>Purchase records for the day</small></div>'+
      '<div class="daily-stat"><span>Completed shifts</span><b>'+Number(s.completed_shifts||0)+'</b><small>Individual shift reconciliations</small></div>';

    const rows=Object.entries(s.by_product||{}).sort((a,b)=>Number(b[1]?.liters||0)-Number(a[1]?.liters||0)).map(([p,v])=>
      '<tr><td><b>'+h(codeForProduct(p))+'</b></td><td>'+liters(v.liters)+'</td></tr>'
    ).join('');
    document.getElementById('report-table').innerHTML=rows||'<tr><td colspan="2" class="daily-empty">No fuel sales for this date.</td></tr>';

    const payments=Object.entries(s.sales_by_type||{}).sort((a,b)=>Number(b[1])-Number(a[1])).map(([type,amount])=>
      '<div class="daily-list-row"><span>'+h(type)+'</span><b>'+money(amount)+'</b></div>'
    ).join('');
    document.getElementById('report-payments').innerHTML=payments||'<div class="daily-empty">No sales methods recorded.</div>';

    const purchaseRows=(r.purchases||[]).map(x=>{
      const tank=(x.tank_id&&r.tanks_by_id?.[x.tank_id])||{};
      return '<tr><td><b>'+h(codeForProduct(x.product))+'</b></td><td>'+liters(x.quantity_liters)+'</td><td>'+h(tank.tank_code||'—')+'</td></tr>';
    }).join('');
    document.getElementById('report-purchases').innerHTML=purchaseRows||'<tr><td colspan="3" class="daily-empty">No fuel received.</td></tr>';

    // 1) Individual shifts — every shift started on the selected date is
    // shown separately, even when the same dispenser has multiple shifts.
    const shifts=(r.shift_summary||[]).map((x,index)=>{
      const variance=Number(x.tank_variance_liters||0);
      const vc=dailyReportVarianceClass(variance);
      const openingRows=(x.opening_readings||[]).map((v,i)=>
        '<span>Nozzle '+(i+1)+': <b>'+reading(v.reading)+'</b></span>'
      ).join('');
      const closingRows=(x.closing_readings||[]).map((v,i)=>
        '<span>Nozzle '+(i+1)+': <b>'+reading(v.reading)+'</b></span>'
      ).join('');
      return '<article class="daily-shift-card">'+
        '<div class="daily-shift-head"><div><b>Shift '+(index+1)+' · '+h(x.attendant||'Unknown')+'</b><span>'+h(x.dispenser||'—')+' · '+h(codeForProduct(x.product))+' · '+h(x.tank||'—')+'</span></div><span class="daily-shift-time">'+h(dailyReportTime(x.started_at))+' → '+h(dailyReportTime(x.ended_at))+'</span></div>'+
        '<div class="daily-shift-grid">'+
          '<div><span>Fuel sold</span><b>'+liters(x.sales_liters)+' L</b></div>'+
          '<div><span>Sales amount</span><b>'+money(x.sales_amount)+'</b></div>'+
          '<div><span>Tank opening</span><b>'+liters(x.tank_opening_liters)+' L</b></div>'+
          '<div><span>Tank closing</span><b>'+liters(x.tank_closing_liters)+' L</b></div>'+
        '</div>'+
        '<div class="daily-shift-reading-row"><div><span>Opening meter</span><div>'+ (openingRows||'<span>—</span>') +'</div></div><div><span>Closing meter</span><div>'+ (closingRows||'<span>—</span>') +'</div></div></div>'+
        '<div class="daily-shift-foot"><span>Receiver: '+h(x.receiver||'—')+'</span><span class="daily-variance '+vc+'">Tank variance: '+liters(variance)+' L</span></div>'+
      '</article>';
    }).join('');
    document.getElementById('report-shifts').innerHTML=shifts||'<div class="daily-empty">No shifts started on this date.</div>';

    // 2) Combined dispenser/day reconciliation — first shift establishes
    // the opening boundary and last shift establishes the closing boundary.
    const combined=(r.dispenser_summary||[]).map(x=>{
      const opening=(x.opening_readings||[]).map((v,i)=>
        '<span>Nozzle '+(i+1)+': <b>'+reading(v.reading)+'</b></span>'
      ).join('');
      const closing=(x.closing_readings||[]).map((v,i)=>
        '<span>Nozzle '+(i+1)+': <b>'+reading(v.reading)+'</b></span>'
      ).join('');
      const shiftLines=(x.shifts||[]).map((z,i)=>
        '<div class="daily-combined-shift"><span>Shift '+(i+1)+' · '+h(z.attendant||'Unknown')+'</span><b>'+liters(z.sales_liters)+' L</b><b>'+money(z.sales_amount)+'</b></div>'
      ).join('');
      const methodLines=Object.entries(x.sales_by_method||{}).sort((a,b)=>Number(b[1])-Number(a[1])).map(([method,amount])=>
        '<div class="daily-combined-method"><span>'+h(method)+'</span><b>'+money(amount)+'</b></div>'
      ).join('');
      return '<article class="daily-shift-card daily-combined-card">'+
        '<div class="daily-shift-head"><div><b>'+h(x.dispenser||'—')+'</b><span>'+h(codeForProduct(x.product))+' · '+h(x.tank||'—')+' · '+Number(x.shift_count||0)+' shift(s)</span></div><span class="daily-shift-time">'+h(dailyReportTime(x.first_shift_started_at))+' → '+h(dailyReportTime(x.last_shift_ended_at))+'</span></div>'+
        '<div class="daily-shift-grid">'+
          '<div><span>Combined fuel sold</span><b>'+liters(x.sales_liters)+' L</b></div>'+
          '<div><span>Combined sales</span><b>'+money(x.sales_amount)+'</b></div>'+
          '<div><span>First shift tank opening</span><b>'+liters(x.opening_tank_liters)+' L</b></div>'+
          '<div><span>Last shift tank closing</span><b>'+liters(x.closing_tank_liters)+' L</b></div>'+
        '</div>'+
        '<div class="daily-shift-reading-row"><div><span>First shift opening meter</span><div>'+ (opening||'<span>—</span>') +'</div></div><div><span>Last shift closing meter</span><div>'+ (closing||'<span>—</span>') +'</div></div></div>'+
        '<div class="daily-combined-shifts">'+
          '<div class="daily-combined-label">Sales by shift</div>'+shiftLines+
        '</div>'+
        '<div class="daily-combined-methods">'+
          '<div class="daily-combined-label">Sales by method</div>'+(methodLines||'<div class="daily-empty">No sales method records.</div>')+
        '</div>'+
        '<div class="daily-shift-foot"><span>Opening → closing tank change: '+liters(x.tank_change_liters)+' L</span><span class="daily-variance '+dailyReportVarianceClass(x.tank_change_liters)+'">Dispenser total: '+liters(x.sales_liters)+' L</span></div>'+
      '</article>';
    }).join('');
    document.getElementById('report-combined').innerHTML=combined||'<div class="daily-empty">No dispenser sales to combine.</div>';

    // 3) Final station-wide total — this is the last level of the report.
    // It is summed from the already-combined dispenser totals.
    const station=r.station_summary||{};
    const stationMethods=Object.entries(station.sales_by_method||{}).sort((a,b)=>Number(b[1])-Number(a[1])).map(([method,amount])=>
      '<div class="daily-station-method"><span>'+h(method)+'</span><b>'+money(amount)+'</b></div>'
    ).join('');
    const stationDispensers=(station.dispensers||[]).map(x=>
      '<div class="daily-station-dispenser"><div><b>'+h(x.dispenser||'—')+'</b><small>'+h(codeForProduct(x.product))+' · '+Number(x.shift_count||0)+' shift(s)</small></div><strong>'+liters(x.sales_liters)+' L</strong><strong>'+money(x.sales_amount)+'</strong></div>'
    ).join('');
    const stationEl=document.getElementById('report-station-total');
    if(stationEl)stationEl.innerHTML=
      '<div class="daily-station-total-grid">'+
        '<div class="daily-station-total-main"><span>Total fuel sold</span><b>'+liters(station.sales_liters)+' L</b></div>'+
        '<div><span>Total sales</span><b>'+money(station.sales_amount)+'</b></div>'+
        '<div><span>Dispensers</span><b>'+Number(station.dispenser_count||0)+'</b></div>'+
        '<div><span>Shifts</span><b>'+Number(station.shift_count||0)+'</b></div>'+
      '</div>'+
      '<div class="daily-station-breakdown">'+
        '<div class="daily-combined-label">Combined sales by method</div>'+
        (stationMethods||'<div class="daily-empty">No sales method records.</div>')+
      '</div>'+
      '<div class="daily-station-breakdown">'+
        '<div class="daily-combined-label">Dispenser contribution</div>'+
        (stationDispensers||'<div class="daily-empty">No dispenser sales.</div>')+
      '</div>';

    status.textContent='';
  }catch(e){
    status.textContent=e.message||'Unable to load the daily report.';
    document.getElementById('report-summary').innerHTML='';
    document.getElementById('report-table').innerHTML='';
    document.getElementById('report-payments').innerHTML='';
    document.getElementById('report-purchases').innerHTML='';
    document.getElementById('report-shifts').innerHTML='';
    const combined=document.getElementById('report-combined');
    if(combined)combined.innerHTML='';
    const station=document.getElementById('report-station-total');
    if(station)station.innerHTML='';
  }
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
async function saveTankEdit(event){
  event.preventDefault();
  const id=document.getElementById('edit-tank-id').value,old=settingsRecord(window.tankRecords,id);
  const cap=document.getElementById('edit-tank-capacity').value;
  const details='<p><b>Tank:</b> '+h(old.tank_code||id)+'</p>'+settingsDiff('Capacity',liters(old.capacity_liters),liters(cap),'L');
  showSettingsConfirmation('Review Tank Update',details,()=>_saveTankEdit(event),'Tank updated successfully','<p><b>'+h(old.tank_code||id)+'</b> was updated successfully.</p>'+details);
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
      const nextGroup=cards.find(x=>x.dataset.tankProductGroup!==state.groupKey&&x.dataset.dispenserProductGroup!==state.groupKey);
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
  const groupKey=(handle.dataset.settingsKey==='tanks'||handle.dataset.settingsKey==='dispensers')
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

// Explicit page entry exports for the boot loader.
window.adminDashboard=adminDashboard;
window.adminSalesConfirmations=adminSalesConfirmations;
window.adminSettings=adminSettings;
window.userDashboard=userDashboard;
