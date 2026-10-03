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
  const pendingReorder=window.pendingSettingsReorder;
  window.pendingSettingsReorder=null;
  window.pendingSettingsAction=null;
  window.pendingSettingsSuccess=null;
  if(pendingReorder)setTimeout(()=>loadSettingsData(),0);
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
  closeTakeoverSaleConfirm();
  if(window.pendingTakeoverSaleId){
    const modal=document.getElementById('takeover-sale-modal');
    if(modal){modal.classList.add('open');modal.setAttribute('aria-hidden','false');}
  }
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
      api('/api/shifts'),api('/api/nozzles'),api('/api/products'),api('/api/tanks'),api('/api/handovers'),api('/api/users'),api('/api/shift-takeovers'),api('/api/sale-types').catch(()=>[])
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
          '<div class="handover-pending-main"><span>Tank closing stock</span><strong>'+liters(x.closing_liters)+' L</strong></div>'+
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

    const takeoverList=Array.isArray(takeovers)?takeovers.filter(x=>String(x.from_employee_id)===String(me.id)):[];
    const pendingTakeovers=takeoverList.filter(x=>x.sales_status==='pending_admin');
    const readyTakeovers=takeoverList.filter(x=>x.sales_status==='awaiting_attendant'||x.sales_status==='cancelled');
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
        '<div class="takeover-hero"><div class="takeover-hero-icon">◷</div><div><div class="takeover-card-title">Pending Sale Confirmation</div><div class="takeover-card-subtitle">'+h(takeoverDispenser)+' • Waiting for admin</div></div></div>'+
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
    const takeoverHtml=readyTakeovers.slice(0,5).map(t=>{
      const takeoverShift=shifts.find(s=>String(s.id)===String(t.shift_id));
      const takeoverNozzle=nozzles.find(n=>String(n.id)===String(takeoverShift?.nozzle_id));
      const takeoverDispenser=takeoverNozzle?.nozzle_code||t.dispenser_code||'Dispenser';
      return '<div class="card shift-takeover-card">'+
        '<div class="takeover-hero"><div class="takeover-hero-icon">↔</div><div><div class="takeover-card-title">Shift Handover</div><div class="takeover-card-subtitle">'+h(takeoverDispenser)+'</div></div></div>'+
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
          '<div class="pending-tank-opening active-opening-reading"><span class="pending-info-icon tank-icon">▤</span><div><span class="pending-label">Tank opening reading</span><strong>'+liters(s.opening_tank_liters)+' <small>L</small></strong></div></div>'+
        '</div>'+
        '<div class="pending-nozzle-section active-reading-section"><div class="pending-nozzle-heading"><span class="pending-section-icon">⌁</span> Shift nozzle readings</div>'+
          nozzleReadings+
        '</div>'+
        '<div class="row active-shift-actions"><button class="btn active-handover-btn" type="button" onclick="openDashboardHandover(\''+s.id+'\')">Handover</button>'+
        '<button class="primary active-close-shift" type="button" onclick="closeShift(event,\''+s.id+'\')">Close Shift</button></div></div>';
    }).join('');

    box.innerHTML=pendingShiftHtml+pendingTakeoverHtml+pendingOutgoingHtml+pendingIncomingHtml+activeHtml;
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
    const [shifts,nozzles,products,employees,tanks,takeovers]=await Promise.all([
      api('/api/shifts'),api('/api/nozzles'),api('/api/products'),api('/api/users'),api('/api/tanks'),api('/api/shift-takeovers').catch(()=>[])
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
    const pendingTakeoverShiftIds=new Set((Array.isArray(takeovers)?takeovers:[])
      .filter(t=>!t.sales_recorded_at)
      .map(t=>String(t.shift_id)));
    const history=mine.filter(s=>s.status!=='assigned'&&!pendingTakeoverShiftIds.has(String(s.id)));
    const confirmedTakeovers=(Array.isArray(takeovers)?takeovers:[]).filter(t=>String(t.from_employee_id)===String(me.id)&&(t.sales_status==='confirmed'||(!t.sales_status&&t.sales_recorded_at)));
    const historyBox=document.getElementById('shift-history');
    if(historyBox){
      const shiftHistoryHtml=history.map(s=>{
        const n=nozzles.find(x=>x.id===s.nozzle_id);
        return '<div class="card"><div class="top"><h3>Shift '+h(s.id.slice(0,8))+'</h3><span class="badge">'+h(s.status)+'</span></div><p>Dispenser: <b>'+h(n?.nozzle_code||s.nozzle_id)+'</b> • '+h(codeForProduct(n?.product||''))+'</p><p>Opening meter: <b>'+liters(s.opening_reading)+'</b> • Closing meter: <b>'+liters(s.closing_reading)+'</b></p><p class="muted">'+(s.start_time?'Started: '+new Date(s.start_time).toLocaleString():'Assigned: '+new Date(s.assigned_at||s.created_at).toLocaleString())+(s.end_time?' • Ended: '+new Date(s.end_time).toLocaleString():'')+'</p></div>';
      }).join('');
      const takeoverHistoryHtml=confirmedTakeovers.map(t=>{
        const takeoverShift=shifts.find(s=>String(s.id)===String(t.shift_id));
        const n=nozzles.find(x=>String(x.id)===String(takeoverShift?.nozzle_id));
        return '<div class="card shift-takeover-history-card"><div class="top"><div><span class="section-kicker">SHIFT HANDOVER</span><h3>'+h(n?.nozzle_code||'Dispenser')+'</h3></div><span class="badge">Sales confirmed</span></div><p>Shift ended: <b>'+new Date(t.shift_ended_at).toLocaleString()+'</b></p><p>Receiving attendant: <b>'+h(employees.find(e=>String(e.id)===String(t.to_employee_id))?.name||t.to_employee_id||'—')+'</b></p><p>Sales: <b>'+liters(t.total_sales_liters)+' L</b> • <b>'+money(t.total_sales_amount)+'</b></p><p class="muted">Sales confirmed: '+(t.sales_confirmed_at?new Date(t.sales_confirmed_at).toLocaleString():'—')+'</p></div>';
      }).join('');
      const allHistory=[...history.map(s=>({time:new Date(s.start_time||s.assigned_at||s.created_at),html:s})),...confirmedTakeovers.map(t=>({time:new Date(t.shift_ended_at),html:t}))].sort((a,b)=>b.time-a.time);
      historyBox.innerHTML=allHistory.length?allHistory.map(item=>{
        if(item.html?.shift_ended_at)return takeoverHistoryHtml.split('</div><div class="card')[0]?takeoverHistoryHtml:''; 
        return shiftHistoryHtml;
      }).join(''):'<div class="card"><p>No shift history yet.</p></div>';
      // Render the two history groups in chronological order without duplicating records.
      const records=[];
      history.forEach(s=>records.push({time:new Date(s.start_time||s.assigned_at||s.created_at),html:shiftHistoryHtml ? '<div class="card"><div class="top"><h3>Shift '+h(s.id.slice(0,8))+'</h3><span class="badge">'+h(s.status)+'</span></div><p>Dispenser: <b>'+h(nozzles.find(x=>x.id===s.nozzle_id)?.nozzle_code||s.nozzle_id)+'</b> • '+h(codeForProduct(nozzles.find(x=>x.id===s.nozzle_id)?.product||''))+'</p><p>Opening meter: <b>'+liters(s.opening_reading)+'</b> • Closing meter: <b>'+liters(s.closing_reading)+'</b></p><p class="muted">'+(s.start_time?'Started: '+new Date(s.start_time).toLocaleString():'Assigned: '+new Date(s.assigned_at||s.created_at).toLocaleString())+(s.end_time?' • Ended: '+new Date(s.end_time).toLocaleString():'')+'</p></div>': ''}));
      confirmedTakeovers.forEach(t=>records.push({time:new Date(t.shift_ended_at),html:'<div class="card shift-takeover-history-card"><div class="top"><div><span class="section-kicker">SHIFT HANDOVER</span><h3>'+h(nozzles.find(x=>String(x.id)===String(shifts.find(s=>String(s.id)===String(t.shift_id))?.nozzle_id))?.nozzle_code||'Dispenser')+'</h3></div><span class="badge">Sales confirmed</span></div><p>Shift ended: <b>'+new Date(t.shift_ended_at).toLocaleString()+'</b></p><p>Receiving attendant: <b>'+h(employees.find(e=>String(e.id)===String(t.to_employee_id))?.name||t.to_employee_id||'—')+'</b></p><p>Sales: <b>'+liters(t.total_sales_liters)+' L</b> • <b>'+money(t.total_sales_amount)+'</b></p><p class="muted">Sales confirmed: '+(t.sales_confirmed_at?new Date(t.sales_confirmed_at).toLocaleString():'—')+'</p></div>'}));
      historyBox.innerHTML=records.sort((a,b)=>b.time-a.time).map(x=>x.html).join('')||'<div class="card"><p>No shift history yet.</p></div>';
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
    await window.stationCurrencyReady;
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
async function adminSalesConfirmations(){
  try{
    const me=await currentUser();
    if(me.role!=='admin')return location.href='admin-login.html';
    await window.stationCurrencyReady;
    const list=await api('/api/sales/confirmations');
    const box=document.getElementById('sales-confirmation-list');
    if(!box)return;
    if(!Array.isArray(list)||!list.length){
      box.innerHTML='<div class="card"><p class="muted">No pending sales confirmations.</p></div>';
      return;
    }
    box.innerHTML=list.map(item=>{
      const t=item.takeover||{};
      const sales=Array.isArray(item.sales)?item.sales:[];
      const dispenser=item.dispenser?.name||'Dispenser';
      const shift=item.shift?.name||((item.from_employee?.name||'')+' → '+(item.to_employee?.name||''));
      const checked=sales.map(s=>'<label class="admin-sale-check-row"><input type="checkbox" class="admin-sale-check" data-sale-id="'+h(s.id)+'"><span><strong>'+h(s.sale_type_name||'Sale')+'</strong><small>'+(s.sale_type_description?h(s.sale_type_description)+' • ':'')+'Amount: '+money(s.amount)+(s.reason?' • Reason: '+h(s.reason):'')+'</small></span></label>').join('');
      return '<div class="card admin-sale-confirm-card" data-takeover-id="'+h(t.id)+'">'+
        '<div class="top"><div><span class="section-kicker">SALE CONFIRMATION</span><h3>'+h(dispenser)+'</h3><p class="muted">'+h(shift)+'</p></div><span class="pending-sale-badge">Pending</span></div>'+
        '<div class="admin-sale-context"><div><span>Shift started</span><strong>'+new Date(t.shift_started_at).toLocaleString()+'</strong></div><div><span>Shift ended</span><strong>'+new Date(t.shift_ended_at).toLocaleString()+'</strong></div><div><span>Liters sold</span><strong>'+liters(t.total_sales_liters)+' L</strong></div><div><span>Calculated amount</span><strong>'+money(t.total_sales_amount)+'</strong></div></div>'+
        '<div class="admin-sale-check-section"><div class="takeover-detail-heading">Sales to check</div>'+checked+'</div>'+
        '<div class="admin-sale-total"><span>Submitted sales total</span><strong>'+money(sales.reduce((sum,x)=>sum+Number(x.amount||0),0))+'</strong></div>'+
        '<div class="row"><button type="button" onclick="cancelAdminSaleConfirmation(\''+t.id+'\')">Cancel</button><button type="button" class="primary" onclick="confirmAdminSaleConfirmation(\''+t.id+'\')">Confirm</button></div>'+
      '</div>';
    }).join('');
  }catch(e){
    const box=document.getElementById('sales-confirmation-status');
    if(box)box.textContent=e.message;
    if(e.message==='Unauthorized')location.href='admin-login.html';
  }
}
async function confirmAdminSaleConfirmation(id){
  const card=document.querySelector('.admin-sale-confirm-card[data-takeover-id="'+id+'"]');
  const ids=Array.from(card?.querySelectorAll('.admin-sale-check:checked')||[]).map(x=>x.getAttribute('data-sale-id'));
  const total=card?.querySelectorAll('.admin-sale-check').length||0;
  if(!ids.length||ids.length!==total){toast('Tick every sale before confirming');return;}
  try{
    await api('/api/sales/confirmations/'+id+'/confirm',{method:'POST',body:JSON.stringify({checked_sale_ids:ids})});
    toast('Sales confirmed');
    await adminSalesConfirmations();
  }catch(e){toast(e.message);}
}
async function cancelAdminSaleConfirmation(id){
  if(!confirm('Cancel this pending sale record? The attendant will be able to record it again.'))return;
  try{
    await api('/api/sales/confirmations/'+id+'/cancel',{method:'POST',body:'{}'});
    toast('Sale confirmation cancelled');
    await adminSalesConfirmations();
  }catch(e){toast(e.message);}
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
  document.getElementById('tanks').innerHTML=tanks.length?tanks.map(t=>`<div class="card settings-item-card ${t.active!==false?'settings-active-card':''}" data-settings-key="tanks" data-settings-id="${t.id}" onclick="toggleSettingsItem(event,this)"><div class="top"><button type="button" class="settings-move-handle" title="Hold and drag to move" aria-label="Hold and drag to move" onclick="event.stopPropagation()">⋮</button><div><b>${h(t.tank_code)} — ${h(codeForProduct(t.product))}</b><div class="settings-card-details"><div><span>Capacity:</span> <b>${liters(t.capacity_liters)} L</b></div><div><span>Status:</span> <b>${t.active===false?'Inactive':'Active'}</b></div><div><span>Opening stock:</span> <b>${t.opening_stock_liters==null?'Not recorded':liters(t.opening_stock_liters)+' L'}</b></div></div></div><div class="row settings-card-actions"><button type="button" class="settings-toggle-action" onclick="toggleTank('${t.id}',${t.active!==false})">${t.active===false?'Activate':'Deactivate'}</button><button type="button" onclick="openTankEdit('${t.id}')">Edit</button><button type="button" class="settings-remove-action" onclick="removeTank('${t.id}')">Remove</button></div></div></div>`).join(''):'<p class="muted">No tanks.</p>';
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
      return '<div class="card settings-item-card dispenser-settings-card dispenser-pending-card" data-settings-key="dispensers" data-settings-id="'+pending.id+'" onclick="toggleSettingsItem(event,this)">'+
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
    return '<div class="card settings-item-card dispenser-settings-card '+(n.active?'dispenser-active-card':'')+'" data-settings-key="dispensers" data-settings-id="'+h(n.id)+'" onclick="toggleSettingsItem(event,this)">'+
      '<div class="dispenser-card-head"><button type="button" class="settings-move-handle" title="Hold and drag to move" aria-label="Hold and drag to move" onclick="event.stopPropagation()">⋮</button><div><span class="section-kicker">FUEL DISPENSER</span><h3>'+h(n.nozzle_code)+'</h3><div class="dispenser-product">'+h(productCode)+' <span>•</span> '+h(nozzleLabel)+'</div></div>'+
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
      closing_liters:null
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
    if(nozzleInputs){
      nozzleInputs.innerHTML=nozzleIds.map((id,i)=>
        '<label class="handover-nozzle-input"><span>Nozzle '+(i+1)+' — '+h(id)+'</span><input id="handover-nozzle-reading-'+i+'" type="number" min="0" step="0.01" placeholder="Enter closing meter reading" required></label>'
      ).join('');
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
      '<div class="handover-review-main"><span>Tank closing stock</span><strong>'+closingLiters.toLocaleString(undefined,{maximumFractionDigits:2})+' L</strong></div>'+
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
    await window.stationCurrencyReady;
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

function initSettingsItemDrag(){
document.querySelectorAll('.settings-move-handle:not([data-drag-bound])').forEach(handle=>{
handle.dataset.dragBound='1';let state=null,timer=null;
const cleanup=()=>{if(timer){clearTimeout(timer);timer=null;}document.querySelectorAll('.settings-drag-ghost,.settings-drag-placeholder').forEach(x=>x.remove());document.querySelectorAll('.settings-dragging').forEach(x=>x.classList.remove('settings-dragging'));state=null;};
handle.addEventListener('pointerdown',e=>{if(e.button!==undefined&&e.button!==0)return;e.preventDefault();const card=handle.closest('.settings-item-card'),container=card?.parentElement;if(!card||!container)return;const rect=card.getBoundingClientRect();state={card,container,key:handle.dataset.settingsKey,original:settingsOrderFromContainer(container),startY:e.clientY,startX:e.clientX,dragging:false,rect};timer=setTimeout(()=>{if(!state)return;state.dragging=true;card.classList.add('settings-dragging');const placeholder=document.createElement('div');placeholder.className='settings-drag-placeholder';placeholder.style.height=rect.height+'px';state.placeholder=placeholder;card.after(placeholder);const ghost=card.cloneNode(true);ghost.classList.add('settings-drag-ghost');ghost.classList.remove('expanded');ghost.style.width=rect.width+'px';ghost.style.left=rect.left+'px';ghost.style.top=rect.top+'px';document.body.appendChild(ghost);state.ghost=ghost;state.offsetY=e.clientY-rect.top;try{handle.setPointerCapture(e.pointerId);}catch(_){}},220);});
handle.addEventListener('pointermove',e=>{if(!state)return;if(!state.dragging){if(Math.hypot(e.clientX-state.startX,e.clientY-state.startY)>10){if(timer){clearTimeout(timer);timer=null;}cleanup();}return;}e.preventDefault();if(state.ghost)state.ghost.style.transform='translate3d(0,'+(e.clientY-state.rect.top-state.offsetY)+'px,0)';const siblings=Array.from(state.container.querySelectorAll(':scope > .settings-item-card[data-settings-id]')).filter(x=>x!==state.card);const target=siblings.find(x=>e.clientY<x.getBoundingClientRect().top+x.getBoundingClientRect().height/2);if(target)state.container.insertBefore(state.placeholder,target);else state.container.appendChild(state.placeholder);});
const end=e=>{if(!state)return;if(timer){clearTimeout(timer);timer=null;}if(!state.dragging){cleanup();return;}if(state.ghost)state.ghost.remove();state.card.classList.remove('settings-dragging');state.container.insertBefore(state.card,state.placeholder);state.placeholder.remove();try{handle.releasePointerCapture(e.pointerId);}catch(_){}const s=state;state=null;const current=settingsOrderFromContainer(s.container);if(current.join('|')===s.original.join('|')){loadSettingsData();return;}const label=s.key==='products'?'products':s.key==='saleTypes'?'sale types':s.key==='employees'?'users':s.key==='tanks'?'fuel tanks':'fuel dispensers';showSettingsConfirmation('Save New '+label+' Order','<p>The '+h(label)+' order was changed.</p><p><b>Save these new positions?</b></p>',async()=>{try{await api('/api/settings/reorder',{method:'POST',body:JSON.stringify({key:s.key,ids:current})});await loadSettingsData();}catch(err){await loadSettingsData();throw err;}},'Order saved successfully','<p>The new '+h(label)+' positions have been saved.</p>');};
handle.addEventListener('pointerup',end);handle.addEventListener('pointercancel',()=>{if(state)cleanup();});});}

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
