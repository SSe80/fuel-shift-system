
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
  if(modal){modal.classList.remove('open','takeover-details-force');modal.setAttribute('aria-hidden','true');}
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
  if(modal){modal.classList.add('open','takeover-details-force');modal.setAttribute('aria-hidden','false');}
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

async function ensureTakeoverDetailsStyle(){
  if(document.getElementById('takeover-details-runtime-style'))return;
  const style=document.createElement('style');
  style.id='takeover-details-runtime-style';
  style.textContent=[
    '#admin-sale-history-details.open{position:fixed!important;inset:0!important;z-index:99999!important;display:flex!important;align-items:center!important;justify-content:center!important;padding:12px!important;box-sizing:border-box!important;background:rgba(15,23,42,.62)!important}',
    '#admin-sale-history-details.open .admin-sale-review-card{position:relative!important;width:min(560px,calc(100vw - 24px))!important;max-width:560px!important;max-height:86vh!important;margin:0!important;padding:0!important;display:flex!important;flex-direction:column!important;overflow:hidden!important;border:1px solid #dfe5ec!important;border-radius:16px!important;background:#fff!important;box-shadow:0 28px 80px rgba(15,23,42,.28)!important}',
    '#admin-sale-history-details.open .admin-sale-review-card>.top{display:flex!important;align-items:center!important;justify-content:space-between!important;gap:12px!important;padding:13px 15px 11px!important;background:#fff!important;border-bottom:1px solid #e8edf2!important}',
    '#admin-sale-history-details.open .admin-sale-history-detail-actions{display:flex!important;align-items:center!important;gap:7px!important;margin-left:auto!important}',
    '#admin-sale-history-details.open .admin-sale-history-detail-actions button{min-height:34px!important}',
    '#admin-sale-history-details.open .admin-sale-review-card>.top h3{margin:0!important;font-size:18px!important;color:#182230!important}',
    '#admin-sale-history-details.open .admin-sale-review-card>.top .section-kicker{display:block!important;margin:0 0 4px!important;font-size:9px!important;font-weight:900!important;letter-spacing:.12em!important;color:#b4232f!important}',
    '#admin-sale-history-details.open .modal-close{width:34px!important;height:34px!important;padding:0!important;border:1px solid #dfe5ec!important;border-radius:9px!important;background:#f8fafc!important;color:#344054!important;font-size:21px!important;line-height:1!important}',
    '#admin-sale-history-details.open #admin-sale-history-details-content{display:block!important;flex:1 1 auto!important;min-height:0!important;max-height:70vh!important;overflow:auto!important;padding:0 12px 6px!important;background:#f7f9fc!important}',
    '#admin-sale-history-details.open .history-detail-overview{display:flex!important;align-items:center!important;justify-content:space-between!important;gap:12px!important;margin-top:10px!important;padding:15px!important;border:1px solid #e1e7ef!important;border-radius:13px!important;background:#fff!important}',
    '#admin-sale-history-details.open .history-detail-overview h4{margin:0!important;font-size:17px!important;color:#182230!important}',
    '#admin-sale-history-details.open .history-detail-overview p{margin:4px 0 0!important;font-size:11px!important;color:#667085!important}',
    '#admin-sale-history-details.open .history-detail-status{padding:6px 10px!important;border:1px solid #b7e1c8!important;border-radius:999px!important;background:#effaf3!important;color:#18794e!important;font-size:10px!important;font-weight:850!important;white-space:nowrap!important}',
    '#admin-sale-history-details.open .history-detail-info-grid{display:grid!important;grid-template-columns:repeat(3,1fr)!important;gap:1px!important;margin-top:10px!important;border:1px solid #e1e7ef!important;border-radius:12px!important;overflow:hidden!important;background:#e1e7ef!important}',
    '#admin-sale-history-details.open .history-detail-info-grid>div{padding:11px!important;background:#fff!important}',
    '#admin-sale-history-details.open .history-detail-info-grid span{display:block!important;font-size:8px!important;text-transform:uppercase!important;letter-spacing:.05em!important;color:#98a2b3!important;font-weight:850!important}',
    '#admin-sale-history-details.open .history-detail-info-grid strong{display:block!important;margin-top:4px!important;font-size:11px!important;color:#344054!important;overflow-wrap:anywhere!important}',
    '#admin-sale-history-details.open .history-detail-section{margin-top:10px!important;border:1px solid #e1e7ef!important;border-radius:12px!important;overflow:hidden!important;background:#fff!important}',
    '#admin-sale-history-details.open .history-detail-section-head{padding:10px 12px!important;background:#fbfcfe!important;border-bottom:1px solid #e8edf2!important;font-size:11px!important;font-weight:850!important;color:#344054!important}',
    '#admin-sale-history-details.open .history-detail-reading-row{display:grid!important;grid-template-columns:minmax(110px,1.4fr) repeat(3,1fr)!important;gap:8px!important;align-items:center!important;padding:10px 11px!important;border-bottom:1px solid #edf1f4!important;background:#fff!important}',
    '#admin-sale-history-details.open .history-detail-reading-row strong{font-size:10px!important;color:#344054!important}',
    '#admin-sale-history-details.open .history-detail-reading-row small{display:block!important;margin-top:3px!important;font-size:8px!important;color:#b4232f!important}',
    '#admin-sale-history-details.open .history-detail-reading-row span{display:block!important;font-size:8px!important;color:#98a2b3!important}',
    '#admin-sale-history-details.open .history-detail-reading-row b{display:block!important;margin-top:3px!important;font-size:10px!important;color:#344054!important}',
    '#admin-sale-history-details.open .history-detail-sale{display:flex!important;justify-content:space-between!important;gap:12px!important;padding:10px 12px!important;border-bottom:1px solid #edf1f4!important;background:#fff!important}',
    '#admin-sale-history-details.open .history-detail-sale>div{min-width:0!important}',
    '#admin-sale-history-details.open .history-detail-sale strong{font-size:10px!important;color:#344054!important}',
    '#admin-sale-history-details.open .history-detail-sale small,#admin-sale-history-details.open .history-detail-sale em{display:block!important;margin-top:3px!important;font-size:8px!important;color:#98a2b3!important}',
    '#admin-sale-history-details.open .history-detail-sale>strong{font-size:11px!important;color:#182230!important;white-space:nowrap!important}',
    '#admin-sale-history-details.open .history-detail-total-row{display:flex!important;align-items:center!important;justify-content:space-between!important;gap:10px!important;padding:11px 12px!important;background:#fbfcfe!important;border-top:1px solid #e2e8f0!important}',
    '#admin-sale-history-details.open .admin-sale-review-card>.row{display:flex!important;justify-content:flex-end!important;gap:8px!important;margin:0!important;padding:10px 14px 13px!important;border-top:1px solid #e8edf2!important;background:#fff!important}',
    '#admin-sale-history-details.open .admin-sale-review-card>.row button{min-width:92px!important;min-height:38px!important;border-radius:9px!important;font-size:11px!important;font-weight:850!important}',
    '@media(max-width:600px){#admin-sale-history-details.open{padding:8px!important}#admin-sale-history-details.open .admin-sale-review-card{width:calc(100vw - 16px)!important;max-width:none!important;max-height:90vh!important;border-radius:15px!important}#admin-sale-history-details.open .history-detail-info-grid{grid-template-columns:1fr 1fr!important}}'
  ].join('');
  document.head.appendChild(style);
}

async function openTakeoverDetails(id){
  const takeovers=Array.isArray(window.takeoverRecords)?window.takeoverRecords:[];
  const takeover=takeovers.find(x=>String(x.id)===String(id));
  const modal=document.getElementById('admin-sale-history-details');
  const box=document.getElementById('admin-sale-history-details-content');
  if(!takeover){
    if(box)box.innerHTML='<div class="history-detail-section"><p class="muted">Shift details could not be found.</p></div>';
    if(modal){modal.classList.add('open');modal.setAttribute('aria-hidden','false');}
    return;
  }
  const shifts=Array.isArray(window.dashboardShiftRecords)?window.dashboardShiftRecords:[];
  const nozzles=Array.isArray(window.dashboardNozzleRecords)?window.dashboardNozzleRecords:[];
  const employees=Array.isArray(window.dashboardEmployeeRecords)?window.dashboardEmployeeRecords:[];
  const tanks=Array.isArray(window.dashboardTankRecords)?window.dashboardTankRecords:[];
  const products=Array.isArray(window.dashboardProductRecords)?window.dashboardProductRecords:[];
  const shift=shifts.find(s=>String(s.id)===String(takeover.shift_id));
  const nozzle=nozzles.find(n=>String(n.id)===String(shift?.nozzle_id));
  const employee=employees.find(e=>String(e.id)===String(takeover.to_employee_id));
  const tank=tanks.find(t=>String(t.id)===String(takeover.tank_id||nozzle?.tank_id));
  const product=products.find(p=>String(p.id)===String(tank?.product_id)||String(p.name||'').toLowerCase()===String(tank?.product||'').toLowerCase());
  const item={takeover:takeover,sales:[],dispenser:nozzle?{nozzle_code:nozzle.nozzle_code,nozzle_id:nozzle.id,name:nozzle.nozzle_code}:null,tank:tank||null,product:product||null,to_employee:employee||null,shift:shift||null};
  window.__attendantTakeoverDetailsItem=item;
  if(typeof adminSalesHistoryData!=='undefined')adminSalesHistoryData={history:[item]};
  await ensureTakeoverDetailsStyle();
  const renderer=window.openAdminSaleHistoryDetails;
  if(typeof renderer==='function'){
    renderer(id);
    return;
  }
  if(box)box.innerHTML='<div class="history-detail-section"><p class="muted">Shift details are unavailable.</p></div>';
  if(modal){modal.classList.add('open');modal.setAttribute('aria-hidden','false');}
}

window.openTakeoverDetails=openTakeoverDetails;

function closeTakeoverDetails(){
  const modal=document.getElementById('takeover-details-modal');
  if(modal){modal.classList.remove('open','takeover-details-force');modal.setAttribute('aria-hidden','true');}
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
function updateDispenserDeactivationDip(value){
  const req=window.pendingDispenserDeactivationRequest||{};
  const nozzle=req.nozzle||{};
  const tanks=window.dashboardTankRecords||[];
  const tank=tanks.find(t=>String(t.id)===String(nozzle.tank_id));
  const mm=Number(value);
  const box=document.getElementById('dispenser-deactivation-tank-verification');
  if(!box)return;
  if(!tank){
    box.textContent='Connected tank calibration could not be loaded.';
    return;
  }
  const calibrationMm=Number(tank.calibration_mm);
  const calibrationLiters=Number(tank.calibration_liters);
  if(!Number.isFinite(calibrationMm)||calibrationMm<=0||!Number.isFinite(calibrationLiters)||calibrationLiters<0){
    box.textContent='Calibration is not configured for this tank.';
    return;
  }
  if(!Number.isFinite(mm)||mm<0){
    box.textContent='Calibration: '+reading(calibrationMm)+' mm = '+liters(calibrationLiters)+' L';
    return;
  }
  const equivalent=tankLitersFromDip(tank,mm);
  box.innerHTML='Calibration: <b>'+reading(calibrationMm)+' mm = '+liters(calibrationLiters)+' L</b> · Closing stock: <b>'+liters(equivalent)+' L</b>';
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
    modal.innerHTML='<div class="modal-backdrop" onclick="closeDispenserDeactivationModal()"></div><form class="modal-card form" onsubmit="prepareDispenserDeactivationReview(event)"><div class="top"><div><span class="section-kicker">DISPENSER DEACTIVATION</span><h3 id="dispenser-deactivation-title">Close active shift</h3></div><button type="button" class="modal-close" onclick="closeDispenserDeactivationModal()">×</button></div><p id="dispenser-deactivation-summary" class="muted"></p><div id="dispenser-deactivation-reading-list"></div><label>Closing tank stock (dip mm)<input id="dispenser-deactivation-tank-stock" type="number" min="0" step="1" inputmode="numeric" placeholder="Enter closing dip in mm" oninput="updateDispenserDeactivationDip(this.value)" required><small id="dispenser-deactivation-tank-verification" class="muted" style="display:block;margin-top:6px">Enter a dip to verify the calibrated liters.</small></label><label>Attendant PIN<input id="dispenser-deactivation-pin" type="password" inputmode="numeric" autocomplete="current-password" minlength="4" placeholder="Enter your PIN" required></label><p id="dispenser-deactivation-error" class="muted" style="display:none"></p><div class="row"><button type="button" onclick="closeDispenserDeactivationModal()">Cancel</button><button type="submit" class="primary">Review deactivation</button></div></form></div>';
    document.body.appendChild(modal);
  }
  const n=req.nozzle||{}, shift=req.shift||{}, readings=Array.isArray(req.nozzle_readings)?req.nozzle_readings:[];
  const title=document.getElementById('dispenser-deactivation-title');
  const summary=document.getElementById('dispenser-deactivation-summary');
  const list=document.getElementById('dispenser-deactivation-reading-list');
  if(title)title.textContent='Close '+(n.nozzle_code||'dispenser')+' shift';
  const tank=(window.dashboardTankRecords||[]).find(t=>String(t.id)===String(n.tank_id));
  if(summary)summary.innerHTML='<b>Tank:</b> '+h(tank?.tank_code||n.tank_id||'Connected tank')+' &nbsp; <b>Opening tank:</b> '+liters(shift.opening_tank_liters)+' L';
  if(list)list.innerHTML=readings.map((r,i)=>'<div class="card" style="margin:0 0 8px;padding:10px"><div class="top"><strong>'+h(r.nozzle_code||r.nozzle_id||('Nozzle '+(i+1)))+'</strong><span>Opening '+reading(r.opening_reading)+'</span></div><label>Closing reading<input class="deactivation-closing-reading" data-nozzle-id="'+h(r.nozzle_id)+'" type="number" min="'+h(r.opening_reading||0)+'" step="0.01" inputmode="decimal" placeholder="Enter closing reading" required></label></div>').join('');
  const stock=document.getElementById('dispenser-deactivation-tank-stock'); if(stock){stock.value='';updateDispenserDeactivationDip('');}
  const pin=document.getElementById('dispenser-deactivation-pin'); if(pin)pin.value='';
  const error=document.getElementById('dispenser-deactivation-error'); if(error){error.textContent='';error.style.display='none';}
  modal.classList.add('open');modal.setAttribute('aria-hidden','false');
  setTimeout(()=>document.querySelector('#dispenser-deactivation-modal .deactivation-closing-reading')?.focus(),0);
}
function closeDispenserDeactivationReview(){
  const modal=document.getElementById('dispenser-deactivation-review-modal');
  if(modal){modal.classList.remove('open');modal.setAttribute('aria-hidden','true');}
}
function prepareDispenserDeactivationReview(event){
  event?.preventDefault();
  const req=window.pendingDispenserDeactivationRequest;
  if(!req)return;
  const readings=[...document.querySelectorAll('#dispenser-deactivation-modal .deactivation-closing-reading')].map(input=>({nozzle_id:input.dataset.nozzleId,reading:Number(input.value)}));
  const dip=Number(document.getElementById('dispenser-deactivation-tank-stock')?.value);
  const tank=(window.dashboardTankRecords||[]).find(t=>String(t.id)===String(req.nozzle?.tank_id));
  const tankLiters=tankLitersFromDip(tank,dip);
  const pin=document.getElementById('dispenser-deactivation-pin')?.value.trim()||'';
  const error=document.getElementById('dispenser-deactivation-error');
  if(readings.some(x=>!Number.isFinite(x.reading))){if(error){error.textContent='Enter every closing nozzle reading.';error.style.display='block';}return;}
  if(!Number.isFinite(dip)||dip<0||!Number.isFinite(tankLiters)){if(error){error.textContent='Enter a valid closing dip and ensure tank calibration is configured.';error.style.display='block';}return;}
  if(!pin){if(error){error.textContent='Enter your PIN.';error.style.display='block';}return;}
  window.pendingDispenserDeactivationSubmission={readings,dip,tankLiters,pin};
  closeDispenserDeactivationModal();
  openDispenserDeactivationReview(req,window.pendingDispenserDeactivationSubmission);
}
function openDispenserDeactivationReview(req,data){
  let modal=document.getElementById('dispenser-deactivation-review-modal');
  if(!modal){
    modal=document.createElement('div');
    modal.id='dispenser-deactivation-review-modal';
    modal.className='modal';
    modal.setAttribute('aria-hidden','true');
    modal.innerHTML='<div class="modal-backdrop" onclick="closeDispenserDeactivationReview()"></div><div class="modal-card" style="max-width:520px;max-height:86vh;overflow:auto"><div class="top"><div><span class="section-kicker">FINAL REVIEW</span><h3>Confirm deactivation</h3><p class="muted" style="margin:4px 0 0">Review the closing readings before permanently ending this shift.</p></div><button type="button" class="modal-close" onclick="closeDispenserDeactivationReview()">×</button></div><div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin:18px 0"><div class="card" style="margin:0;padding:12px"><small>Dispenser</small><strong id="deactivation-review-dispenser" style="display:block;margin-top:4px"></strong></div><div class="card" style="margin:0;padding:12px"><small>Tank</small><strong id="deactivation-review-tank" style="display:block;margin-top:4px"></strong></div></div><div class="card" style="margin:0 0 10px;padding:14px"><div class="top"><strong>Closing nozzle readings</strong><span id="deactivation-review-nozzle-count"></span></div><div id="deactivation-review-nozzles"></div></div><div class="card" style="margin:0 0 10px;padding:14px"><div class="top"><strong>Tank closing stock</strong><span id="deactivation-review-dip"></span></div><div style="font-size:20px;font-weight:700;margin-top:6px" id="deactivation-review-liters"></div><small class="muted">Calculated from the tank calibration</small></div><div class="card" style="margin:0 0 16px;padding:14px"><div class="top"><strong>Attendant authorization</strong><span>PIN verified</span></div><small class="muted">Your PIN will be used to authorize this deactivation.</small></div><div class="row"><button type="button" class="btn" onclick="closeDispenserDeactivationReview();document.getElementById(&quot;dispenser-deactivation-modal&quot;)?.classList.add(&quot;open&quot;)">Back</button><button type="button" class="primary" onclick="submitDispenserDeactivation()">Confirm deactivation</button></div></div>';
    document.body.appendChild(modal);
  }
  const n=req.nozzle||{}, tank=(window.dashboardTankRecords||[]).find(t=>String(t.id)===String(n.tank_id));
  document.getElementById('deactivation-review-dispenser').textContent=n.nozzle_code||req.nozzle_id||'Dispenser';
  document.getElementById('deactivation-review-tank').textContent=tank?.tank_code||n.tank_id||'Connected tank';
  document.getElementById('deactivation-review-nozzle-count').textContent=data.readings.length+' nozzle'+(data.readings.length===1?'':'s');
  document.getElementById('deactivation-review-nozzles').innerHTML=data.readings.map((r,i)=>'<div style="display:flex;justify-content:space-between;gap:12px;padding:9px 0;border-bottom:1px solid var(--border,#e5e7eb)"><span>Nozzle '+(i+1)+' · '+h((req.nozzle_readings||[])[i]?.nozzle_code||r.nozzle_id||'—')+'</span><strong>'+reading(r.reading)+'</strong></div>').join('');
  document.getElementById('deactivation-review-dip').textContent=reading(data.dip)+' mm';
  document.getElementById('deactivation-review-liters').textContent=liters(data.tankLiters)+' L';
  modal.classList.add('open');modal.setAttribute('aria-hidden','false');
}
async function submitDispenserDeactivation(){
  const req=window.pendingDispenserDeactivationRequest, data=window.pendingDispenserDeactivationSubmission;
  if(!req||!data)return;
  const modal=document.getElementById('dispenser-deactivation-review-modal');
  const actionButton=modal?.querySelector('button.primary');
  if(actionButton){actionButton.disabled=true;actionButton.textContent='Deactivating…';}
  try{
    const result=await api('/api/dispenser-deactivation-requests/'+encodeURIComponent(req.id)+'/confirm',{method:'POST',body:JSON.stringify({pin:data.pin,closing_tank_liters:data.tankLiters,closing_tank_dip_mm:data.dip,closing_nozzle_readings:data.readings})});
    closeDispenserDeactivationReview();
    window.pendingDispenserDeactivationSubmission=null;
    showAttendantActionResult('success','Deactivation successful',''+(req.nozzle?.nozzle_code||'Dispenser')+' has been deactivated successfully. The shift is closed and Record Sale is ready.',()=>userDashboard());
  }catch(e){
    if(actionButton){actionButton.disabled=false;actionButton.textContent='Confirm deactivation';}
    showAttendantActionResult('failed','Deactivation failed',e.message||'The dispenser could not be deactivated. No changes were completed.');
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
        '<div class="pending-hero"><div class="pending-hero-icon">◷</div><div><div class="pending-card-title">Pending Shift Confirmation</div><div class="pending-card-subtitle">Review the assigned shift before starting work.</div></div><span class="badge pending-shift-badge">Pending</span></div>'+
        '<div class="pending-shift-info">'+
          '<div class="pending-info-block"><span class="pending-info-icon dispenser-icon">▣</span><div><span class="pending-label">Dispenser</span><strong>'+h(n?.nozzle_code||s.nozzle_id)+'</strong></div></div>'+
          '<div class="pending-info-divider"></div>'+
          '<div class="pending-info-block"><span class="pending-info-icon tank-icon">▤</span><div><span class="pending-label">Tank</span><strong>'+h(tankNames[n?.tank_id]||n?.tank_id||'Not connected')+'</strong></div></div>'+
          '<div class="pending-tank-opening"><span class="pending-info-icon tank-icon">▤</span><div><span class="pending-label">Tank opening</span><strong>'+liters(s.opening_tank_liters)+' <small>L</small></strong></div></div>'+
        '</div>'+
        '<div class="pending-nozzle-section"><div class="pending-nozzle-heading"><span class="pending-section-icon">⌁</span> Nozzle opening readings</div>'+nozzleReadings+'</div>'+
        '<div class="pending-shift-actions">'+
          '<button type="button" class="primary" onclick="openPendingShiftReview(&quot;'+h(s.id)+'&quot;)">Review & Confirm</button>'+
          '<button type="button" class="btn pending-cancel-btn" onclick="cancelPendingShift(&quot;'+h(s.id)+'&quot;)">Cancel Shift</button>'+
        '</div>'+
      '</div>';
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
    window.dashboardProductRecords=products;
    window.dashboardTankRecords=tanks;
    window.pendingDispenserDeactivationRequests=Array.isArray(deactivationRequests)?deactivationRequests:[];

    const pendingDeactivationHtml=(Array.isArray(deactivationRequests)?deactivationRequests:[]).map(req=>{
      const n=req.nozzle||{};
      const s=req.shift||{};
      const readings=Array.isArray(req.nozzle_readings)?req.nozzle_readings:[];
      const validOpening=value=>{
        const num=Number(value);
        return Number.isFinite(num) ? reading(num) : '—';
      };
      const readingRows=readings.map((r,i)=>{
        const code=h(r.nozzle_code||r.nozzle_id||('Nozzle '+(i+1)));
        const opening=validOpening(r.opening_reading ?? r.reading ?? r.value);
        return '<div class="pending-deactivation-reading-row"><div><span class="pending-deactivation-reading-index">Nozzle '+(i+1)+'</span><strong>'+code+'</strong></div><div class="pending-deactivation-opening"><span>Opening</span><strong>'+opening+'</strong></div></div>';
      }).join('');
      return '<div class="card dashboard-purchase-card pending pending-confirmation-card dispenser-deactivation-attendant-card pending-deactivation-card">'+
        '<div class="pending-deactivation-head"><div class="pending-deactivation-head-main"><div class="pending-deactivation-kicker">ACTION REQUIRED</div><div class="pending-card-title">Dispenser deactivation pending</div><div class="pending-card-subtitle">The admin requested this dispenser to be deactivated. Complete the closing readings to finish the current shift.</div></div><span class="pending-deactivation-status">Pending</span></div>'+
        '<div class="pending-deactivation-summary"><div><span>Dispenser</span><strong>'+h(n.nozzle_code||req.nozzle_id||'—')+'</strong></div><div><span>Opening tank</span><strong>'+liters(s.opening_tank_liters)+' L</strong></div></div>'+
        '<div class="pending-deactivation-readings"><div class="pending-deactivation-section-title">Opening nozzle readings</div>'+readingRows+'</div>'+
        '<div class="pending-deactivation-action"><button class="primary" type="button" onclick="openDispenserDeactivationConfirmation(\''+req.id+'\')"><span>Enter closing readings</span><span aria-hidden="true">→</span></button></div>'+
      '</div>';
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
        '<div class="main-record-sale-actions"><button class="primary" type="button" onclick="openTakeoverSaleModal(\''+t.id+'\')">Record Sale</button><button class="btn" type="button" onclick="window.openTakeoverDetails(this.dataset.takeoverId)" data-takeover-id="'+h(t.id)+'">Details</button></div>'+
      '</div>';
    }).join('');
    // A pending deactivation replaces the active-shift card on the attendant dashboard.
    // Never render both states for the same shift.
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
    window.dashboardProductRecords=products;
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
            '<button type="button" class="btn compact-detail-button attendant-shift-details-button" data-takeover-id="'+h(t.id)+'">Details</button>'+
          '</div>'
        };
      });
      historyBox.innerHTML=records.sort((a,b)=>b.time-a.time).map(x=>x.html).join('')||'<div class="card"><p>No confirmed sales yet.</p></div>';
      historyBox.querySelectorAll('.attendant-shift-details-button').forEach(function(btn){
        btn.addEventListener('click',function(event){
          event.preventDefault();
          event.stopPropagation();
          const takeoverId=this.getAttribute('data-takeover-id');
          if(takeoverId)openTakeoverDetails(takeoverId);
        });
      });
    }
  }catch(e){
    if(e.message==='Unauthorized')location.href='attendant-login.html';
    else{const s=document.getElementById('shift-page-status');if(s)s.textContent=e.message;}
  }
}
function openPendingShiftReview(id){
  const shift=(window.dashboardShiftRecords||[]).find(s=>String(s.id)===String(id));
  const nozzles=window.dashboardNozzleRecords||[];
  const tanks=window.dashboardTankRecords||[];
  if(!shift)return;
  const n=nozzles.find(x=>String(x.id)===String(shift.nozzle_id))||{};
  const tank=tanks.find(x=>String(x.id)===String(n.tank_id))||{};
  const readings=Array.isArray(shift.activation_nozzles)?shift.activation_nozzles:[];
  const configured=Array.isArray(n.nozzle_ids)?n.nozzle_ids:[];
  let modal=document.getElementById('pending-shift-review-modal');
  if(!modal){
    modal=document.createElement('div');
    modal.id='pending-shift-review-modal';
    modal.className='pending-handover-review-modal';
    modal.setAttribute('aria-hidden','true');
    document.body.appendChild(modal);
  }
  modal.innerHTML='<div class="pending-handover-review-backdrop" onclick="closePendingShiftReview()"></div>'+
    '<div class="pending-handover-review-card pending-shift-review-card" role="dialog" aria-modal="true" aria-labelledby="pending-shift-review-title">'+
      '<div class="pending-handover-review-head"><div><span class="pending-handover-review-kicker">SHIFT CONFIRMATION</span><h2 id="pending-shift-review-title">Review Pending Shift</h2><p>Check the assigned readings before starting your shift.</p></div><button type="button" class="pending-handover-review-close" onclick="closePendingShiftReview()" aria-label="Close">×</button></div>'+
      '<div class="pending-handover-review-body">'+
        '<div class="pending-handover-review-grid">'+
          '<div><span>Dispenser</span><strong>'+h(n.nozzle_code||shift.nozzle_id||'Not connected')+'</strong></div>'+
          '<div><span>Tank</span><strong>'+h(tank.tank_code||n.tank_id||'Not connected')+'</strong></div>'+
          '<div><span>Tank opening dip</span><strong>'+h(shift.opening_tank_dip_mm==null?'—':reading(shift.opening_tank_dip_mm))+' mm</strong></div>'+
          '<div><span>Tank opening volume</span><strong>'+liters(shift.opening_tank_liters)+' L</strong></div>'+
        '</div>'+
        '<div class="pending-handover-review-section"><div class="pending-handover-review-section-title">Opening meter readings</div>'+
          (readings.length?readings.map((r,i)=>'<div class="pending-handover-review-nozzle"><div><b>Nozzle '+(i+1)+'</b><small>'+h(r.nozzle_id||configured[i]||'')+'</small></div><strong>'+reading(r.opening_reading)+'</strong></div>').join(''):'<div class="pending-handover-review-nozzle"><div><b>Nozzle readings</b></div><strong>—</strong></div>')+
        '</div>'+
        '<div class="pending-handover-review-pin"><label for="pending-shift-review-pin-'+h(id)+'">Your PIN</label><input id="pending-shift-review-pin-'+h(id)+'" type="password" inputmode="numeric" autocomplete="current-password" placeholder="Enter your PIN" required></div>'+
      '</div>'+
      '<div class="pending-handover-review-actions"><button type="button" class="secondary" onclick="closePendingShiftReview()">Cancel</button><button type="button" class="primary" onclick="confirmPendingShiftReview(&quot;'+h(id)+'&quot;)">Confirm Shift</button></div>'+
    '</div>';
  modal.classList.add('open');modal.setAttribute('aria-hidden','false');
  setTimeout(()=>modal.querySelector('input')?.focus(),60);
}
function closePendingShiftReview(){
  const modal=document.getElementById('pending-shift-review-modal');
  if(modal){modal.classList.remove('open');modal.setAttribute('aria-hidden','true');}
}
async function confirmPendingShiftReview(id){
  const pin=document.getElementById('pending-shift-review-pin-'+id)?.value||'';
  if(!pin){
    const input=document.getElementById('pending-shift-review-pin-'+id);
    if(input){input.focus();input.reportValidity?.();}
    return;
  }
  try{
    await api('/api/shifts/'+id+'/confirm',{method:'POST',body:JSON.stringify({pin})});
    closePendingShiftReview();
    showAttendantActionResult('success','Shift confirmed','The shift has been confirmed and started.',()=>userDashboard());
  }catch(e){
    showAttendantActionResult('failed','Shift confirmation failed',e.message||'The shift could not be confirmed.');
  }
}
async function confirmShiftAssignment(event,id){
  if(event)event.preventDefault();
  openPendingShiftReview(id);
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

function closeAccountingPeriodModal(){
  const modal=document.getElementById('accounting-period-modal');
  if(modal){modal.classList.remove('open');modal.setAttribute('aria-hidden','true');}
}
async function openAccountingPeriodModal(){
  const tanks=await api('/api/tanks');
  const active=tanks.filter(t=>t.active===true);
  let modal=document.getElementById('accounting-period-modal');
  if(!modal){
    modal=document.createElement('div'); modal.id='accounting-period-modal'; modal.className='modal'; modal.setAttribute('aria-hidden','true');
    modal.innerHTML='<div class="modal-backdrop" onclick="closeAccountingPeriodModal()"></div><form class="modal-card form accounting-period-form" onsubmit="submitAccountingPeriod(event)"><div class="top"><div><span class="section-kicker">CONTROL PERIOD</span><h3>Open Accounting Period</h3></div><button type="button" class="modal-close" onclick="closeAccountingPeriodModal()">×</button></div><p class="accounting-period-intro">Set the opening readings for each active tank.</p><label>Period name<input id="accounting-period-name" required value="October 2026 Control Period"></label><label>Start time<input id="accounting-period-start" type="datetime-local" required></label><div id="accounting-opening-fields"></div><label>Notes<textarea id="accounting-period-notes" rows="2" placeholder="Optional opening notes"></textarea></label><div class="row"><button type="submit" class="primary">Open accounting period</button><button type="button" onclick="closeAccountingPeriodModal()">Cancel</button></div></form></div>';
    document.body.appendChild(modal);
  }
  const now=new Date(); now.setMinutes(now.getMinutes()-now.getTimezoneOffset());
  document.getElementById('accounting-period-start').value=now.toISOString().slice(0,16);
  document.getElementById('accounting-opening-fields').innerHTML=active.map(t=>'<div class="accounting-opening-row"><strong>'+h(t.tank_code)+'</strong><small>Capacity '+liters(t.capacity_liters)+' L • '+h(t.product||'')+'</small><div class="accounting-opening-grid"><label>Physical liters<input required min="0" max="'+h(t.capacity_liters)+'" step="0.01" type="number" data-opening-tank="'+h(t.id)+'" data-opening-field="liters" placeholder="Verified liters"></label><label>Height (mm)<input min="0" step="0.01" type="number" data-opening-tank="'+h(t.id)+'" data-opening-field="height" placeholder="Optional"></label><label>Calibration version<input required maxlength="100" data-opening-tank="'+h(t.id)+'" data-opening-field="calibration" placeholder="e.g. Tank-2026-v1"></label></div></div>').join('');
  modal.classList.add('open'); modal.setAttribute('aria-hidden','false');
}
async function submitAccountingPeriod(event){
  event.preventDefault();
  const button=event.currentTarget.querySelector('button[type="submit"]'); if(button)button.disabled=true;
  try{
    const groups={};
    document.querySelectorAll('[data-opening-tank]').forEach(input=>{
      const id=input.getAttribute('data-opening-tank'); const field=input.getAttribute('data-opening-field');
      groups[id]=groups[id]||{tank_id:id}; groups[id][field]=input.value.trim();
    });
    const openings=Object.values(groups).map(x=>({tank_id:x.tank_id,physical_liters:Number(x.liters),physical_height_mm:x.height?Number(x.height):null,calibration_version:x.calibration}));
    if(openings.some(x=>!Number.isFinite(x.physical_liters)||x.physical_liters<0||!x.calibration_version))throw new Error('Complete every active tank opening measurement.');
    await api('/api/accounting/open-period',{method:'POST',body:JSON.stringify({name:document.getElementById('accounting-period-name').value.trim(),starts_at:new Date(document.getElementById('accounting-period-start').value).toISOString(),openings,notes:document.getElementById('accounting-period-notes').value.trim()||null})});
    closeAccountingPeriodModal(); toast('Controlled accounting period opened'); await loadAccountingPeriod();
  }catch(e){toast(e.message)}finally{if(button)button.disabled=false;}
}
async function loadAccountingPeriod(){
  const statusEl=document.getElementById('accounting-period-status'), summary=document.getElementById('accounting-period-summary'), button=document.getElementById('open-accounting-period-button');
  if(!statusEl)return;
  try{
    const data=await api('/api/accounting/current-period');
    if(data.open){
      statusEl.textContent='OPEN • '+(data.period?.name||'Accounting period');
      if(button)button.disabled=true;
      summary.innerHTML='<div class="accounting-period-open-badge">Controlled period is active</div><div class="accounting-period-meta">Started '+h(new Date(data.period.starts_at).toLocaleString())+' • '+(data.openings||[]).length+' tank openings verified</div>';
    }else{
      statusEl.textContent='No controlled accounting period is open.';
      if(button)button.disabled=false;
      summary.innerHTML='<div class="muted">Before normal stock reconciliation begins, record one verified physical opening for each active tank.</div>';
    }
  }catch(e){statusEl.textContent='Unable to load accounting status'; if(summary)summary.innerHTML='<div class="muted">'+h(e.message)+'</div>';}
}

async function loadAccountingReconciliation(){
  const box=document.getElementById('tanks'); if(!box)return;
  try{
    const data=await api('/api/accounting/reconciliation');
    if(!data.open)return;
    const byId=new Map((data.tanks||[]).map(t=>[String(t.tank_id),t]));
    box.querySelectorAll('.stat').forEach(card=>{
      const code=card.querySelector('span')?.textContent||'';
      const match=(data.tanks||[]).find(t=>code.includes(String(t.tank_code)));
      if(!match)return;
      const block=card.querySelector('.accounting-recon-mini');
      if(block)block.remove();
      const el=document.createElement('div'); el.className='accounting-recon-mini';
      el.innerHTML='<small><b>Control opening:</b> '+(match.opening_physical_liters==null?'—':liters(match.opening_physical_liters)+' L')+'</small><small><b>Expected closing:</b> '+(match.expected_closing_liters==null?'—':liters(match.expected_closing_liters)+' L')+'</small><small><b>Physical closing:</b> Not recorded</small><small class="muted">Variance is calculated only after a verified physical closing measurement.</small>';
      card.appendChild(el);
    });
  }catch(e){console.warn('Accounting reconciliation unavailable',e);}
}

async function loadStationReconciliationAlerts(){
  const box=document.getElementById('station-reconciliation-alert-list');
  if(!box)return;
  const renderAlert=(kind,title,detail,meta='')=>'<article class="station-reconciliation-alert '+kind+'"><span class="station-reconciliation-alert-icon" aria-hidden="true">'+(kind==='critical'?'!':kind==='warning'?'⌁':'i')+'</span><div class="station-reconciliation-alert-copy"><strong>'+h(title)+'</strong><p>'+h(detail)+'</p>'+(meta?'<small>'+h(meta)+'</small>':'')+'</div></article>';
  try{
    const data=await api('/api/accounting/reconciliation');
    const alerts=[];
    if(!data||data.open!==true){
      alerts.push({kind:'info',title:'No controlled accounting period',detail:'Open a control period and record verified opening measurements before using controlled stock reconciliation.'});
    }else{
      const tanks=Array.isArray(data.tanks)?data.tanks:[];
      tanks.forEach(t=>{
        const tank=String(t.tank_code||t.tank_name||'Tank');
        const closing=t.physical_closing_liters??t.closing_physical_liters??t.recorded_closing_liters??t.physical_liters??null;
        const expected=t.expected_closing_liters??t.expected_liters??null;
        const variance=t.variance_liters??t.stock_difference_liters??t.difference_liters??(closing!=null&&expected!=null?Number(closing)-Number(expected):null);
        if(closing==null){
          alerts.push({kind:'warning',title:tank+' · Closing measurement needed',detail:'Record a verified physical closing measurement to complete this tank reconciliation.',meta:expected==null?'Expected closing not available':'Expected closing '+liters(expected)+' L'});
        }else if(variance!=null&&Math.abs(Number(variance))>0.01){
          alerts.push({kind:'critical',title:tank+' · Stock variance detected',detail:(Number(variance)>0?'+':'')+liters(variance)+' L difference between recorded and expected stock.',meta:expected==null?'Review tank readings and stock movements':'Expected '+liters(expected)+' L · Recorded '+liters(closing)+' L'});
        }else if(variance!=null){
          alerts.push({kind:'success',title:tank+' · Reconciled',detail:'Recorded closing stock matches expected stock.',meta:liters(closing)+' L recorded'});
        }
      });
      if(!tanks.length)alerts.push({kind:'info',title:'No tank reconciliation records',detail:'No tank reconciliation data was returned for the active control period.'});
    }
    const urgent=alerts.filter(a=>a.kind==='critical'||a.kind==='warning').length;
    box.innerHTML='<div class="station-reconciliation-alert-summary"><strong>'+urgent+'</strong><span>items needing attention</span><span class="station-reconciliation-alert-summary-status">'+(urgent?'Review required':'Status checked')+'</span></div>'+
      alerts.map(a=>renderAlert(a.kind,a.title,a.detail,a.meta)).join('');
  }catch(e){
    box.innerHTML=renderAlert('warning','Reconciliation status unavailable','Could not load reconciliation alerts. Open Accounting Control to review the current status.',e.message||'Request failed');
  }
}

async function loadStationNotifications(){
 const list=document.getElementById('station-notifications-list'),count=document.getElementById('station-notifications-count'),status=document.getElementById('station-notifications-status');
 if(!list)return;
 const esc=v=>h(String(v==null?'':v));let items=[];const add=(key,level,title,detail,href,meta='',date=null)=>items.push({key,level,title,detail,href,meta,date:date||null});
 const arr=v=>Array.isArray(v)?v:[],first=(o,keys)=>{for(const k of keys)if(o&&o[k]!=null&&o[k]!=='')return o[k];return null;};
 try{
  const results=await Promise.allSettled([api('/api/reports/daily/confirmations'),api('/api/tanks'),api('/api/products'),api('/api/purchases'),api('/api/accounting/reconciliation')]);
  const val=i=>results[i].status==='fulfilled'?results[i].value:null,dsrs=val(0),tankData=val(1),productData=val(2),purchaseData=val(3),recon=val(4),products=arr(productData);
  const productByName=Object.fromEntries(products.map(p=>[String(p.name||'').trim().toLowerCase(),p])),codeFor=p=>productByName[String(p||'').trim().toLowerCase()]?.code_name||p||'Unknown product';
  const tanks=arr(tankData).filter(t=>t.active!==false),low=[],high=[];
  tanks.forEach(t=>{const cap=Number(t.capacity_liters),stock=Number(t.current_liters);if(!(cap>0)||!Number.isFinite(stock))return;if(stock/cap<=.10)low.push(t);else if(stock/cap>=.90)high.push(t);});
  if(low.length)add('low-tanks','warning','Low tank stock',low.length+' tank'+(low.length===1?' is':'s are')+' at or below 10% capacity: '+low.slice(0,4).map(t=>t.tank_code||'Tank').join(', ')+(low.length>4?' and '+(low.length-4)+' more':''),'admin-inventory.html'+(low[0]?.id?'#tank-'+encodeURIComponent(low[0].id):''),low.slice(0,6).map(t=>(t.tank_code||'Tank')+' · '+codeFor(t.product)+' · '+liters(t.current_liters)+' L left').join(' | '));
  if(high.length)add('high-tanks','info','High tank level',high.length+' tank'+(high.length===1?' is':'s are')+' at or above 90% capacity: '+high.slice(0,4).map(t=>t.tank_code||'Tank').join(', ')+(high.length>4?' and '+(high.length-4)+' more':''),'admin-inventory.html'+(high[0]?.id?'#tank-'+encodeURIComponent(high[0].id):''),high.slice(0,6).map(t=>(t.tank_code||'Tank')+' · '+Math.round(Number(t.current_liters)/Number(t.capacity_liters)*100)+'% full').join(' | '));
  const pendingDsr=arr(dsrs).filter(x=>x.status==='pending'||x.status==='waiting');
  if(pendingDsr.length){
   const ready=pendingDsr.filter(x=>x.status==='pending'&&x.report_day_closed!==false&&x.all_shifts_complete&&x.all_handover_recorded&&x.all_sales_recorded);
   const latestPendingDate=pendingDsr.map(x=>x.date).filter(Boolean).sort().slice(-1)[0]||null;
   add('pending-dsr',ready.length?'warning':'info',ready.length?'DSR ready for confirmation':'DSR completion or confirmation pending',ready.length?ready.length+' daily report'+(ready.length===1?' is':'s are')+' ready for admin review and confirmation.':pendingDsr.length+' DSR record'+(pendingDsr.length===1?' needs':'s need')+' completion checks or confirmation.','admin-daily-report.html'+(latestPendingDate?'#dsr-'+encodeURIComponent(latestPendingDate):''),pendingDsr.slice(0,5).map(x=>dailyReportIdLabel(x.date)+' · '+(x.status==='waiting'?'Awaiting completion':'Awaiting confirmation')).join(' | '),latestPendingDate);
   const missing=[];pendingDsr.forEach(report=>arr(report.missing_sales_shifts).concat(arr(report.unsubmitted_sales_shifts)).forEach(shift=>{const name=first(shift,['attendant_name','employee_name','name','attendant','employee'])||first(shift?.employee,['name'])||first(shift?.attendant,['name'])||'Attendant',key=String(name)+'|'+String(report.date||'');if(!missing.some(x=>x.key===key))missing.push({key,name,date:report.date});}));
   const latestMissingDate=missing.map(x=>x.date).filter(Boolean).sort().slice(-1)[0]||null;
   if(missing.length)add('missing-sales','warning','Attendants without recorded sales',missing.length+' attendant/shift record'+(missing.length===1?'':'s')+' still need sales recording after the DSR period.','admin-daily-report.html'+(latestMissingDate?'#dsr-'+encodeURIComponent(latestMissingDate):''),missing.slice(0,6).map(x=>String(x.name)+' · '+dailyReportIdLabel(x.date)).join(' | ')+(missing.length>6?' · +'+(missing.length-6)+' more':''),latestMissingDate);
  }
  // Purchase alerts use the delivered quantity (the sum of truck compartments),
  // not only the ordered quantity. Each alert links directly to its own purchase.
  arr(purchaseData).forEach(p=>{
   const state=String(first(p,['discharge_status','status'])||'').toLowerCase();
   if(/^(discharged|cancelled|canceled|void)$/i.test(state))return;
   const compartments=Array.isArray(p.compartment_liters)?p.compartment_liters:[];
   const deliveredFromCompartments=compartments.reduce((sum,value)=>sum+(Number(value)||0),0);
   const totalRaw=deliveredFromCompartments>0?deliveredFromCompartments:first(p,['delivered_quantity_liters','delivered_liters','quantity_liters','ordered_quantity_liters','quantity']);
   const total=Number(totalRaw||0);
   const dischargedRaw=first(p,['discharged_quantity_liters','discharged_liters','quantity_discharged_liters','total_discharged_liters','discharged_quantity']);
   const history=Array.isArray(p.discharge_history)?p.discharge_history:[];
   const done=dischargedRaw!=null?Number(dischargedRaw):history.reduce((sum,row)=>sum+(Number(first(row,['discharged_quantity_liters','quantity_liters','quantity']))||0),0);
   const remainingRaw=first(p,['remaining_quantity_liters','remaining_liters','undischarged_liters','quantity_remaining_liters','remaining_quantity']);
   const rem=total>0&&done>=total-0.01?0:(remainingRaw!=null?Math.max(0,Number(remainingRaw)||0):Math.max(0,total-done));
   // A stale pending status must never produce an alert when all delivered
   // liters have already been discharged.
   if(!(total>0)||!(rem>0.01))return;
   const invoice=String(first(p,['invoice_number','order_number'])||'').trim();
   const id=String(p.id||'').trim();
   const shortId=id?id.slice(0,8):'unreferenced';
   const label=invoice?'Invoice '+invoice:'Purchase #'+shortId;
   const product=codeFor(first(p,['product_code','product']));
   const date=first(p,['purchase_date','order_date','created_at','createdAt','invoice_date','date']);
   const isPartial=done>0||rem<total-0.01||/partial/i.test(state);
   const key=(isPartial?'purchase-partial:':'purchase-discharge:')+(id||invoice||shortId);
   const detail=isPartial
     ?product+' has '+liters(rem)+' L remaining to discharge.'
     :product+' · '+liters(rem)+' L delivered quantity is awaiting discharge.';
   const meta=(invoice?'Invoice '+invoice+' · ':'Invoice not provided · Ref '+shortId+' · ')+
     'Delivered '+liters(total)+' L · Discharged '+liters(Math.min(done,total))+' L';
   add(key,'warning',isPartial?'Partial purchase discharge · '+label:'Purchase awaiting discharge · '+label,
     detail,'admin-purchases.html'+(id?'#purchase-'+encodeURIComponent(id):''),meta,date);
  });
  const differences=[];if(recon?.open===true)arr(recon.tanks).forEach(t=>{
    const expectedRaw=first(t,['expected_closing_liters','expected_liters']);
    const closingRaw=first(t,['physical_closing_liters','closing_physical_liters','recorded_closing_liters','physical_liters']);
    const ledgerRaw=first(t,['ledger_current_liters','current_liters']);
    const raw=first(t,['variance_liters','stock_difference_liters','difference_liters']);
    const expected=expectedRaw==null?null:Number(expectedRaw);
    // The current reconciliation API exposes ledger_current_liters and
    // expected_closing_liters; physical_closing_liters is not recorded yet.
    const diff=raw!=null?Number(raw):(closingRaw!=null&&expected!=null?Number(closingRaw)-expected:(ledgerRaw!=null&&expected!=null?Number(ledgerRaw)-expected:null));
    if(diff!=null&&Number.isFinite(diff)&&Math.abs(diff)>.01)differences.push({tank:t.tank_code||t.tank_name||'Tank',diff});
  });
  if(differences.length)add('stock-differences','critical','Tank stock differences',differences.length+' tank reconciliation'+(differences.length===1?' shows':'s show')+' a difference between expected and recorded stock.','admin-accounting-control.html',differences.slice(0,6).map(x=>x.tank+' · '+(x.diff>0?'+':'')+liters(x.diff)+' L').join(' | '));
  const failed=results.filter(r=>r.status==='rejected').length,icons={critical:'!',warning:'!',info:'i'},labels={critical:'Needs attention',warning:'Action needed',info:'For review'},rank={critical:0,warning:1,info:2};
  const inboxPage=document.body.getAttribute('data-app-page')==='adminInbox';
  let databaseBacked=false;
  try{
    // Sync every alert we could confidently derive. Only mark absent alerts
    // resolved when every source check succeeded, otherwise a temporary API
    // failure could incorrectly clear the inbox.
    try{
      await api('/api/inbox/sync',{method:'POST',body:JSON.stringify({complete:failed===0,items:items.map(item=>({key:item.key,level:item.level,title:item.title,detail:item.detail,href:item.href,meta:item.meta,...(item.date?{date:item.date}:{})}))})});
    }catch(syncError){console.warn('Could not synchronize inbox notifications.',syncError);}
    const savedInbox=await api('/api/inbox');
    if(Array.isArray(savedInbox?.items)){
      // An empty newly-created inbox table must not erase alerts found by the
      // live station checks. Use database rows when present; otherwise keep
      // the current generated alerts until the first successful sync populates
      // the table.
      if(savedInbox.items.length){
        items.splice(0,items.length,...savedInbox.items.map(row=>({
          key:row.key,level:row.level,title:row.title,detail:row.detail,href:row.href,
          meta:row.meta||'',date:row.date||new Date().toISOString(),
          isRead:!!row.is_read,isFavorite:!!row.is_favorite
        })));
        databaseBacked=true;
      }else if(items.length===0){
        databaseBacked=true;
      }
    }
  }catch(inboxDbError){
    console.warn('Database inbox is unavailable; using current station checks.',inboxDbError);
  }
  if(!databaseBacked){
    const readKey='fuelStationInboxReadV1',favoriteKey='fuelStationInboxFavoritesV1';
    let readIds={},favoriteIds={};
    try{readIds=JSON.parse(localStorage.getItem(readKey)||'{}')||{};}catch(_e){}
    try{favoriteIds=JSON.parse(localStorage.getItem(favoriteKey)||'{}')||{};}catch(_e){}
    items.forEach(item=>{item.isRead=!!readIds[item.key];item.isFavorite=!!favoriteIds[item.key];});
  }
  items.sort((a,b)=>(Number(b.isFavorite)-Number(a.isFavorite))||(Number(a.isRead)-Number(b.isRead))||(rank[a.level]??9)-(rank[b.level]??9));
  items.forEach(item=>{if(!item.date)item.date=new Date().toISOString();});
  const unreadCount=items.filter(item=>!item.isRead).length;
  if(count)count.textContent=String(unreadCount);if(status)status.textContent=failed?'Some checks unavailable':'Updated just now';
  const inboxFilterDefaults={from:'',to:'',status:'all',priority:'all',favorites:false};
  const filterState={...inboxFilterDefaults};
  const inboxPageSize=6;
  let inboxCurrentPage=1;
  const getFilterEl=id=>document.getElementById(id);
  const filterToggle=getFilterEl('inbox-filter-toggle'),filterPanel=getFilterEl('inbox-filter-panel');
  const isInboxPage=document.body.getAttribute('data-app-page')==='adminInbox';
  const activeFilterCount=()=>Number(!!filterState.from)+Number(!!filterState.to)+Number(filterState.status!=='all')+Number(filterState.priority!=='all')+Number(filterState.favorites);
  const renderInboxList=()=>{
    let visibleItems=inboxPage?items:items.slice(0,4);
    let filteredItems=visibleItems;
    if(inboxPage){
      filteredItems=visibleItems.filter(item=>{
        if(filterState.status==='unread'&&item.isRead)return false;
        if(filterState.status==='read'&&!item.isRead)return false;
        if(filterState.priority!=='all'&&item.level!==filterState.priority)return false;
        if(filterState.favorites&&!item.isFavorite)return false;
        const day=String(item.date||new Date().toISOString()).slice(0,10);
        if(filterState.from&&day<filterState.from)return false;
        if(filterState.to&&day>filterState.to)return false;
        return true;
      });
      const total=items.length,shown=filteredItems.length,filterCount=activeFilterCount();
      const pageCount=Math.max(1,Math.ceil(shown/inboxPageSize));
      inboxCurrentPage=Math.min(inboxCurrentPage,pageCount);
      const pageStart=(inboxCurrentPage-1)*inboxPageSize;
      visibleItems=filteredItems.slice(pageStart,pageStart+inboxPageSize);
      const visibleCount=getFilterEl('inbox-visible-count'),summary=getFilterEl('inbox-filter-summary'),badge=getFilterEl('inbox-filter-badge');
      if(visibleCount)visibleCount.textContent=shown?('Showing '+(pageStart+1)+'–'+Math.min(pageStart+visibleItems.length,shown)+' of '+shown):('0 of '+shown+' notifications');
      if(summary)summary.textContent=(filterCount?filterCount+' filter'+(filterCount===1?'':'s')+' applied':'Showing every alert')+' · Page '+inboxCurrentPage+' of '+pageCount;
      if(badge){badge.textContent=String(filterCount);badge.hidden=!filterCount;}
      if(filterToggle)filterToggle.classList.toggle('has-filters',filterCount>0);
      const pagination=getFilterEl('inbox-pagination');
      if(pagination){
        pagination.innerHTML=pageCount>1?'<button type="button" class="inbox-page-btn" data-inbox-page="prev" '+(inboxCurrentPage===1?'disabled':'')+' aria-label="Previous page">‹</button><span class="inbox-page-indicator">Page <strong>'+inboxCurrentPage+'</strong> of '+pageCount+'</span><button type="button" class="inbox-page-btn" data-inbox-page="next" '+(inboxCurrentPage===pageCount?'disabled':'')+' aria-label="Next page">›</button>':'';
        pagination.hidden=pageCount<=1;
        pagination.querySelector('[data-inbox-page="prev"]')?.addEventListener('click',()=>{if(inboxCurrentPage>1){inboxCurrentPage--;renderInboxList();}});
        pagination.querySelector('[data-inbox-page="next"]')?.addEventListener('click',()=>{if(inboxCurrentPage<pageCount){inboxCurrentPage++;renderInboxList();}});
      }
    }
    list.innerHTML=visibleItems.length?visibleItems.map(item=>{const isRead=!!item.isRead,isFavorite=!!item.isFavorite,isPurchase=/^purchase-(discharge|partial):/.test(String(item.key||'')),openLabel=isPurchase?'Open purchase':(isRead?'Read':'Unread')+' · '+labels[item.level];return '<div class="station-notification-row '+esc(item.level)+(isRead?' is-read':' is-unread')+(isFavorite?' is-favorite':'')+(isPurchase?' station-purchase-notification':'')+'" data-inbox-row="'+esc(item.key)+'"><span class="station-notification-icon" aria-hidden="true">'+icons[item.level]+'</span><span class="station-notification-copy"><a class="station-notification-main" href="'+esc(item.href)+'" data-inbox-key="'+esc(item.key)+'"><span class="station-notification-title">'+esc(item.title)+'</span><span class="station-notification-detail">'+esc(item.detail)+'</span>'+(item.meta?'<span class="station-notification-meta">'+esc(item.meta)+'</span>':'')+'<span class="station-notification-open">'+openLabel+' <span aria-hidden="true">→</span></span></a></span><button type="button" class="station-notification-favorite'+(isFavorite?' active':'')+'" data-favorite-key="'+esc(item.key)+'" aria-label="'+(isFavorite?'Remove from favorites':'Add to favorites')+'" aria-pressed="'+String(isFavorite)+'" title="'+(isFavorite?'Remove from favorites':'Add to favorites')+'">'+(isFavorite?'★':'☆')+'</button></div>';}).join(''):'<div class="station-notification-empty">'+(inboxPage&&activeFilterCount()?'No notifications match these filters. Try changing or clearing your filters.':(failed?'No active alerts were found in the available checks. Some data sources could not be reached.':'You’re all caught up. No active notifications.'))+'</div>';
    list.querySelectorAll('[data-inbox-key]').forEach(link=>link.addEventListener('click',async event=>{
      event.preventDefault();
      const key=link.getAttribute('data-inbox-key'),item=items.find(x=>x.key===key),target=link.href;
      try{
        if(item&&!item.isRead){
          if(databaseBacked){
            await api('/api/inbox/'+encodeURIComponent(key)+'/state',{method:'PATCH',body:JSON.stringify({is_read:true,is_favorite:!!item.isFavorite})});
          }else{
            const saved=JSON.parse(localStorage.getItem('fuelStationInboxReadV1')||'{}')||{};
            saved[key]=Date.now();localStorage.setItem('fuelStationInboxReadV1',JSON.stringify(saved));
          }
          if(item)item.isRead=true;
          if(count)count.textContent=String(Math.max(0,Number(count.textContent||0)-1));
        }
      }catch(e){toast('Could not save the read status. Please try again.');}
      location.href=target;
    }));
    list.querySelectorAll('[data-favorite-key]').forEach(button=>button.addEventListener('click',async event=>{
      event.preventDefault();event.stopPropagation();
      const key=button.getAttribute('data-favorite-key'),item=items.find(x=>x.key===key);
      if(!item)return;
      const active=!item.isFavorite;
      try{
        if(databaseBacked){
          await api('/api/inbox/'+encodeURIComponent(key)+'/state',{method:'PATCH',body:JSON.stringify({is_read:!!item.isRead,is_favorite:active})});
        }else{
          const saved=JSON.parse(localStorage.getItem('fuelStationInboxFavoritesV1')||'{}')||{};
          if(active)saved[key]=Date.now();else delete saved[key];
          localStorage.setItem('fuelStationInboxFavoritesV1',JSON.stringify(saved));
        }
        item.isFavorite=active;
        if(inboxPage){inboxCurrentPage=1;renderInboxList();return;}
        button.setAttribute('aria-pressed',String(active));button.classList.toggle('active',active);
        button.textContent=active?'★':'☆';button.title=active?'Remove from favorites':'Add to favorites';
        button.setAttribute('aria-label',button.title);
        const row=button.closest('[data-inbox-row]');if(row)row.classList.toggle('is-favorite',active);
      }catch(e){toast('Could not save this favorite. Please try again.');}
    }));
  };
  if(inboxPage&&filterToggle&&!filterToggle.dataset.bound){
    filterToggle.dataset.bound='1';
    filterToggle.addEventListener('click',()=>{const opening=filterPanel.hidden;filterPanel.hidden=!opening;filterToggle.setAttribute('aria-expanded',String(opening));});
    getFilterEl('inbox-filter-close')?.addEventListener('click',()=>{filterPanel.hidden=true;filterToggle.setAttribute('aria-expanded','false');});
    getFilterEl('inbox-filter-apply')?.addEventListener('click',()=>{
      filterState.from=getFilterEl('inbox-filter-from')?.value||'';
      filterState.to=getFilterEl('inbox-filter-to')?.value||'';
      filterState.status=getFilterEl('inbox-filter-status')?.value||'all';
      filterState.priority=getFilterEl('inbox-filter-priority')?.value||'all';
      filterState.favorites=!!getFilterEl('inbox-filter-favorites')?.checked;
      if(filterState.from&&filterState.to&&filterState.from>filterState.to){toast('From date must be before the To date.');return;}
      inboxCurrentPage=1;
      filterPanel.hidden=true;filterToggle.setAttribute('aria-expanded','false');renderInboxList();
    });
    getFilterEl('inbox-filter-reset')?.addEventListener('click',()=>{
      Object.assign(filterState,inboxFilterDefaults);
      inboxCurrentPage=1;
      const f=getFilterEl('inbox-filter-from'),t=getFilterEl('inbox-filter-to'),st=getFilterEl('inbox-filter-status'),pr=getFilterEl('inbox-filter-priority'),fav=getFilterEl('inbox-filter-favorites');
      if(f)f.value='';if(t)t.value='';if(st)st.value='all';if(pr)pr.value='all';if(fav)fav.checked=false;
      renderInboxList();
    });
    document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!filterPanel.hidden){filterPanel.hidden=true;filterToggle.setAttribute('aria-expanded','false');}});
  }
  renderInboxList();
  const footer=document.querySelector('.station-notifications-footer');if(footer)footer.hidden=inboxPage;
 }catch(e){if(status)status.textContent='Unable to refresh';list.innerHTML='<div class="station-notification-empty">Notifications could not be loaded. Open the related section to check station records.</div>';}
}

async function adminInbox(){
 try{
  const me=await currentUser();if(me.role!=='admin')return location.href='admin-login.html';
  const title=document.getElementById('inbox-page-title');if(title)title.textContent='Inbox';
  await loadStationNotifications();
 }catch(e){const list=document.getElementById('station-notifications-list');if(list)list.innerHTML='<div class="station-notification-empty">Could not load the inbox. Please refresh and try again.</div>';}
}

async function adminDashboard(){
  try{
    await window.stationCurrencyReady;
    const me=await currentUser(); if(me.role!=='admin')return location.href='admin-login.html';
    await loadAccountingPeriod();
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
    if(el('sales'))el('sales').textContent=todaySales.length; if(el('sales-total'))el('sales-total').textContent=money(total);
    if(el('active-shifts'))el('active-shifts').textContent=activeShifts.length; if(el('tank-count'))el('tank-count').textContent=tanks.length; if(el('alerts'))el('alerts').textContent=low.length;
    if(el('product-count'))el('product-count').textContent=products.length; if(el('dispenser-count'))el('dispenser-count').textContent=dispensers.length; if(el('attendant-count'))el('attendant-count').textContent=activeEmployees.filter(e=>e.role==='attendant').length;
    await loadAccountingReconciliation();
    await loadStationReconciliationAlerts();
    await loadStationNotifications();
    if(el('products')){
      const shownProducts=products.slice(0,4);
      el('products').innerHTML=shownProducts.length?shownProducts.map(p=>{
        const pc=p.color||'#1264d8';
        return '<article class="station-product-glimpse" style="--product-accent:'+h(pc)+'"><span class="station-product-swatch"></span><div class="station-product-glimpse-main"><strong class="product-code">'+h(p.code_name||p.name)+'</strong><small>'+h(p.name||'Fuel product')+'</small></div><div class="station-product-price"><span>Selling price</span><strong>'+money(p.selling_price)+'</strong></div></article>';
      }).join(''):'<div class="empty-content">No activated products.</div>';
      if(products.length>4)el('products').insertAdjacentHTML('beforeend','<div class="station-glimpse-foot">Showing 4 of '+products.length+' active products</div>');
    }
    if(el('dispensers'))el('dispensers').innerHTML=dispensers.length?dispensers.map(d=>{
      const tank=tanks.find(t=>t.id===d.tank_id);
      const product=products.find(p=>String(p.name||'').toLowerCase()===String(d.product||'').toLowerCase())||{};
      const productCode=product.code_name||codeForProduct(d.product),productColor=product.color||'#1264d8';
      const shift=activeShifts.find(s=>s.nozzle_id===d.id);
      const attendant=shift?activeEmployees.find(e=>e.id===shift.employee_id):null;
      return '<div class="stat dispenser-content-row"><div class="content-main"><div class="content-title"><span class="field-label">DISPENSER</span><b>'+h(d.nozzle_code)+'</b></div><div class="content-details"><span class="field-label">PRODUCT</span><strong class="product-code" style="color:'+h(productColor)+'">'+h(productCode)+'</strong><span class="separator">·</span><span class="field-label">TANK</span><strong>'+h(tank?.tank_code||'No tank')+'</strong></div></div><div class="content-status"><span class="status-dot '+(shift?'is-active':'')+'"></span><span>'+(shift?'Shift active — '+h(attendant?.name||'Attendant'):'No active shift')+'</span><small>'+h(d.nozzle_count||1)+' nozzle(s)</small></div>'+(shift?'<button class="btn" type="button" onclick="adminDeactivateShift(\''+shift.id+'\')">Deactivate Shift</button>':'')+'</div>';
    }).join(''):'<div class="empty-content">No activated dispensers.</div>';
    if(el('attendants'))el('attendants').innerHTML=activeEmployees.filter(e=>e.role==='attendant').length?activeEmployees.filter(e=>e.role==='attendant').map(e=>{
      const shift=activeShifts.find(s=>s.employee_id===e.id);
      const dispenser=shift?dispensers.find(d=>d.id===shift.nozzle_id):null;
      return '<div class="stat attendant-content-row"><div class="content-title"><span class="field-label">ATTENDANT</span><b>'+h(e.name)+'</b><span class="operator-id">ID '+h(e.operator_id)+'</span></div><div class="content-status"><span class="status-dot '+(shift?'is-active':'')+'"></span><span>'+(shift?'Active shift':'Available')+'</span><small>'+(shift?'Dispenser '+h(dispenser?.nozzle_code||shift.nozzle_id):'No active shift')+'</small></div></div>';
    }).join(''):'<div class="empty-content">No activated attendants.</div>';
    if(el('tanks')){
      const shownTanks=tanks.slice(0,4);
      el('tanks').innerHTML=shownTanks.length?shownTanks.map(t=>{
        const capacity=Number(t.capacity_liters)||0;
        const current=Number(t.current_liters)||0;
        const pct=capacity>0?Math.max(0,Math.min(100,current/capacity*100)):0;
        const product=products.find(p=>String(p.name||'').toLowerCase()===String(t.product||'').toLowerCase())||{};
        const color=product.color||'#1769d2';
        const code=product.code_name||codeForProduct(t.product)||'—';
        return '<article class="station-tank-glimpse" style="--tank-accent:'+h(color)+'"><div class="station-tank-glimpse-top"><div><strong>'+h(t.tank_code||'Tank')+'</strong><small><span class="station-tank-product-dot"></span>'+h(code)+'</small></div><div class="station-tank-stock"><strong>'+liters(current)+' L</strong><small>of '+liters(capacity)+' L</small></div></div><div class="station-tank-progress" role="progressbar" aria-label="'+h(t.tank_code||'Tank')+' fill level" aria-valuemin="0" aria-valuemax="100" aria-valuenow="'+pct.toFixed(1)+'"><span style="width:'+pct.toFixed(1)+'%"></span></div><div class="station-tank-glimpse-bottom"><span>'+pct.toFixed(1)+'% full</span><span>'+Math.max(0,liters(capacity-current))+' L space</span></div></article>';
      }).join(''):'<div class="empty-content">No activated tanks.</div>';
      if(tanks.length>4)el('tanks').insertAdjacentHTML('beforeend','<div class="station-glimpse-foot">Showing 4 of '+tanks.length+' active tanks</div>');
    }
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
        return '<section class="tank-movement-group" style="--product-color:'+(dot?h(dot):'#1264d8')+'"><div class="tank-movement-group-head"><div><span class="tank-movement-product"><i style="'+(dot?'background:'+h(dot)+';':'')+'"></i><strong class="product-code" style="color:'+(dot?h(dot):'#1264d8')+'">'+h(code)+'</strong></span><h4>'+h(first.tank_code||'Tank')+'</h4><small class="product-name" style="color:'+(dot?h(dot):'#1264d8')+'">'+h(name)+'</small></div><div class="tank-movement-current"><strong>'+liters(current)+' L</strong><span>'+pct.toFixed(1)+'% full</span></div></div><div class="tank-movement-list">'+rows.map(m=>{
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
function renderActivatedProductsGraph(products,sales){
  const host=document.getElementById('activated-products-graph');
  if(!host)return;
  if(!products.length){host.innerHTML='<div class="empty-content">No activated products to compare.</div>';return;}
  const norm=v=>String(v??'').trim().toLowerCase();
  const totals=products.map(p=>{
    const productName=norm(p.name),productCode=norm(p.code_name);
    const volume=(sales||[]).reduce((sum,s)=>{
      const saleProduct=norm(s.product),saleCode=norm(s.product_code||s.product_code_name);
      if(saleProduct!==productName&&saleProduct!==productCode&&saleCode!==productCode)return sum;
      const q=Number(s.quantity_liters);return sum+(Number.isFinite(q)&&q>0?q:0);
    },0);
    return {code:String(p.code_name||p.name||'—'),volume,color:String(p.color||'#1264d8').trim()||'#1264d8'};
  });
  const total=totals.reduce((sum,x)=>sum+x.volume,0);
  const size=240,cx=120,cy=120,r=88;
  let angle=-Math.PI/2;
  const paths=totals.map(x=>{
    const share=total>0?x.volume/total:1/totals.length;
    const next=angle+share*Math.PI*2;
    const large=share>.5?1:0;
    const x1=cx+r*Math.cos(angle),y1=cy+r*Math.sin(angle),x2=cx+r*Math.cos(next),y2=cy+r*Math.sin(next);
    const d=share>=.999999?'M '+cx+' '+cy+' L '+cx+' '+(cy-r)+' A '+r+' '+r+' 0 1 1 '+(cx-.01)+' '+(cy-r)+' Z':'M '+cx+' '+cy+' L '+x1+' '+y1+' A '+r+' '+r+' 0 '+large+' 1 '+x2+' '+y2+' Z';
    angle=next;
    return '<path d="'+d+'" fill="'+h(x.color)+'" stroke="#fff" stroke-width="3" stroke-linejoin="round"><title>'+h(x.code)+' — '+h(liters(x.volume))+' L ('+(share*100).toFixed(1)+'%)</title></path>';
  }).join('');
  const legend=totals.map(x=>{const share=total>0?x.volume/total:1/totals.length;return '<div class="activated-products-pie-item"><span class="activated-products-pie-dot" style="background:'+h(x.color)+'"></span><span class="activated-products-pie-code">'+h(x.code)+'</span><strong>'+h(liters(x.volume))+' L</strong><small>'+(share*100).toFixed(1)+'%</small></div>';}).join('');
  host.innerHTML='<div class="activated-products-graph-head"><div><span class="section-kicker">PRODUCT PERFORMANCE</span><h3>Sales volume by product</h3></div><span class="activated-products-graph-unit">LITERS SOLD</span></div><div class="activated-products-pie-layout"><div class="activated-products-pie-chart"><svg viewBox="0 0 '+size+' '+size+'" role="img" aria-label="Sales volume distribution among activated products">'+paths+'<circle cx="'+cx+'" cy="'+cy+'" r="51" fill="#fff"></circle><text x="'+cx+'" y="'+(cy-3)+'" text-anchor="middle" class="activated-products-pie-total">'+h(liters(total))+'</text><text x="'+cx+'" y="'+(cy+12)+'" text-anchor="middle" class="activated-products-pie-total-label">LITERS</text></svg></div><div class="activated-products-pie-legend">'+legend+'</div></div>';
}

async function adminFuelConfiguration(){
  try{
    await window.stationCurrencyReady; const me=await currentUser(); if(me.role!=='admin')return location.href='admin-login.html';
    const [allProducts,allTanks,allDispensers,allShifts,employees,sales]=await Promise.all([api('/api/products'),api('/api/tanks'),api('/api/nozzles'),api('/api/shifts'),api('/api/users'),api('/api/sales')]);
    const products=allProducts.filter(p=>p.active===true), tanks=allTanks.filter(t=>t.active===true&&products.some(p=>String(p.name).toLowerCase()===String(t.product||'').toLowerCase()));
    const dispensers=allDispensers.filter(d=>d.active===true&&tanks.some(t=>t.id===d.tank_id));
    const activeEmployees=employees.filter(e=>e.active===true), activeShifts=allShifts.filter(s=>s.status==='active');
    const el=id=>document.getElementById(id), productCodes=Object.fromEntries(products.map(p=>[String(p.name).toLowerCase(),p.code_name]));
    el('products').innerHTML=products.length?products.map(p=>{const pc=String(p.color||'#1264d8').trim()||'#1264d8';return '<article class="stat activated-product-card" data-product-id="'+h(p.id)+'" role="button" tabindex="0" aria-label="View '+h(p.code_name)+' details" style="--product-color:'+h(pc)+'"><div class="activated-product-main"><span class="activated-product-color" aria-hidden="true"></span><div class="activated-product-copy"><span class="field-label">PRODUCT</span><div class="activated-product-code">'+h(p.code_name)+'</div><div class="activated-product-name">'+h(p.name)+'</div></div></div><div class="activated-product-meta"><div><span>STATUS</span><strong>Active</strong></div><div><span>SELLING PRICE</span><strong>'+money(p.selling_price)+'</strong></div></div></article>';}).join(''):'<div class="empty-content">No activated products.</div>';
    renderActivatedProductsGraph(products,sales);
    const dispenserGroups=products.map(p=>({
      product:p,
      items:dispensers.filter(d=>{
        const tank=tanks.find(t=>t.id===d.tank_id);
        const value=String(d.product||tank?.product||'').toLowerCase();
        return value===String(p.name||'').toLowerCase()||value===String(p.code_name||'').toLowerCase();
      })
    })).filter(g=>g.items.length);
    const groupedDispenserIds=new Set(dispenserGroups.flatMap(g=>g.items.map(d=>String(d.id))));
    const ungroupedDispensers=dispensers.filter(d=>!groupedDispenserIds.has(String(d.id)));
    const renderDispenserCard=(d,productCode)=>{
      const tank=tanks.find(t=>t.id===d.tank_id);
      const shift=activeShifts.find(s=>s.nozzle_id===d.id);
      const attendant=shift?activeEmployees.find(e=>e.id===shift.employee_id):null;
      const product=products.find(p=>{
        const value=String(d.product||tank?.product||'').toLowerCase();
        return value===String(p.name||'').toLowerCase()||value===String(p.code_name||'').toLowerCase();
      });
      const pc=String(product?.color||'#1264d8').trim()||'#1264d8';
      return '<div class="stat activated-dispenser-card" data-dispenser-id="'+h(d.id)+'" role="button" tabindex="0" aria-label="View '+h(d.nozzle_code||'dispenser')+' details" style="--product-color:'+h(pc)+'"><b>'+h(d.nozzle_code)+'</b><span>'+h(productCode||'—')+' • '+h(tank?.tank_code||'No tank')+'</span><small>Active • '+h(d.nozzle_count||1)+' nozzle(s) • '+(shift?'Shift active — '+h(attendant?.name||'Attendant'):'No active shift')+'</small></div>';
    };
    const renderDispenserGroupGraph=(g,pc)=>{
      const endDate=new Date(); endDate.setHours(23,59,59,999);
      const days=Array.from({length:7},(_,i)=>{const d=new Date(endDate);d.setDate(endDate.getDate()-(6-i));return d;});
      const rows=g.items.map(d=>({d,values:days.map(day=>{const key=day.toISOString().slice(0,10);return (sales||[]).filter(s=>String(s.nozzle_id||'')===String(d.id)&&String(s.sale_time||s.created_at||'').slice(0,10)===key).reduce((sum,s)=>sum+(Number(s.quantity_liters)||0),0);})}));
      const max=Math.max(1,...rows.flatMap(r=>r.values));
      const w=520,hg=150,padL=34,padR=10,padT=12,padB=25,iw=w-padL-padR,ih=hg-padT-padB;
      const x=i=>padL+i*(iw/6), y=v=>padT+ih-(v/max)*ih;
      const grid=[0,.5,1].map(v=>'<line x1="'+padL+'" y1="'+y(max*v).toFixed(1)+'" x2="'+(w-padR)+'" y2="'+y(max*v).toFixed(1)+'" class="activated-dispenser-graph-grid"></line>').join('');
      const lines=rows.map((r,idx)=>{const opacity=Math.max(.38,1-idx*.1).toFixed(2),pts=r.values.map((v,i)=>x(i).toFixed(1)+','+y(v).toFixed(1)).join(' ');return '<polyline points="'+pts+'" fill="none" stroke="'+h(pc)+'" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" opacity="'+opacity+'"></polyline>'+r.values.map((v,i)=>'<circle cx="'+x(i).toFixed(1)+'" cy="'+y(v).toFixed(1)+'" r="2.5" fill="'+h(pc)+'" opacity="'+opacity+'"><title>'+h(r.d.nozzle_code)+' — '+h(days[i].toLocaleDateString(undefined,{month:'short',day:'numeric'}))+' — '+liters(v)+' L</title></circle>').join('');}).join('');
      const labels=days.map((d,i)=>'<text x="'+x(i).toFixed(1)+'" y="'+(hg-7)+'" text-anchor="middle" class="activated-dispenser-graph-label">'+h(d.toLocaleDateString(undefined,{month:'short',day:'numeric'}))+'</text>').join('');
      const legend=rows.map((r,idx)=>'<span class="activated-dispenser-graph-legend-item"><i style="background:'+h(pc)+';opacity:'+Math.max(.38,1-idx*.1).toFixed(2)+'"></i>'+h(r.d.nozzle_code)+'</span>').join('');
      const total=rows.reduce((sum,r)=>sum+r.values.reduce((a,b)=>a+b,0),0);
      return '<div class="activated-dispenser-graph"><div class="activated-dispenser-graph-head"><div><span class="section-kicker">DISPENSER PERFORMANCE</span><strong>Sales volume · Last 7 days</strong></div><span>'+h(liters(total))+' L</span></div><div class="activated-dispenser-graph-wrap"><svg viewBox="0 0 '+w+' '+hg+'" role="img" aria-label="Dispenser sales volume for the last 7 days">'+grid+'<line x1="'+padL+'" y1="'+(hg-padB)+'" x2="'+(w-padR)+'" y2="'+(hg-padB)+'" class="activated-dispenser-graph-axis"></line>'+lines+labels+'</svg></div><div class="activated-dispenser-graph-legend">'+legend+'</div></div>';
    };
    const renderDispenserGroup=(g)=>{
      const pc=String(g.product.color||'#1264d8').trim()||'#1264d8';
      return '<section class="activated-dispenser-product-group" style="--product-color:'+h(pc)+'"><div class="activated-dispenser-group-head"><span class="activated-dispenser-group-dot"></span><div><span class="field-label">PRODUCT</span><strong>'+h(g.product.code_name||g.product.name||'—')+'</strong></div><span class="activated-dispenser-group-count">'+g.items.length+' dispenser'+(g.items.length===1?'':'s')+'</span></div><div class="activated-dispenser-group-cards">'+g.items.map(d=>renderDispenserCard(d,g.product.code_name||g.product.name)).join('')+'</div>'+renderDispenserGroupGraph(g,pc)+'</section>';
    };
    let dispenserMarkup=dispenserGroups.map(renderDispenserGroup).join('');
    if(ungroupedDispensers.length){
      dispenserMarkup+='<section class="activated-dispenser-product-group activated-dispenser-ungrouped"><div class="activated-dispenser-group-head"><span class="activated-dispenser-group-dot"></span><div><span class="field-label">PRODUCT</span><strong>Other / Unmatched</strong></div><span class="activated-dispenser-group-count">'+ungroupedDispensers.length+' dispenser'+(ungroupedDispensers.length===1?'':'s')+'</span></div><div class="activated-dispenser-group-cards">'+ungroupedDispensers.map(d=>renderDispenserCard(d,productCodes[String(d.product||'').toLowerCase()]||d.product||'—')).join('')+'</div></section>';
    }
    el('dispensers').innerHTML=dispenserMarkup||'<div class="card"><p>No activated dispensers.</p></div>';
  }catch(e){const s=document.getElementById('page-status');if(s)s.textContent=e.message;if(e.message==='Unauthorized')location.href='admin-login.html';}
}
function ensureAdminInventoryTankDetailsModal(){
  let modal=document.getElementById('admin-inventory-tank-details-modal');
  if(modal)return modal;
  modal=document.createElement('div');
  modal.id='admin-inventory-tank-details-modal';
  modal.className='admin-inventory-tank-details-modal';
  modal.setAttribute('aria-hidden','true');
  modal.innerHTML='<div class="admin-inventory-tank-details-backdrop"></div><div class="admin-inventory-tank-details-card" role="dialog" aria-modal="true" aria-labelledby="admin-inventory-tank-details-title"><div class="admin-inventory-tank-details-top"><div><span class="section-kicker">TANK DETAILS</span><h3 id="admin-inventory-tank-details-title">Tank</h3></div><button type="button" class="admin-inventory-tank-details-close" aria-label="Close">×</button></div><div class="admin-inventory-tank-details-content"><div id="admin-inventory-tank-details-body"></div></div></div>';
  document.body.appendChild(modal);
  modal.querySelector('.admin-inventory-tank-details-close').addEventListener('click',()=>closeAdminInventoryTankDetails());
  modal.querySelector('.admin-inventory-tank-details-backdrop').addEventListener('click',()=>closeAdminInventoryTankDetails());
  modal.addEventListener('click',e=>{
    const slides=modal.querySelectorAll('.admin-inventory-tank-slide'); if(slides.length!==2)return;
    let current=[...slides].findIndex(s=>s.classList.contains('active')); if(current<0)current=0;
    let target=null;
    if(e.target.closest('[data-inventory-slide-next]'))target=Math.min(1,current+1);
    if(e.target.closest('[data-inventory-slide-prev]'))target=Math.max(0,current-1);
    const dot=e.target.closest('[data-inventory-slide-to]');
    if(dot)target=Math.max(0,Math.min(1,Number(dot.getAttribute('data-inventory-slide-to'))||0));
    if(target===null||target===current)return;
    slides.forEach((s,i)=>s.classList.toggle('active',i===target));
    modal.querySelectorAll('.admin-inventory-tank-slide-dot').forEach((d,i)=>d.classList.toggle('active',i===target));
  });
  modal.addEventListener('touchstart',e=>{
    const t=e.touches?.[0]; if(!t)return;
    modal._inventorySwipeStartX=t.clientX; modal._inventorySwipeStartY=t.clientY; modal._inventorySwipeTracking=true;
  },{passive:true});
  modal.addEventListener('touchend',e=>{
    if(!modal._inventorySwipeTracking)return;
    modal._inventorySwipeTracking=false;
    const t=e.changedTouches?.[0]; if(!t)return;
    const dx=t.clientX-Number(modal._inventorySwipeStartX||0);
    const dy=t.clientY-Number(modal._inventorySwipeStartY||0);
    if(Math.abs(dx)<45||Math.abs(dx)<=Math.abs(dy))return;
    const slides=modal.querySelectorAll('.admin-inventory-tank-slide'); if(slides.length!==2)return;
    let current=[...slides].findIndex(s=>s.classList.contains('active')); if(current<0)current=0;
    const target=Math.max(0,Math.min(1,current+(dx<0?1:-1)));
    if(target===current)return;
    slides.forEach((s,i)=>{s.classList.toggle('active',i===target);s.classList.remove('swipe-in-next','swipe-in-prev');});
    const incoming=slides[target];
    incoming.classList.add(target>current?'swipe-in-next':'swipe-in-prev');
    setTimeout(()=>incoming.classList.remove('swipe-in-next','swipe-in-prev'),260);
    modal.querySelectorAll('.admin-inventory-tank-slide-dot').forEach((d,i)=>d.classList.toggle('active',i===target));
  },{passive:true});
  return modal;
}
function closeAdminInventoryTankDetails(){
  const m=document.getElementById('admin-inventory-tank-details-modal');
  if(m){m.classList.remove('open');m.setAttribute('aria-hidden','true');}
}
function openAdminInventoryTankDetails(id){
  const modal=ensureAdminInventoryTankDetailsModal(); if(!modal)return;
  const state=window.__adminInventoryState||{};
  const t=(state.tanks||[]).find(x=>String(x.id)===String(id)); if(!t)return;
  const product=(state.products||[]).find(p=>String(p.name||'').toLowerCase()===String(t.product||'').toLowerCase())||{};
  const inv=(state.inventory||[]).find(x=>String(x.tank_id)===String(t.id))||{};
  const movements=(state.movements||[]).filter(x=>String(x.tank_id)===String(t.id)).sort((a,b)=>new Date(b.created_at)-new Date(a.created_at));
  const pc=String(product.color||'#1264d8').trim()||'#1264d8';
  const current=Number(t.current_liters||0), capacity=Number(t.capacity_liters||0);
  const pct=capacity>0?Math.max(0,Math.min(100,current/capacity*100)):0;
  const sold=Number(inv.sales_liters||0), purchases=Number(inv.purchases_liters||0);
  const dischargeFromMovements=movements.filter(m=>String(m.movement_type||'').toLowerCase()==='discharge').reduce((sum,m)=>sum+Math.abs(Number(m.quantity_liters||0)),0);
  const discharge=Number(inv.discharge_liters ?? inv.discharges_liters ?? dischargeFromMovements);
  const expected=inv.expected_liters==null?null:Number(inv.expected_liters);
  const difference=inv.stock_difference_liters==null?null:Number(inv.stock_difference_liters);
  const performance=capacity>0?sold/capacity*100:0;
  const body=modal.querySelector('#admin-inventory-tank-details-body');
  modal.querySelector('#admin-inventory-tank-details-title').textContent=t.tank_code||'Tank';
  modal.querySelector('.admin-inventory-tank-details-card').style.setProperty('--product-color',pc);
  const metric=(label,value,sub='')=>'<div class="admin-inventory-tank-detail-metric"><span>'+h(label)+'</span><strong>'+h(value)+'</strong>'+(sub?'<small>'+h(sub)+'</small>':'')+'</div>';
  const movementLabel=type=>({opening:'Opening',purchase:'Discharge',sale:'Sale',discharge:'Tank Discharge',adjustment:'Adjustment',dip:'Dip'})[type]||type||'Movement';
  const rows=movements.slice(0,8).map(m=>{
    const type=String(m.movement_type||'').toLowerCase(), qty=Math.abs(Number(m.quantity_liters||0));
    const signed=(type==='sale'||type==='discharge')?-qty:qty;
    return '<div class="admin-inventory-tank-movement-row"><div><strong>'+h(movementLabel(type))+'</strong><small>'+new Date(m.created_at).toLocaleString()+'</small></div><b class="'+(signed<0?'negative':'positive')+'">'+(signed>0?'+':signed<0?'−':'')+liters(qty)+' L</b></div>';
  }).join('')||'<div class="admin-inventory-tank-empty">No movement history.</div>';
  const hero='<div class="admin-inventory-tank-detail-hero"><div><span>PRODUCT</span><strong>'+h(product.code_name||t.product||'—')+'</strong></div><div><span>STOCK</span><strong>'+liters(current)+' L</strong><small>'+pct.toFixed(1)+'% full</small></div></div>';
  const statistics='<section class="admin-inventory-tank-detail-section"><div class="admin-inventory-tank-detail-section-head">INVENTORY STATISTICS</div><div class="admin-inventory-tank-detail-metrics">'+
    metric('CAPACITY',liters(capacity)+' L','tank capacity')+
    metric('CURRENT STOCK',liters(current)+' L',pct.toFixed(1)+'% full')+
    metric('DISCHARGE',liters(discharge)+' L','recorded discharge')+
    metric('FUEL SOLD',liters(sold)+' L','recorded sales')+
    metric('PURCHASES',liters(purchases)+' L','received volume')+
    metric('PERFORMANCE',performance.toFixed(1)+'%','sales vs capacity')+
    metric('EXPECTED',expected==null?'—':liters(expected)+' L','calculated stock')+
    metric('STOCK DIFFERENCE',difference==null?'—':liters(difference)+' L','actual vs expected')+
    '</div></section>';
  const performanceSection='<section class="admin-inventory-tank-detail-section"><div class="admin-inventory-tank-detail-section-head">STOCK PERFORMANCE</div><div class="admin-inventory-tank-detail-metrics">'+
    metric('FILL LEVEL',pct.toFixed(1)+'%','current / capacity')+
    metric('AVAILABLE',liters(current)+' L','usable stock')+
    metric('OUTFLOW',liters(sold+discharge)+' L','sales + discharge')+
    metric('NET RECEIPTS',liters(purchases)+' L','purchases recorded')+
    '</div></section>';
  const slideOne='<article class="admin-inventory-tank-slide active">'+hero+statistics+performanceSection+'</article>';
  const slideTwo='<article class="admin-inventory-tank-slide">'+
    '<section class="admin-inventory-tank-detail-section"><div class="admin-inventory-tank-detail-section-head">RECENT MOVEMENTS <small>Last 8</small></div><div class="admin-inventory-tank-movement-list">'+rows+'</div></section>'+
    '</article>';
  body.innerHTML='<div class="admin-inventory-tank-slides">'+slideOne+slideTwo+'</div><div class="admin-inventory-tank-slide-controls"><button type="button" class="admin-inventory-tank-slide-arrow" data-inventory-slide-prev aria-label="Previous">‹</button><div class="admin-inventory-tank-slide-dots"><button type="button" class="admin-inventory-tank-slide-dot active" data-inventory-slide-to="0" aria-label="Statistics"></button><button type="button" class="admin-inventory-tank-slide-dot" data-inventory-slide-to="1" aria-label="Recent movements"></button></div><button type="button" class="admin-inventory-tank-slide-arrow" data-inventory-slide-next aria-label="Next">›</button></div>';
  modal.classList.add('open'); modal.setAttribute('aria-hidden','false');
}
async function adminInventory(){
  try{
    await window.stationCurrencyReady; const me=await currentUser(); if(me.role!=='admin')return location.href='admin-login.html';
    const [allTanks,allProducts,allDispensers,inventory,movements,purchases]=await Promise.all([api('/api/tanks'),api('/api/products'),api('/api/nozzles'),api('/api/inventory-summary'),api('/api/tank-movements'),api('/api/purchases')]);
    const products=allProducts.filter(p=>p.active===true), tanks=allTanks.filter(t=>t.active===true&&products.some(p=>String(p.name).toLowerCase()===String(t.product||'').toLowerCase())), dispensers=allDispensers.filter(d=>d.active===true&&tanks.some(t=>t.id===d.tank_id));
    window.__adminInventoryState={tanks,products,inventory,movements,purchases};
    const codeForProduct=p=>{const x=products.find(x=>String(x.name).toLowerCase()===String(p||'').toLowerCase());return x?.code_name||p||'—';}, el=id=>document.getElementById(id);
    const productForTank=t=>products.find(p=>String(p.name||'').toLowerCase()===String(t.product||'').toLowerCase())||{};
    const tankGroups=products.map(p=>({product:p,items:tanks.filter(t=>String(t.product||'').toLowerCase()===String(p.name||'').toLowerCase())})).filter(g=>g.items.length);
    const groupedTankIds=new Set(tankGroups.flatMap(g=>g.items.map(t=>String(t.id))));
    const unmatchedTanks=tanks.filter(t=>!groupedTankIds.has(String(t.id)));
    const renderInventoryTankCard=(t,product)=>{
      const pct=Number(t.capacity_liters)>0?Math.max(0,Math.min(100,Number(t.current_liters)/Number(t.capacity_liters)*100)):0;
      const pc=String(product?.color||'#1264d8').trim()||'#1264d8';
      return '<article class="stat inventory-tank-card" id="inventory-tank-'+h(t.id)+'" data-tank-id="'+h(t.id)+'" role="button" tabindex="0" aria-label="View '+h(t.tank_code||'tank')+' details" style="--product-color:'+h(pc)+'"><div class="inventory-tank-card-top"><div><span class="field-label">TANK</span><b>'+h(t.tank_code)+'</b></div><span class="inventory-tank-status">ACTIVE</span></div><div class="inventory-tank-card-product"><span>PRODUCT</span><strong>'+h(product?.code_name||codeForProduct(t.product))+'</strong></div><div class="inventory-tank-card-stock"><strong>'+liters(t.current_liters)+' L</strong><span>'+pct.toFixed(1)+'% full</span></div></article>';
    };
    const renderInventoryTankPerformanceGraph=(g,pc)=>{
      const rows=g.items.map(t=>{
        const cap=Number(t.capacity_liters||0), stock=Number(t.current_liters||0);
        return {id:String(t.id),code:String(t.tank_code||'Tank'),stock,capacity:cap,pct:cap>0?Math.max(0,Math.min(100,stock/cap*100)):0};
      }).sort((a,b)=>b.pct-a.pct);
      const max=100;
      const bars=rows.map(r=>{
        const width=Math.max(0,Math.min(max,r.pct));
        return '<div class="inventory-tank-performance-row"><div class="inventory-tank-performance-label"><strong>'+h(r.code)+'</strong><span>'+r.pct.toFixed(1)+'%</span></div><div class="inventory-tank-performance-track"><span style="width:'+width.toFixed(2)+'%;background:'+h(pc)+'"></span></div><div class="inventory-tank-performance-stock">'+liters(r.stock)+' / '+liters(r.capacity)+' L</div></div>';
      }).join('');
      const avg=rows.length?rows.reduce((s,r)=>s+r.pct,0)/rows.length:0;
      const highest=rows[0]?.code||'—';
      return '<div class="inventory-tank-performance"><div class="inventory-tank-performance-head"><div><span class="field-label">STOCK PERFORMANCE</span><strong>Tank comparison</strong></div><div class="inventory-tank-performance-summary"><span>AVG</span><b>'+avg.toFixed(1)+'%</b><small>Highest: '+h(highest)+'</small></div></div><div class="inventory-tank-performance-chart">'+bars+'</div></div>';
    };
    const renderInventoryTankGroup=g=>{
      const pc=String(g.product.color||'#1264d8').trim()||'#1264d8';
      return '<section class="inventory-product-group" style="--product-color:'+h(pc)+'"><div class="inventory-product-group-head"><span class="inventory-product-dot"></span><div><span class="field-label">PRODUCT</span><strong>'+h(g.product.code_name||g.product.name||'—')+'</strong></div><span class="inventory-product-count">'+g.items.length+' tank'+(g.items.length===1?'':'s')+'</span></div><div class="inventory-tank-grid">'+g.items.map(t=>renderInventoryTankCard(t,g.product)).join('')+'</div>'+renderInventoryTankPerformanceGraph(g,pc)+'</section>';
    };
    let inventoryTankMarkup=tankGroups.map(renderInventoryTankGroup).join('');
    if(unmatchedTanks.length) inventoryTankMarkup+='<section class="inventory-product-group inventory-unmatched-group"><div class="inventory-product-group-head"><span class="inventory-product-dot"></span><div><span class="field-label">PRODUCT</span><strong>Other / Unmatched</strong></div><span class="inventory-product-count">'+unmatchedTanks.length+' tank'+(unmatchedTanks.length===1?'':'s')+'</span></div><div class="inventory-tank-grid">'+unmatchedTanks.map(t=>renderInventoryTankCard(t,productForTank(t))).join('')+'</div></section>';
    el('tanks').innerHTML=inventoryTankMarkup||'<div class="empty-content">No activated tanks.</div>';
    ensureAdminInventoryTankDetailsModal();
    el('tanks').querySelectorAll('.inventory-tank-card').forEach(card=>{card.addEventListener('click',()=>openAdminInventoryTankDetails(card.dataset.tankId));card.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();openAdminInventoryTankDetails(card.dataset.tankId);}});});
    const tankHash=String(location.hash||'');
    if(tankHash.startsWith('#tank-')){
      const targetTankId=decodeURIComponent(tankHash.slice('#tank-'.length));
      setTimeout(()=>{const target=document.getElementById('inventory-tank-'+targetTankId);if(target){target.scrollIntoView({behavior:'smooth',block:'center'});target.classList.add('purchase-card-linked');setTimeout(()=>target.classList.remove('purchase-card-linked'),2200);}},100);
    }
    const movementGroups=new Map();
    (Array.isArray(movements)?movements:[]).forEach(m=>{
      const k=String(m.tank_id||m.tank_code||'');
      if(!movementGroups.has(k))movementGroups.set(k,[]);
      movementGroups.get(k).push(m);
    });
    tanks.forEach(t=>{
      if(!movementGroups.has(String(t.id))){
        movementGroups.set(String(t.id),[{
          tank_id:t.id,tank_code:t.tank_code,tank_product:t.product,
          current_liters:t.current_liters,capacity_liters:t.capacity_liters,
          no_movement_history:true
        }]);
      }
    });

    const movementTypeLabel={
      opening:'Opening',purchase:'Discharge',sale:'Sale',discharge:'Discharge',
      adjustment:'Adjustment',dip:'Dip',transfer:'Transfer'
    };
    const movementTypeIcon={
      opening:'◷',purchase:'↓',sale:'↑',discharge:'↘',
      adjustment:'±',dip:'⌁',transfer:'⇄'
    };
    const movementTypeClass={
      opening:'opening',purchase:'purchase',sale:'sale',discharge:'discharge',
      adjustment:'adjustment',dip:'dip',transfer:'transfer'
    };
    const movementRows=[...(Array.isArray(movements)?movements:[])];
    const purchaseById=new Map((Array.isArray(purchases)?purchases:[]).map(p=>[String(p.id),p]));
    const purchaseByInvoice=new Map((Array.isArray(purchases)?purchases:[]).filter(p=>p.invoice_number).map(p=>[String(p.invoice_number).trim().toLowerCase(),p]));
    const purchaseForMovement=m=>{
      const direct=m?.invoice_number||m?.purchase_invoice||'';
      const directId=m?.purchase_id||m?.reference_id||'';
      if(directId&&purchaseById.has(String(directId)))return purchaseById.get(String(directId));
      if(direct&&purchaseByInvoice.has(String(direct).trim().toLowerCase()))return purchaseByInvoice.get(String(direct).trim().toLowerCase());
      return purchaseById.get(String(directId))||null;
    };
    const movementStats={
      tanks:tanks.length,
      stock:tanks.reduce((sum,t)=>sum+Number(t.current_liters||0),0),
      purchases:movementRows.filter(m=>String(m.movement_type||'').toLowerCase()==='purchase').reduce((sum,m)=>sum+Math.abs(Number(m.quantity_liters||0)),0),
      sales:movementRows.filter(m=>String(m.movement_type||'').toLowerCase()==='sale').reduce((sum,m)=>sum+Math.abs(Number(m.quantity_liters||0)),0)
    };
    const productOptions=products.filter(p=>tanks.some(t=>String(t.product||'').toLowerCase()===String(p.name||'').toLowerCase()));
    const movementGroupMarkup=[...movementGroups.values()]
      .sort((a,b)=>String(a[0]?.tank_code||'').localeCompare(String(b[0]?.tank_code||'')))
      .map(rows=>{
        rows=[...rows].sort((a,b)=>new Date(b.created_at||0)-new Date(a.created_at||0));
        const f=rows[0]||{};
        const current=Number(f.current_liters||0),cap=Number(f.capacity_liters||0);
        const pct=cap>0?Math.max(0,Math.min(100,current/cap*100)):0;
        const product=productForTank({product:f.tank_product});
        const pc=String(product?.color||'#1264d8').trim()||'#1264d8';
        const productCode=String(product?.code_name||codeForProduct(f.tank_product)||'—');
        const allMovementRows=rows.filter(m=>!m.no_movement_history);
        const visibleRows=allMovementRows.slice(0,3);
        const movementCount=allMovementRows.length;
        return '<section class="tank-movement-group" data-tank-code="'+h(f.tank_code||'Tank')+'" data-product="'+h(String(f.tank_product||''))+'" style="--product-color:'+h(pc)+'">'+
          '<div class="tank-movement-group-head">'+
            '<div class="tank-movement-heading">'+
              '<span class="tank-movement-product" style="color:'+h(pc)+'"><i style="background:'+h(pc)+'"></i>'+h(productCode)+'</span>'+
              '<h4>'+h(f.tank_code||'Tank')+'</h4>'+
              '<small class="tank-movement-capacity">'+(cap>0?liters(cap)+' L capacity':'Capacity not set')+'</small>'+
            '</div>'+
            '<div class="tank-movement-current">'+
              '<strong>'+liters(current)+' L</strong>'+
              '<span>'+pct.toFixed(1)+'% full</span>'+
            '</div>'+
          '</div>'+
          '<div class="tank-movement-stockbar"><span style="width:'+pct.toFixed(2)+'%;background:'+h(pc)+'"></span></div>'+
          '<div class="tank-movement-list">'+
            (visibleRows.length?visibleRows.map(m=>{
              const type=String(m.movement_type||'').toLowerCase();
              const qty=Math.abs(Number(m.quantity_liters||0));
              const isOut=type==='sale'||type==='discharge';
              const signed=isOut?-qty:qty;
              const date=m.created_at?new Date(m.created_at):null;
              const dateText=date&&!Number.isNaN(date.getTime())?date.toLocaleString(): '—';
              return '<div class="tank-movement-row" data-movement-type="'+h(type)+'">'+
                '<div class="tank-movement-icon '+h(movementTypeClass[type]||'other')+'">'+h(movementTypeIcon[type]||'•')+'</div>'+
                '<div class="tank-movement-main">'+
                  '<strong>'+h(movementTypeLabel[type]||m.movement_type||'Movement')+'</strong>'+
                  '<small>'+h(dateText)+(m.notes?' · '+h(m.notes):'')+(type==='purchase'&&purchaseForMovement(m)?.invoice_number?' · <a href="#" class="tank-movement-invoice-link" data-purchase-invoice="'+h(String(purchaseForMovement(m)?.invoice_number||''))+'" data-purchase-id="'+h(String(purchaseForMovement(m)?.id||''))+'">Invoice '+h(String(purchaseForMovement(m)?.invoice_number||''))+'</a>':'')+'</small>'+
                '</div>'+
                '<div class="tank-movement-qty '+(signed<0?'negative':'positive')+'">'+
                  (signed>0?'+':signed<0?'−':'')+liters(qty)+' L'+
                '</div>'+
                '<div class="tank-movement-balance"><small>Balance</small><strong>'+liters(m.balance_after)+' L</strong></div>'+
              '</div>';
            }).join(''):'<div class="tank-movement-no-history"><strong>No movement history</strong><span>Current stock is '+liters(current)+' L.</span></div>')+
          '</div>'+
          (movementCount>3?'<button type="button" class="tank-movement-more" data-tank-movement-show="'+h(String(f.tank_id||''))+'">Show more · '+movementCount+' movements</button>':'')+
        '</section>';
      }).join('');

    const movementToolbar='<div class="tank-movement-toolbar">'+
      '<div class="tank-movement-stats">'+
        '<div><span>TANKS</span><strong>'+movementStats.tanks+'</strong></div>'+
        '<div><span>STOCK</span><strong>'+liters(movementStats.stock)+' L</strong></div>'+
        '<div><span>PURCHASES</span><strong>+'+liters(movementStats.purchases)+' L</strong></div>'+
        '<div><span>SALES</span><strong>−'+liters(movementStats.sales)+' L</strong></div>'+
      '</div>'+
    '</div>'+
    '<div class="tank-movement-results">'+movementGroupMarkup+'</div>';
    el('tank-movements').innerHTML=movementToolbar;
    if(!movementGroupMarkup){
      el('tank-movements').innerHTML='<div class="tank-movement-empty-filter"><strong>No tank movements recorded.</strong><span>There are no active tanks or movement records to display.</span></div>';
    }
    const ensureTankMovementModal=()=>{
      if(document.getElementById('tank-movement-detail-modal'))return;
      const modal=document.createElement('div');
      modal.id='tank-movement-detail-modal';
      modal.className='tank-movement-detail-modal';
      modal.innerHTML='<div class="tank-movement-detail-backdrop" data-tank-movement-close></div>'+
        '<div class="tank-movement-detail-card" role="dialog" aria-modal="true">'+
          '<div class="tank-movement-detail-head"><div><span class="field-label">TANK MOVEMENTS</span><h3 id="tank-movement-detail-title">Movements</h3></div><button type="button" class="tank-movement-detail-close" data-tank-movement-close aria-label="Close">×</button></div>'+
          '<div class="tank-movement-detail-body" id="tank-movement-detail-body"></div>'+
        '</div>';
      document.body.appendChild(modal);
      modal.addEventListener('click',e=>{
        if(e.target.closest('[data-tank-movement-close]'))modal.classList.remove('is-open');
      });
    };
    el('tank-movements').addEventListener('click',e=>{
      const link=e.target.closest('.tank-movement-invoice-link');
      if(!link)return;
      e.preventDefault();
      const id=String(link.dataset.purchaseId||'');
      if(id&&typeof openPurchaseDetail==='function')openPurchaseDetail(id);
      else toast('Purchase invoice could not be opened.');
    });
    el('tank-movements').querySelectorAll('[data-tank-movement-show]').forEach(btn=>{
      btn.addEventListener('click',()=>{
        const tankId=String(btn.dataset.tankMovementShow||'');
        const rows=movementRows.filter(m=>String(m.tank_id||'')===tankId)
          .sort((a,b)=>new Date(b.created_at||0)-new Date(a.created_at||0));
        const tank=tanks.find(t=>String(t.id)===tankId);
        const product=productForTank(tank||{});
        const pc=String(product?.color||'#1264d8');
        ensureTankMovementModal();
        const modal=document.getElementById('tank-movement-detail-modal');
        const title=document.getElementById('tank-movement-detail-title');
        const body=document.getElementById('tank-movement-detail-body');
        title.textContent=(tank?.tank_code||rows[0]?.tank_code||'Tank')+' · '+(product?.code_name||codeForProduct(tank?.product||rows[0]?.tank_product)||'—');
        body.innerHTML=rows.map(m=>{
          const type=String(m.movement_type||'').toLowerCase();
          const qty=Math.abs(Number(m.quantity_liters||0));
          const out=type==='sale'||type==='discharge';
          const signed=out?-qty:qty;
          const dt=m.created_at?new Date(m.created_at):null;
          return '<div class="tank-movement-detail-row">'+
            '<div class="tank-movement-icon '+h(movementTypeClass[type]||'other')+'">'+h(movementTypeIcon[type]||'•')+'</div>'+
            '<div class="tank-movement-main"><strong>'+h(movementTypeLabel[type]||m.movement_type||'Movement')+'</strong><small>'+h(dt&&!Number.isNaN(dt.getTime())?dt.toLocaleString():'—')+(m.notes?' · '+h(m.notes):'')+(type==='purchase'&&purchaseForMovement(m)?.invoice_number?' · <a href="#" class="tank-movement-invoice-link" data-purchase-invoice="'+h(String(purchaseForMovement(m)?.invoice_number||''))+'" data-purchase-id="'+h(String(purchaseForMovement(m)?.id||''))+'">Invoice '+h(String(purchaseForMovement(m)?.invoice_number||''))+'</a>':'')+'</small></div>'+
            '<div class="tank-movement-qty '+(signed<0?'negative':'positive')+'">'+(signed>0?'+':signed<0?'−':'')+liters(qty)+' L</div>'+
            '<div class="tank-movement-balance"><small>Balance</small><strong>'+liters(m.balance_after)+' L</strong></div>'+
          '</div>';
        }).join('')||'<div class="tank-movement-empty-filter"><strong>No movement history</strong></div>';
        modal.style.setProperty('--product-color',pc);
        modal.classList.add('is-open');
      });
    });
  }catch(e){const s=document.getElementById('page-status');if(s)s.textContent=e.message;if(e.message==='Unauthorized')location.href='admin-login.html';}
}
function closeAdminAttendantDetails(){
  const modal=document.getElementById('admin-attendant-details-modal');
  if(modal){modal.classList.remove('open');modal.setAttribute('aria-hidden','true');}
}
function fmtAttendantDate(v){
  if(!v)return '—';
  const d=new Date(v); return Number.isNaN(d.getTime())?'—':d.toLocaleString();
}
async function openAdminAttendantDetails(id){
  let modal=document.getElementById('admin-attendant-details-modal');
  if(!modal){
    modal=document.createElement('div');
    modal.id='admin-attendant-details-modal';
    modal.className='admin-attendant-details-modal';
    modal.setAttribute('aria-hidden','true');
    modal.innerHTML='<div class="admin-attendant-details-backdrop" onclick="closeAdminAttendantDetails()"></div><div class="admin-attendant-details-card" role="dialog" aria-modal="true"><div class="admin-attendant-details-top"><h3>Attendant Details</h3><button type="button" class="admin-attendant-details-close" onclick="closeAdminAttendantDetails()">×</button></div><div id="admin-attendant-details-content" class="admin-attendant-details-content"><p class="muted">Loading…</p></div></div>';
    document.body.appendChild(modal);
  }
  modal.classList.add('open'); modal.setAttribute('aria-hidden','false');
  const box=document.getElementById('admin-attendant-details-content');
  if(box)box.innerHTML='<p class="muted">Loading attendant data…</p>';
  try{
    const [employees,shifts,nozzles,products,salesResult]=await Promise.all([
      api('/api/users'),api('/api/shifts'),api('/api/nozzles'),api('/api/products'),api('/api/sales/history').then(data=>({ok:true,data})).catch(()=>({ok:false,data:[]}))
    ]);
    const employee=(Array.isArray(employees)?employees:[]).find(e=>String(e.id)===String(id));
    if(!employee){if(box)box.innerHTML='<p class="muted">Attendant not found.</p>';return;}
    const allShifts=Array.isArray(shifts)?shifts:[], allNozzles=Array.isArray(nozzles)?nozzles:[], allProducts=Array.isArray(products)?products:[];
    const belongsToEmployee=s=>[s.employee_id,s.attendant_id,s.user_id,s.operator_user_id].some(v=>v!=null&&String(v)===String(employee.id));
    const employeeShifts=allShifts.filter(belongsToEmployee);
    const activeShifts=employeeShifts.filter(s=>String(s.status||'').trim().toLowerCase()==='active');
    const history=Array.isArray(salesResult.data)?salesResult.data:[];
    const salesItems=history.filter(x=>{
      const t=x?.takeover||x?.shift||x||{};
      const ids=[t.from_employee_id,t.to_employee_id,t.employee_id,t.attendant_id,t.user_id,t.operator_user_id,x?.employee_id,x?.attendant_id];
      return ids.some(v=>v!=null&&String(v)===String(employee.id));
    });
    const sales=salesItems.flatMap(x=>Array.isArray(x.sales)?x.sales:(Array.isArray(x.sale_items)?x.sale_items:[]));
    const totalLiters=sales.reduce((n,s)=>n+(Number(s.quantity_liters||s.liters)||0),0);
    const totalAmount=sales.reduce((n,s)=>n+(Number(s.total_amount||s.amount)||0),0);
    const avg=employeeShifts.length?totalLiters/employeeShifts.length:0;
    const now=new Date();
    const monthStart=new Date(now.getFullYear(),now.getMonth(),1); monthStart.setHours(0,0,0,0);
    const elapsedMonthDays=Math.max(1,now.getDate());
    const monthlySales=sales.filter(s=>{
      const raw=s.sale_time||s.created_at||s.confirmed_at||s.createdAt;
      const d=raw?new Date(raw):null;
      return d&&!Number.isNaN(d.getTime())&&d>=monthStart&&d<=now;
    });
    const monthlyAmount=monthlySales.reduce((n,s)=>n+(Number(s.total_amount||s.amount)||0),0);
    const monthlyLiters=monthlySales.reduce((n,s)=>n+(Number(s.quantity_liters||s.liters)||0),0);
    const dailyAverageSales=monthlyAmount/elapsedMonthDays;
    const dailyAverageLiters=monthlyLiters/elapsedMonthDays;
    const chartEnd=new Date(); chartEnd.setHours(23,59,59,999);
    const chartStart=new Date(chartEnd); chartStart.setDate(chartStart.getDate()-6); chartStart.setHours(0,0,0,0);
    const chartDays=Array.from({length:7},(_,i)=>{const d=new Date(chartStart);d.setDate(chartStart.getDate()+i);return d;});
    const dailyVolumes=chartDays.map(day=>{
      const key=day.toDateString();
      return sales.reduce((sum,s)=>{
        const raw=s.sale_time||s.created_at||s.confirmed_at||s.createdAt;
        const d=raw?new Date(raw):null;
        return sum+(d&&!Number.isNaN(d.getTime())&&d.toDateString()===key?(Number(s.quantity_liters||s.liters)||0):0);
      },0);
    });
    const chartMax=Math.max(1,...dailyVolumes);
    const chartW=320,chartH=100,chartGap=9,barW=28;
    const chartBars=dailyVolumes.map((v,i)=>{
      const bh=Math.max(v>0?3:0,(v/chartMax)*66);
      const x=10+i*(barW+chartGap),y=76-bh;
      return '<g><rect x="'+x+'" y="'+y.toFixed(1)+'" width="'+barW+'" height="'+bh.toFixed(1)+'" rx="4" fill="#1769df" opacity="'+(v>0?'0.92':'0.18')+'"><title>'+h(chartDays[i].toLocaleDateString()+': '+liters(v)+' L')+'</title></rect><text x="'+(x+barW/2)+'" y="94" text-anchor="middle" font-size="9" fill="#778395">'+h(chartDays[i].toLocaleDateString(undefined,{weekday:'short'}))+'</text></g>';
    }).join('');
    const shiftRows=employeeShifts.slice().sort((a,b)=>new Date(b.shift_started_at||b.created_at||0)-new Date(a.shift_started_at||a.created_at||0)).slice(0,12).map(s=>{
      const n=allNozzles.find(x=>String(x.id)===String(s.nozzle_id));
      const p=allProducts.find(x=>String(x.id)===String(n?.product_id)||String(x.name||'').toLowerCase()===String(n?.product||'').toLowerCase());
      return '<div class="admin-attendant-shift"><div class="admin-attendant-shift-head"><strong>'+h(n?.nozzle_code||s.nozzle_id||'Dispenser')+'</strong><span>'+h(s.status||'—')+'</span></div><p>'+h(p?.code_name||n?.product||p?.name||'Product not assigned')+'</p><div class="admin-attendant-shift-grid"><div><span>Started</span><b>'+h(fmtAttendantDate(s.shift_started_at||s.created_at))+'</b></div><div><span>Ended</span><b>'+h(fmtAttendantDate(s.shift_ended_at))+'</b></div><div><span>Shift</span><b>'+h(String(s.id||'').slice(0,8)||'—')+'</b></div></div></div>';
    }).join('');
    const performance=totalLiters>0?'Active sales performance':'No confirmed sales yet';
    if(box)box.innerHTML=
      '<div class="admin-attendant-swipe" data-attendant-swipe><div class="admin-attendant-swipe-track" data-attendant-swipe-track>'+
      '<section class="admin-attendant-swipe-page" aria-label="Attendant overview">'+
      '<div class="admin-attendant-hero"><div><span class="section-kicker">ATTENDANT</span><h2>'+h(employee.name)+'</h2><p>ID '+h(employee.operator_id||'—')+' · '+h(employee.active===true?'Active':'Inactive')+'</p></div><span class="admin-attendant-status '+(activeShifts.length?'':'inactive')+'">'+(activeShifts.length?'ON SHIFT':'AVAILABLE')+'</span></div>'+
      '<div class="admin-attendant-section"><div class="admin-attendant-section-head"><span>STATISTICS</span><small>All recorded shifts</small></div><div class="admin-attendant-metrics"><div class="admin-attendant-metric"><span>Total shifts</span><strong>'+employeeShifts.length+'</strong><small>'+activeShifts.length+' active now</small></div><div class="admin-attendant-metric"><span>Sales entries</span><strong>'+sales.length+'</strong><small>confirmed records</small></div><div class="admin-attendant-metric"><span>Volume sold</span><strong>'+liters(totalLiters)+' L</strong><small>all recorded sales</small></div><div class="admin-attendant-metric"><span>Total sales</span><strong>'+money(totalAmount)+'</strong><small>all recorded sales</small></div></div></div>'+
      '<div class="admin-attendant-section"><div class="admin-attendant-section-head"><span>PERFORMANCE</span><small>'+h(now.toLocaleString(undefined,{month:'long',year:'numeric'}))+'</small></div><div class="admin-attendant-metrics"><div class="admin-attendant-metric"><span>Daily average sales</span><strong>'+money(dailyAverageSales)+'</strong><small>monthly sales value ÷ '+elapsedMonthDays+' days</small></div><div class="admin-attendant-metric"><span>Daily average volume</span><strong>'+liters(dailyAverageLiters)+' L</strong><small>monthly liters ÷ '+elapsedMonthDays+' days</small></div><div class="admin-attendant-metric"><span>Monthly sales</span><strong>'+money(monthlyAmount)+'</strong><small>'+monthlySales.length+' confirmed entries this month</small></div><div class="admin-attendant-metric"><span>Monthly volume</span><strong>'+liters(monthlyLiters)+' L</strong><small>current month to date</small></div></div><div class="admin-attendant-performance-chart"><div class="admin-attendant-chart-summary"><span>Daily sales volume · last 7 days</span><strong>'+liters(dailyVolumes.reduce((n,v)=>n+v,0))+' L</strong></div><svg viewBox="0 0 '+chartW+' '+chartH+'" role="img" aria-label="Daily liters sold over the last seven days" preserveAspectRatio="xMidYMid meet"><line x1="5" y1="76" x2="315" y2="76" stroke="#e5eaf0" stroke-width="1"/>'+chartBars+'</svg><p class="admin-attendant-chart-note">'+(dailyVolumes.some(v=>v>0)?'Daily volume from confirmed sales records.':'No dated sales records available for this attendant in the last 7 days.')+'</p></div></div>'+
      '</section><section class="admin-attendant-swipe-page" aria-label="Attendant shift records">'+
      '<div class="admin-attendant-section admin-attendant-shifts-panel"><div class="admin-attendant-section-head"><span>SHIFT DATA</span><small>'+employeeShifts.length+' record'+(employeeShifts.length===1?'':'s')+'</small></div><div class="admin-attendant-shifts-list">'+(shiftRows||'<p class="muted">No shift records.</p>')+'</div></div>'+
      '</section></div><div class="admin-attendant-swipe-controls"><button type="button" class="admin-attendant-swipe-arrow" data-attendant-prev aria-label="Previous detail card" disabled>‹</button><div class="admin-attendant-swipe-dots"><button type="button" class="active" data-attendant-page="0" aria-label="Overview card"></button><button type="button" data-attendant-page="1" aria-label="Shift data card"></button></div><span data-attendant-page-label>1 / 2</span><button type="button" class="admin-attendant-swipe-arrow" data-attendant-next aria-label="Next detail card">›</button></div></div>';
    const swipe=box?.querySelector('[data-attendant-swipe]');
    if(swipe){
      const track=swipe.querySelector('[data-attendant-swipe-track]');
      const pages=[...swipe.querySelectorAll('[data-attendant-page]')];
      const prev=swipe.querySelector('[data-attendant-prev]');
      const next=swipe.querySelector('[data-attendant-next]');
      const label=swipe.querySelector('[data-attendant-page-label]');
      let page=0;
      const goTo=(index)=>{
        page=Math.max(0,Math.min(1,index));
        track.style.transform='translateX(-'+(page*100)+'%)';
        pages.forEach((b,i)=>b.classList.toggle('active',i===page));
        if(prev)prev.disabled=page===0;
        if(next)next.disabled=page===1;
        if(label)label.textContent=(page+1)+' / 2';
      };
      prev?.addEventListener('click',()=>goTo(page-1));
      next?.addEventListener('click',()=>goTo(page+1));
      pages.forEach((b,i)=>b.addEventListener('click',()=>goTo(i)));
      let touchStartX=0;
      track.addEventListener('touchstart',e=>{touchStartX=e.changedTouches[0]?.clientX||0;},{passive:true});
      track.addEventListener('touchend',e=>{const dx=(e.changedTouches[0]?.clientX||touchStartX)-touchStartX;if(Math.abs(dx)>45)goTo(page+(dx<0?1:-1));},{passive:true});
    }
  }catch(e){if(box)box.innerHTML='<p class="muted">'+h(e.message||'Unable to load attendant details.')+'</p>';}
}
function renderAdminAttendantWeeklyRanking(attendants,history){
  const rankingBox=document.getElementById('attendant-weekly-ranking');
  const summaryBox=document.getElementById('attendant-weekly-summary');
  if(!rankingBox)return;
  const now=new Date(); now.setHours(23,59,59,999);
  const start=new Date(now); start.setDate(start.getDate()-6); start.setHours(0,0,0,0);
  const weekly=(Array.isArray(history)?history:[]).filter(item=>{
    const t=item?.takeover||item||{};
    const raw=t.shift_ended_at||t.sales_confirmed_at||t.shift_started_at||t.created_at||item?.created_at||item?.sale_time;
    const d=new Date(raw);
    return !Number.isNaN(d.getTime())&&d>=start&&d<=now;
  });
  const stats=new Map((attendants||[]).map(e=>[String(e.id),{employee:e,liters:0,amount:0,entries:0,days:Array(7).fill(0)}]));
  weekly.forEach(item=>{
    const t=item?.takeover||item||{};
    const attendantId=t.to_employee_id||t.employee_id||t.attendant_id||t.from_employee_id;
    if(attendantId==null)return;
    const row=stats.get(String(attendantId)); if(!row)return;
    const raw=t.shift_ended_at||t.sales_confirmed_at||t.shift_started_at||t.created_at||item?.created_at||item?.sale_time;
    const d=new Date(raw); const dayIndex=Math.floor((new Date(d.getFullYear(),d.getMonth(),d.getDate())-new Date(start.getFullYear(),start.getMonth(),start.getDate()))/86400000);
    if(dayIndex<0||dayIndex>6)return;
    const sales=Array.isArray(item?.sales)?item.sales:[];
    const volume=sales.reduce((n,s)=>n+(Number(s.quantity_liters)||0),0) || Number(t.total_sales_liters||item?.total_sales_liters||0);
    const amount=sales.reduce((n,s)=>n+(Number(s.total_amount||s.amount)||0),0) || Number(t.total_sales_amount||item?.total_sales_amount||0);
    row.liters+=volume; row.amount+=amount; row.entries+=sales.length||((volume||amount)?1:0); row.days[dayIndex]+=volume;
  });
  const sorted=[...stats.values()].sort((a,b)=>b.liters-a.liters||b.amount-a.amount);
  const totalLiters=sorted.reduce((n,x)=>n+x.liters,0);
  const totalAmount=sorted.reduce((n,x)=>n+x.amount,0);
  if(summaryBox)summaryBox.innerHTML='<div class="admin-weekly-summary-item"><span>Total volume</span><strong>'+liters(totalLiters)+' L</strong></div><div class="admin-weekly-summary-item"><span>Sales value</span><strong>'+money(totalAmount)+'</strong></div><div class="admin-weekly-summary-item"><span>Attendants ranked</span><strong>'+sorted.length+'</strong></div>';
  const max=Math.max(1,...sorted.map(x=>x.liters));
  const dayLabels=Array.from({length:7},(_,i)=>{const d=new Date(start);d.setDate(start.getDate()+i);return d.toLocaleDateString(undefined,{weekday:'short'});});
  rankingBox.innerHTML=sorted.length?sorted.map((row,i)=>{
    const best=Math.max(1,...row.days);
    const bars=row.days.map((v,j)=>'<span title="'+h(dayLabels[j]+': '+liters(v)+' L')+'" style="height:'+Math.max(3,Math.round(v/best*22))+'px"></span>').join('');
    return '<div class="admin-weekly-rank-row"><div class="admin-weekly-rank-place '+(i===0?'first':i===1?'second':i===2?'third':'')+'">'+(i+1)+'</div><div class="admin-weekly-rank-person"><strong>'+h(row.employee.name||'Attendant')+'</strong><small>ID '+h(row.employee.operator_id||'—')+' · '+row.entries+' sales record'+(row.entries===1?'':'s')+'</small><div class="admin-weekly-bar-track"><span style="width:'+Math.max(0,Math.min(100,row.liters/max*100))+'%"></span></div><div class="admin-weekly-day-bars" aria-label="Daily liters">'+bars+'</div></div><div class="admin-weekly-rank-score"><strong>'+liters(row.liters)+' L</strong><small>'+money(row.amount)+'</small></div></div>';
  }).join(''):'<div class="admin-weekly-empty"><strong>No confirmed sales this week</strong><span>Weekly rankings will appear when sales are recorded.</span></div>';
}
async function adminAttendants(){
  try{
    await window.stationCurrencyReady;
    const me=await currentUser();
    if(me.role!=='admin')return location.href='admin-login.html';
    const [employees,shifts,dispensers,salesResult]=await Promise.all([api('/api/users'),api('/api/shifts'),api('/api/nozzles'),api('/api/sales/history').then(data=>({ok:true,data})).catch(()=>({ok:false,data:[]}))]);
    const active=employees.filter(e=>e.active===true&&e.role==='attendant');
    const activeShifts=shifts.filter(s=>String(s.status||'').trim().toLowerCase()==='active');
    renderAdminAttendantWeeklyRanking(active,Array.isArray(salesResult.data)?salesResult.data:[]);
    const el=document.getElementById('attendants');
    if(!el)return;
    el.innerHTML=active.length?active.map(e=>{
      const employeeShifts=activeShifts.filter(s=>[s.employee_id,s.attendant_id,s.user_id,s.operator_user_id].some(v=>v!=null&&String(v)===String(e.id)));
      const stations=employeeShifts.map(shift=>{
        const d=dispensers.find(x=>String(x.id)===String(shift.nozzle_id));
        return d?.nozzle_code||shift.nozzle_id||'Assigned dispenser';
      });
      return '<article class="stat attendant-admin-card admin-attendant-card" onclick="openAdminAttendantDetails(&quot;'+h(e.id)+'&quot;)" role="button" tabindex="0" onkeydown="if(event.key===\'Enter\'||event.key===\' \'){event.preventDefault();openAdminAttendantDetails(&quot;'+h(e.id)+'&quot;)}">'+
        '<div class="attendant-content-row"><div class="attendant-content-main"><span class="field-label">ATTENDANT</span><b>'+h(e.name)+'</b><span class="operator-id">ID '+h(e.operator_id||'—')+'</span></div><div class="content-status"><i class="status-dot '+(employeeShifts.length?'is-active':'')+'"></i><span>'+(employeeShifts.length?'Active shift':'Available')+'</span></div></div>'+
        '<div class="attendant-shift-row"><span class="field-label">SHIFT'+(employeeShifts.length>1?'S':'')+'</span><div class="attendant-shift-list">'+(stations.length?stations.map(station=>'<strong>'+h(station)+'</strong>').join(''): '<strong>No active shift</strong>')+'</div></div>'+
      '</article>';
    }).join(''):'<div class="empty-content">No activated attendants.</div>';
  }catch(e){const s=document.getElementById('page-status');if(s)s.textContent=e.message;if(e.message==='Unauthorized')location.href='admin-login.html';}
}
async function adminAccountingControl(){
  try{
    await window.stationCurrencyReady; const me=await currentUser(); if(me.role!=='admin')return location.href='admin-login.html';
    await loadAccountingPeriod();
  }catch(e){const s=document.getElementById('page-status');if(s)s.textContent=e.message;if(e.message==='Unauthorized')location.href='admin-login.html';}
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
function createGenericReportPdf(report){
  const W=595,H=842,compact=!!report.singlePage,M=compact?26:38,CONTENT_W=W-M*2,TOP=compact?94:116,BOTTOM=compact?24:48;
  // Keep all PDF offsets byte-accurate; the generated PDF is ASCII only.
  const clean=v=>String(v==null?'':v).replace(/[•·]/g,' - ').replace(/[→➜]/g,' -> ').replace(/—/g,'-').replace(/[^ -~]/g,'');
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
    if(ensure(compact?31:42)){}
    const sh=compact?22:25;
    rect(M,y-sh,CONTENT_W,sh,[244,247,250],null);
    text(title.toUpperCase(),M+9,y-(compact?15:17),compact?7.5:9,true,[71,85,105]);
    y-=compact?30:37;
  };
  const kvGrid=(items,cols=2)=>{
    const gap=compact?6:8,w=(CONTENT_W-gap*(cols-1))/cols,h=compact?31:43;
    for(let i=0;i<items.length;i+=cols){
      const row=items.slice(i,i+cols);ensure(h+(compact?5:8));
      row.forEach((item,j)=>{
        const x=M+j*(w+gap);
        rect(x,y-h,w,h,[250,251,252],[229,234,240]);
        text(item[0],x+8,y-(compact?11:13),compact?6.5:7,false,[100,116,139]);
        const vals=wrap(item[1]||'—',Math.max(16,Math.floor(w/(compact?7.2:6.2)))).slice(0,2);
        text(vals[0],x+8,y-(compact?23:28),compact?8.5:10,true,[15,23,42]);
        if(vals[1])text(vals[1],x+8,y-(compact?29:39),compact?6.5:8,false,[71,85,105]);
      });
      y-=h+(compact?5:8);
    }
  };
  const table=(headers,rows,widths)=>{
    const total=widths.reduce((a,b)=>a+b,0),headH=compact?20:25,rowH=compact?21:27;
    ensure(headH);
    let x=M;
    widths.forEach((w,i)=>{rect(x,y-headH,w,headH,[30,64,92],null);text(headers[i],x+5,y-(compact?13:16),compact?6.2:7,true,[255,255,255]);x+=w;});
    y-=headH;
    rows.forEach(row=>{
      const wrapped=row.map((v,i)=>wrap(v,widths[i]<90?13:22).slice(0,2));
      const rh=Math.max(rowH,...wrapped.map(a=>a.length*(compact?8:10)+(compact?7:10)));
      if(y-rh<BOTTOM){pages.push([]);y=H-TOP;table(headers,[],widths);return tableRow(row,wrapped,rh);}
      tableRow(row,wrapped,rh);
    });
    function tableRow(row,wrapped,rh){
      let x=M;wrapped.forEach((lines,i)=>{
        rect(x,y-rh,widths[i],rh,[255,255,255],[231,235,239]);
        lines.forEach((v,k)=>text(v,x+5,y-(compact?11:13)-k*(compact?8:10),compact?6.5:8,k===0&&i===0,[31,41,55]));
        x+=widths[i];
      });y-=rh;
    }
    y-=compact?5:8;
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
    rect(M,y-(compact?58:66),CONTENT_W,compact?58:66,[248,250,252],[218,226,234]);
    let x=M+14;
    report.summary.forEach((s,i)=>{
      if(i)line(x-9,y-12,x-9,y-54,[220,226,232],.6);
      text(s[0],x,y-(compact?15:17),compact?6.5:7,false,[100,116,139]);
      text(s[1],x,y-(compact?34:38),compact?11:13,true,[15,23,42]);
      x+=CONTENT_W/report.summary.length;
    });
    y-=compact?70:80;
  }
  (report.sections||[]).forEach(s=>{
    section(s.title);
    if(s.fields)kvGrid(s.fields,s.cols||2);
    if(s.table)table(s.table.headers,s.table.rows,s.table.widths);
    if(s.paragraph)paragraph(s.paragraph);
  });
  const objects=[{id:1,body:'<< /Type /Catalog /Pages 2 0 R >>'}],kids=[];let next=5;
  pages.forEach((commands,pi)=>{
    const pageId=next++,contentId=next++;kids.push(pageId+' 0 R');
    commands.push(rgb(...[148,163,184])+' rg\nBT\n/F1 7 Tf\n1 0 0 1 '+M+' 25 Tm\n('+esc('Fuel Station Management - '+report.title)+') Tj\nET\n');
    commands.push(rgb(...[148,163,184])+' rg\nBT\n/F1 7 Tf\n1 0 0 1 '+(W-105)+' 25 Tm\n('+esc('Page '+(pi+1)+' / '+pages.length)+') Tj\nET\n');
    const stream=commands.join('');
    const streamBytes=new TextEncoder().encode(stream).length;
    objects.push({id:pageId,body:'<< /Type /Page /Parent 2 0 R /MediaBox [0 0 '+W+' '+H+'] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents '+contentId+' 0 R >>'},{id:contentId,body:'<< /Length '+streamBytes+' >>\nstream\n'+stream+'\nendstream'});
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

function createStyledReportPdf(report){
  if(!report.sales)return createGenericReportPdf(report);
  const W=595,H=842,M=36,CONTENT_W=W-M*2,HEADER_H=92,FOOTER_Y=24,NAVY=[18,37,63],BLUE=[37,99,235],GREEN=[34,139,85],TEXT=[31,41,55],MUTED=[100,116,139],LINE=[226,232,240],WARN=[255,246,194],WARN_TEXT=[168,91,0];
  const clean=v=>String(v==null?'':v).replace(/[•·]/g,' - ').replace(/[→➜]/g,' -> ').replace(/—/g,'-').replace(/[^ -~]/g,'');
  const esc=v=>clean(v).replace(/\\/g,'\\\\').replace(/\(/g,'\\(').replace(/\)/g,'\\)');
  const rgb=(r,g,b)=>String(r/255)+' '+String(g/255)+' '+String(b/255);
  const pages=[[]];let y=H-HEADER_H-24;
  const cmd=s=>pages[pages.length-1].push(s);
  const rect=(x,yy,w,h,fill,stroke)=>{
    let z='';if(fill)z+=rgb(...fill)+' rg\n';if(stroke)z+=rgb(...stroke)+' RG\n0.7 w\n';
    z+=x+' '+yy+' '+w+' '+h+' re '+(fill&&stroke?'B':fill?'f':'S')+'\n';cmd(z);
  };
  const text=(v,x,yy,size,bold=false,color=TEXT)=>{
    cmd(rgb(...color)+' rg\nBT\n/F'+(bold?'2':'1')+' '+size+' Tf\n1 0 0 1 '+x+' '+yy+' Tm\n('+esc(v)+') Tj\nET\n');
  };
  const line=(x1,y1,x2,y2,color=LINE,width=.7)=>cmd(rgb(...color)+' RG\n'+width+' w\n'+x1+' '+y1+' m '+x2+' '+y2+' l S\n');
  const wrap=(v,max)=>{
    const words=clean(v).split(/\s+/),out=[];let cur='';
    words.forEach(word=>{if(!word)return;const n=cur?cur+' '+word:word;if(n.length>max){if(cur)out.push(cur);cur=word;}else cur=n;});
    if(cur)out.push(cur);return out.length?out:[''];
  };
  const header=()=>{
    cmd(rgb(...NAVY)+' rg\n'+M+' '+(H-HEADER_H)+' '+CONTENT_W+' '+HEADER_H+' re f\n');
    text(report.title||'SALES REPORT',M,H-34,18,true,[255,255,255]);
    text(report.subtitle||'SHIFT SALES RECONCILIATION',M,H-53,7.5,false,[190,211,235]);
    text(report.reference||'DSR',M,H-72,9,true,[255,255,255]);
    const status=String(report.generated||'CONFIRMED').toUpperCase(),bw=Math.max(82,status.length*5.6+24),bx=W-M-bw;
    rect(bx,H-62,bw,28,[220,248,232],null);text(status,bx+12,H-51,8,true,GREEN);
  };
  const footer=(pageNo,total)=>{
    line(M,FOOTER_Y+10,W-M,FOOTER_Y+10,[232,236,241],.6);
    text('DSR - '+clean(report.dateLabel||report.reference||'Shift sales')+' - Station daily reconciliation',M,FOOTER_Y-2,6.5,false,[148,163,184]);
    text('Page '+pageNo+' of '+total,W-M-48,FOOTER_Y-2,6.5,false,[148,163,184]);
  };
  const newPage=()=>{pages.push([]);header();y=H-HEADER_H-24;};
  header();
  const section=(title)=>{
    if(y<90)newPage();rect(M,y-1,4,17,BLUE,null);text(title.toUpperCase(),M+10,y,9,true,NAVY);y-=27;
  };
  const table=(headers,rows,widths)=>{
    const headH=21,rowH=30;
    if(y-headH<FOOTER_Y+30)newPage();
    let x=M;
    headers.forEach((h,i)=>{rect(x,y-headH,widths[i],headH,NAVY,null);text(h,x+6,y-14,6.2,true,[255,255,255]);x+=widths[i];});
    y-=headH;
    rows.forEach(row=>{
      if(y-rowH<FOOTER_Y+25){newPage();table(headers,[row],widths);return;}
      x=M;
      row.forEach((v,i)=>{
        rect(x,y-rowH,widths[i],rowH,[248,249,251],[232,235,239]);
        wrap(v,widths[i]<65?10:widths[i]<110?15:28).slice(0,2).forEach((ln,k)=>text(ln,x+6,y-13-k*9,6.8,k===0&&i===0,TEXT));
        x+=widths[i];
      });
      y-=rowH;
    });
    y-=12;
  };
  const fieldColumns=(left,right)=>{
    const cols=[left||[],right||[]],gap=28,w=(CONTENT_W-gap)/2;
    cols.forEach((items,ci)=>{
      const x=M+ci*(w+gap);
      items.forEach(item=>{
        if(y<80){newPage();}
        text(item[0],x,y,7,false,MUTED);
        const val=wrap(item[1]||'-',Math.floor(w/7)).slice(0,2);
        text(val[0],x+w,y,8,true,TEXT);
        if(val[1])text(val[1],x,y-10,6.5,false,MUTED);
        line(x,y-7,x+w,y-7,LINE,.6);y-=24;
      });
    });y-=4;
  };
  const keyCards=(items)=>{
    const gap=10,n=items.length||1,w=(CONTENT_W-gap*(n-1))/n,h=51;
    if(y-h<FOOTER_Y+30)newPage();
    items.forEach((item,i)=>{
      const x=M+i*(w+gap),highlight=!!item[2];
      rect(x,y-h,w,h,highlight?WARN:[244,246,249],null);
      text(item[0],x+10,y-15,6.2,false,MUTED);
      text(item[1],x+10,y-36,10,true,highlight?WARN_TEXT:TEXT);
    });y-=65;
  };
  const summary=()=>{
    section('OVERVIEW');
    const vals=Array.isArray(report.summary)?report.summary:[],gap=10,n=vals.length||1,w=(CONTENT_W-gap*(n-1))/n,h=55;
    vals.forEach((s,i)=>{const x=M+i*(w+gap);rect(x,y-h,w,h,[244,246,249],null);text(s[0],x+10,y-16,6.5,false,MUTED);text(s[1],x+10,y-38,11.5,true,i===1?GREEN:TEXT);});
    y-=70;
  };
  const s=report.sales||{};
  summary();
  section('SHIFT DETAILS');
  fieldColumns(
    [['Dispenser',s.dispenserCode],['Product',s.productCode],['Tank',s.tankCode],['Attendant',s.attendant],['Shift',s.shiftName]],
    [['DSR ID',s.dsrId],['Started',s.startedAt],['Ended',s.endedAt],['Shift ID',s.shiftId],['Status',s.statusLabel]]
  );
  section('DISPENSER & NOZZLE PERFORMANCE');
  table(['DISPENSER / NOZZLE','PRODUCT','TANK','OPENING','CLOSING','SOLD'],s.readingRows&&s.readingRows.length?s.readingRows:[['-',s.productCode,s.tankCode,'-','-',(s.totalLiters||0)+' L']],[132,82,92,70,70,77]);
  section('TANK RECONCILIATION');
  table(['TANK','OPENING STOCK','CLOSING STOCK','TANK SALES','STOCK VARIANCE','VARIANCE %'],[[s.tankCode,s.tankOpening||'-',s.tankClosing||'-',s.totalLiters||'0 L',s.tankDifference||'-',s.variancePct||'-']],[118,88,90,82,90,84]);
  keyCards([['ADJUSTMENT',s.adjustment||'+0 L'],['CONTINUITY',s.continuity||'+0 L'],['DIFFERENCE',s.tankDifference||'-',true],['VARIANCE',s.variancePct||'-',true]]);
  section('RECORDED SALES');
  table(['#','SALE TYPE','AMOUNT','DESCRIPTION / REASON'],s.saleRows&&s.saleRows.length?s.saleRows:[['-','No sale entries recorded','-','-']],[30,140,100,287]);
  newPage();
  section('SALES TOTAL');
  keyCards([['TOTAL LITERS SOLD',(s.totalLiters||0)+' L'],['CALCULATED AMOUNT',s.totalAmount||'-'],['ENTRIES TOTAL',s.entryTotal||'-'],['DIFFERENCE',s.difference||'-',Number(s.differenceValue||0)>0]]);
  section('TIMING & REFERENCE');
  fieldColumns([['Submitted',s.submittedAt],['Confirmed',s.confirmedAt]],[['DSR ID',s.dsrId],['Shift ID',s.shiftId]]);
  section('RECONCILIATION OVERVIEW');
  fieldColumns([['Liters sold',(s.totalLiters||0)+' L'],['Calculated sales',s.totalAmount||'-'],['Recorded entries',s.entryTotal||'-'],['Financial difference',s.difference||'-'],['Meter reconciliation',s.reconciliation||'-']],[['Tank opening',s.tankOpening||'-'],['Tank closing',s.tankClosing||'-'],['Tank difference',s.tankDifference||'-'],['Variance',s.variancePct||'-'],['Status',s.statusLabel||'-']]);
  section('FINAL SHIFT PERFORMANCE');
  fieldColumns([['Report status',s.statusLabel||'CONFIRMED'],['Fuel sold',(s.totalLiters||0)+' L'],['Calculated sales',s.totalAmount||'-'],['Entered payments',s.entryTotal||'-'],['Financial difference',s.difference||'-']],[['Dispenser',s.dispenserCode||'-'],['Product',s.productCode||'-'],['Tank',s.tankCode||'-'],['Attendant',s.attendant||'-'],['Shift',s.shiftName||'-']]);
  const objects=[{id:1,body:'<< /Type /Catalog /Pages 2 0 R >>'}],kids=[];let next=5,total=pages.length;
  pages.forEach((commands,pi)=>{
    const pageId=next++,contentId=next++;kids.push(pageId+' 0 R');footer(pi+1,total);
    const stream=commands.join(''),bytes=new TextEncoder().encode(stream).length;
    objects.push({id:pageId,body:'<< /Type /Page /Parent 2 0 R /MediaBox [0 0 '+W+' '+H+'] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents '+contentId+' 0 R >>'});
    objects.push({id:contentId,body:'<< /Length '+bytes+' >>\nstream\n'+stream+'\nendstream'});
  });
  objects.push({id:2,body:'<< /Type /Pages /Kids ['+kids.join(' ')+'] /Count '+total+' >>'},{id:3,body:'<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'},{id:4,body:'<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>'});
  objects.sort((a,b)=>a.id-b.id);
  let pdf='%PDF-1.4\n';const offsets=[];
  objects.forEach(o=>{offsets[o.id]=pdf.length;pdf+=o.id+' 0 obj\n'+o.body+'\nendobj\n';});
  const xref=pdf.length;pdf+='xref\n0 '+(objects.length+1)+'\n0000000000 65535 f \n';
  for(let i=1;i<=objects.length;i++)pdf+=String(offsets[i]||0).padStart(10,'0')+' 00000 n \n';
  pdf+='trailer\n<< /Size '+(objects.length+1)+' /Root 1 0 R >>\nstartxref\n'+xref+'\n%%EOF';
  return new Blob([pdf],{type:'application/pdf'});
}
/* ===== Shared PDF report engine (Sales / Purchase / DSR). Plain JS, no libraries. A4, 36pt margins. ===== */
function createPdfDoc(){
  const W=595.28,H=841.89,M=36,CW=W-M*2,BOTTOM=792;
  const WR=[278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556, 1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556, 333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584],WB=[278, 333, 474, 556, 556, 889, 722, 238, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 333, 333, 584, 584, 584, 611, 975, 722, 722, 722, 722, 667, 611, 778, 722, 278, 556, 722, 611, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 333, 278, 333, 584, 556, 333, 556, 611, 556, 611, 556, 333, 611, 611, 278, 278, 556, 278, 889, 611, 611, 611, 611, 389, 556, 333, 611, 556, 778, 556, 556, 500, 389, 280, 389, 584];
  const C={NAVY:[20,33,61],BLUE:[37,99,235],INK:[17,24,39],GRAY:[107,114,128],CARD:[243,244,246],LINE:[229,231,235],GREEN:[21,128,61],AMBER:[180,83,9],AMBERBG:[254,243,199]};
  const d={W,H,M,CW,BOTTOM,C,y:0,topY:40};
  const pages=[[]];
  const clean=v=>String(v==null?'':v).replace(/\u2022/g,'\u00b7').replace(/[\u2192\u279c]/g,'->').replace(/[\u2013\u2014\u2212]/g,'-').replace(/[\u00a0\u202f]/g,' ').replace(/[^ -~\u00b7]/g,'');
  const esc=v=>clean(v).replace(/\\/g,'\\\\').replace(/\(/g,'\\(').replace(/\)/g,'\\)').replace(/\u00b7/g,'\\267');
  const tw=(v,size,bold)=>{const t=bold?WB:WR;let n=0;clean(v).split('').forEach(c=>{const k=c.charCodeAt(0);n+=k===183?278:(t[k-32]||556);});return n*size/1000;};
  const fit=(v,size,bold,max)=>{let s=clean(v);if(tw(s,size,bold)<=max)return s;while(s.length>1&&tw(s+'...',size,bold)>max)s=s.slice(0,-1);return s+'...';};
  const wrap=(v,size,bold,max)=>{const out=[];let line='';clean(v).split(/\s+/).forEach(word=>{if(!word)return;
    const cand=line?line+' '+word:word;
    if(tw(cand,size,bold)<=max){line=cand;return;}
    if(line)out.push(line);line=word;
    while(tw(line,size,bold)>max&&line.length>1){let k=line.length-1;while(k>1&&tw(line.slice(0,k),size,bold)>max)k--;out.push(line.slice(0,k));line=line.slice(k);}
  });if(line)out.push(line);return out.length?out:[''];};
  const col=c=>(c[0]/255).toFixed(4)+' '+(c[1]/255).toFixed(4)+' '+(c[2]/255).toFixed(4);
  const n2=v=>(Math.round(v*100)/100).toString();
  const cmd=s=>pages[pages.length-1].push(s);
  const Y=t=>n2(H-t);
  const rrPath=(x,t,w,h,r)=>{r=Math.min(r,w/2,h/2);const k=r*.5523,b=H-t-h,l=x,rt=x+w,tp=H-t;
    return n2(l+r)+' '+n2(b)+' m '+n2(rt-r)+' '+n2(b)+' l '+n2(rt-r+k)+' '+n2(b)+' '+n2(rt)+' '+n2(b+r-k)+' '+n2(rt)+' '+n2(b+r)+' c '+
      n2(rt)+' '+n2(tp-r)+' l '+n2(rt)+' '+n2(tp-r+k)+' '+n2(rt-r+k)+' '+n2(tp)+' '+n2(rt-r)+' '+n2(tp)+' c '+
      n2(l+r)+' '+n2(tp)+' l '+n2(l+r-k)+' '+n2(tp)+' '+n2(l)+' '+n2(tp-r+k)+' '+n2(l)+' '+n2(tp-r)+' c '+
      n2(l)+' '+n2(b+r)+' l '+n2(l)+' '+n2(b+r-k)+' '+n2(l+r-k)+' '+n2(b)+' '+n2(l+r)+' '+n2(b)+' c h ';};
  const box=(x,t,w,h,fill,rad)=>cmd(col(fill)+' rg '+(rad?rrPath(x,t,w,h,rad)+'f':n2(x)+' '+Y(t+h)+' '+n2(w)+' '+n2(h)+' re f')+'\n');
  const outline=(x,t,w,h,rad)=>cmd('1 1 1 rg '+col(C.LINE)+' RG .6 w '+rrPath(x+.3,t+.3,w-.6,h-.6,rad)+'B\n');
  const hline=(x1,x2,t,c,wd)=>cmd(col(c||C.LINE)+' RG '+(wd||.6)+' w '+n2(x1)+' '+Y(t)+' m '+n2(x2)+' '+Y(t)+' l S\n');
  // style: true/'b' bold, 'i' italic, falsy regular. align: 'r' right-aligns at x, 'c' centres on x.
  const text=(v,x,base,size,style,color,align)=>{
    const bold=style===true||style==='b',s=clean(v),w=tw(s,size,bold);
    const px=align==='r'?x-w:align==='c'?x-w/2:x;
    cmd(col(color||C.INK)+' rg BT /F'+(bold?2:style==='i'?3:1)+' '+size+' Tf 1 0 0 1 '+n2(px)+' '+Y(base)+' Tm ('+esc(s)+') Tj ET\n');
  };
  Object.assign(d,{clean,tw,fit,wrap,box,outline,hline,text});
  d.newPage=()=>{pages.push([]);d.y=d.topY;};
  d.ensure=h=>{if(d.y+h>BOTTOM)d.newPage();};
  d.section=(title,x,t)=>{box(x,t,3,13.4,C.BLUE);text(clean(title).toUpperCase(),x+10,t+10.2,10.5,true,C.NAVY);};

  d.header=o=>{
    box(0,0,W,o.h,C.NAVY);
    text(o.kicker,M,o.kBase,8.5,true,[147,197,253]);
    text(fit(o.title,22,true,380),M,o.tBase,22,true,[255,255,255]);
    if(o.subtitle)text(fit(o.subtitle,o.subSize||9.5,false,400),M,o.sBase,o.subSize||9.5,false,[203,213,225]);
    if(o.status){
      const lab=clean(o.status).toUpperCase(),pw=Math.max(96.3,tw(lab,10,true)+19.6);
      const warn=o.statusTone?o.statusTone==='warn':/pending|draft|open|partial|undischarged/i.test(lab);
      box(W-M-pw,o.pillTop,pw,25,warn?C.AMBERBG:[220,252,231],12.5);
      text(lab,W-M-pw/2,o.pillBase,10,true,warn?C.AMBER:C.GREEN,'c');
    }
  };

  // Card row(s). item: {label,value,size,tone:'good'|'warn',style:'dark'|'outline'}. Returns total height.
  d.cards=(items,o)=>{
    const gap=o.gap==null?10:o.gap,per=o.perRow||items.length,h=o.h||50,pad=o.pad||12;
    const eq=(CW-gap*(per-1))/per;let x=M,t=o.top;
    items.forEach((it,i)=>{
      const c=i%per;if(c===0&&i>0){t+=h+gap;x=M;}
      const w=o.widths?o.widths[i]:eq;
      const dark=it.style==='dark',warn=it.tone==='warn';
      if(dark)box(x,t,w,h,C.NAVY,4.5);else if(it.style==='outline')outline(x,t,w,h,4.5);else box(x,t,w,h,warn?C.AMBERBG:C.CARD,4.5);
      text(clean(it.label).toUpperCase(),x+pad,t+o.labelBase,o.labelSize||8,false,dark?[209,213,219]:C.GRAY);
      const size=it.size||o.valSize||10.5;
      text(fit(it.value,size,true,w-pad-6),x+pad,t+o.valBase,size,true,dark?[255,255,255]:it.tone==='good'?C.GREEN:warn?C.AMBER:C.INK);
      x+=w+gap;
    });
    return Math.ceil(items.length/per)*(h+gap)-gap;
  };

  // Two-column label/value blocks. cols:[{title,rows:[{label,value,small,tone}]},...]. Returns height from d.y.
  d.rowsBlock=(cols,o)=>{
    const colW=(CW-24)/2;let tallest=0;
    cols.forEach((c,ci)=>{
      const x=M+ci*(colW+24);
      if(c.title)d.section(c.title,x,d.y);
      let t=d.y+o.start;
      c.rows.forEach(rw=>{
        const rh=o.step+(rw.small?2:0),size=rw.small?7.5:(o.valSize||9.5),base=t+o.base+(rw.small?2:0);
        text(rw.label,x,base,o.size||9.5,false,C.GRAY);
        text(fit(rw.value,rw.small?7.5:(rw.big||size),true,colW-(o.valPad||80)),x+colW,base,rw.small?7.5:(rw.big||size),true,rw.tone==='good'?C.GREEN:rw.tone==='warn'?C.AMBER:C.INK,'r');
        hline(x,x+colW,t+rh);t+=rh;
      });
      tallest=Math.max(tallest,t-d.y);
    });
    return tallest;
  };

  // Full-width label/value lines (label left, bold value right). rows:[{label,value,big}]
  d.lines=(rows,o)=>{
    let t=d.y;
    rows.forEach(rw=>{
      const sz=rw.big?11.5:9;
      text(rw.label,M,t+o.base,sz,false,C.GRAY);
      text(rw.value,W-M,t+o.base,sz,true,C.INK,'r');
      hline(M,W-M,t+o.step);t+=o.step;
    });
    return t-d.y;
  };

  // Table with section bar. cols:[{h,x,a:'r',b,max,wrap}], rows: arrays of string | {t,b,tone,sub}; row.tone=[...] optional
  d.table=(title,cols,rows,o)=>{
    o=Object.assign({hdrH:24,hdrGap:25.9,hdrBase:15,minH:30,baseOff:19,numOff:19,nameOff:13,subOff:24,rowLine:true,zebra:false,lineW:.6,after:20},o||{});
    d.ensure(o.hdrGap+o.hdrH+o.minH+10);
    d.section(title,M,d.y);d.y+=o.hdrGap;
    const head=()=>{box(M,d.y,CW,o.hdrH,C.NAVY,6);cols.forEach(c=>text(clean(c.h).toUpperCase(),M+c.x,d.y+o.hdrBase,7.5,true,[255,255,255],c.a==='r'?'r':'l'));d.y+=o.hdrH;};
    head();
    rows.forEach((row,ri)=>{
      const cells=cols.map((c,i)=>{const v=row[i];return(v&&typeof v==='object')?v:{t:v};});
      const hasSub=cells.some(c=>c.sub!=null);
      const lines=cells.map((c,i)=>cols[i].wrap?wrap(c.t,9.5,!!(c.b||cols[i].b),cols[i].wrap):[fit(c.t,hasSub&&c.sub!=null?9:9.5,!!(c.b||cols[i].b),cols[i].max||200)]);
      const n=Math.max.apply(null,lines.map(l=>l.length)),rh=Math.max(o.minH,n*11.5+18.5);
      if(d.y+rh>BOTTOM){d.newPage();head();}
      if(!o.zebra||ri%2===0)box(M,d.y,CW,rh,C.CARD);
      cells.forEach((c,i)=>{
        const align=cols[i].a==='r'?'r':'l',bx=M+cols[i].x,bold=!!(c.b||cols[i].b),tone=(row.tone&&row.tone[i])||c.tone||C.INK;
        if(c.sub!=null){
          text(lines[i][0],bx,d.y+o.nameOff,9,true,tone,align);
          text(fit(c.sub,8,false,300),bx,d.y+o.subOff,8,false,C.GRAY,align);
        }else lines[i].forEach((s,k)=>text(s,bx,d.y+(hasSub?o.numOff:o.baseOff)+k*11.5,9.5,bold,tone,align));
      });
      if(o.rowLine||ri===rows.length-1)hline(M,M+CW,d.y+rh-.3,C.LINE,o.lineW);
      d.y+=rh;
    });
    d.y+=o.after;
  };

  d.pageCount=()=>pages.length;
  d.finish=(footerLeft,title)=>{
    const objs=[],kids=[];let next=7;
    pages.forEach((cmds,pi)=>{
      const pid=next++,cid=next++;kids.push(pid+' 0 R');
      cmds.push(col(C.LINE)+' RG .5 w '+M+' '+Y(802)+' m '+n2(W-M)+' '+Y(802)+' l S\n');
      cmds.push(col(C.GRAY)+' rg BT /F1 8 Tf 1 0 0 1 '+M+' '+Y(813.8)+' Tm ('+esc(footerLeft)+') Tj ET\n');
      const pg='Page '+(pi+1)+' of '+pages.length;
      cmds.push(col(C.GRAY)+' rg BT /F1 8 Tf 1 0 0 1 '+n2(W-M-tw(pg,8,false))+' '+Y(813.8)+' Tm ('+pg+') Tj ET\n');
      const stream=cmds.join('');
      objs.push([pid,'<< /Type /Page /Parent 2 0 R /MediaBox [0 0 '+W+' '+H+'] /Resources << /Font << /F1 3 0 R /F2 4 0 R /F3 6 0 R >> >> /Contents '+cid+' 0 R >>']);
      objs.push([cid,'<< /Length '+stream.length+' >>\nstream\n'+stream+'endstream']);
    });
    const all=[[1,'<< /Type /Catalog /Pages 2 0 R >>'],[2,'<< /Type /Pages /Kids ['+kids.join(' ')+'] /Count '+pages.length+' >>'],
      [3,'<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>'],
      [4,'<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>'],
      [5,'<< /Title ('+esc(title)+') /Producer (Fuel Station Management) >>'],
      [6,'<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Oblique /Encoding /WinAnsiEncoding >>']].concat(objs);
    let pdf='%PDF-1.4\n';const off=[];
    all.forEach(o=>{off[o[0]]=pdf.length;pdf+=o[0]+' 0 obj\n'+o[1]+'\nendobj\n';});
    const xref=pdf.length;pdf+='xref\n0 '+(all.length+1)+'\n0000000000 65535 f \n';
    for(let i=1;i<=all.length;i++)pdf+=String(off[i]).padStart(10,'0')+' 00000 n \n';
    pdf+='trailer\n<< /Size '+(all.length+1)+' /Root 1 0 R /Info 5 0 R >>\nstartxref\n'+xref+'\n%%EOF';
    return new Blob([pdf],{type:'application/pdf'});
  };
  return d;
}

/* ---------- SALES REPORT ---------- */
function createSalesReportPdf(r){
  const d=createPdfDoc(),M=d.M;
  d.header({kicker:'SALES REPORT  \u00b7  CONFIRMED SHIFT SALES DETAIL',title:r.title,subtitle:r.subtitle,h:84,kBase:28,tBase:54,sBase:71,pillTop:31.5,pillBase:48.5,status:r.statusLabel});
  d.y=105.8;
  d.section('Overview',M,d.y);d.y+=24.5;
  d.y+=d.cards(r.overview,{top:d.y,perRow:4,h:50,labelBase:17.7,valBase:38.7})+20;
  d.ensure(130);
  d.y+=d.rowsBlock([{title:r.leftTitle,rows:r.left},{title:r.rightTitle,rows:r.right}],{start:12,step:20,base:14})+30;
  d.table('Opening & closing meter readings',[
    {h:'Nozzle',x:10,max:120},{h:'Product',x:140,max:65},{h:'Tank',x:210,max:90},
    {h:'Opening',x:370,a:'r'},{h:'Closing',x:440,a:'r'},{h:'Sold',x:d.CW-10,a:'r',b:true}],r.meterRows);
  d.table('Tank opening & closing stock',[
    {h:'Tank',x:10,max:110},{h:'Opening stock',x:200,a:'r'},{h:'Closing stock',x:280,a:'r'},
    {h:'Tank sales',x:360,a:'r',b:true},{h:'Stock variance',x:440,a:'r',b:true},{h:'Variance %',x:d.CW-10,a:'r',b:true}],r.tankRows);
  d.table('Recorded sales',[
    {h:'#',x:10},{h:'Sale type',x:38,max:150},{h:'Amount',x:268,a:'r',b:true},{h:'Description / reason',x:288,wrap:d.CW-288-10}],r.saleRows);
  d.ensure(134.1);
  d.section('Sales total',M,d.y);d.y+=24.1;
  d.y+=d.cards(r.totals1,{top:d.y,perRow:4,h:50,labelBase:17.7,valBase:38.7})+10;
  d.y+=d.cards(r.totals2,{top:d.y,perRow:3,h:50,labelBase:17.7,valBase:38.7})+10;
  return d.finish('Fuel Station Management  \u00b7  SALES REPORT','Sales Report - '+r.title);
}

/* ---------- PURCHASE REPORT ---------- */
function createPurchaseReportPdf(r){
  const d=createPdfDoc(),M=d.M,C=d.C;
  d.header({kicker:'PURCHASE HISTORY  \u00b7  PURCHASE DETAIL',title:r.title,subtitle:r.subtitle,subSize:10,h:90,kBase:30,tBase:56,sBase:74,pillTop:33.5,pillBase:50.5,status:r.statusLabel});
  d.y=110.2;
  d.section('Quantities',M,d.y);d.y+=25.9;
  d.y+=d.cards(r.quantities,{top:d.y,perRow:4,h:62,labelSize:8.5,labelBase:19.9,valBase:43.9,valSize:17});
  const noteLines=r.note?d.wrap(r.note,8.5,false,d.CW):[];
  noteLines.forEach((s,i)=>d.text(s,M,d.y+13.9+i*11,8.5,'i',C.GRAY));
  d.y+=31.9+Math.max(0,noteLines.length-1)*11;
  d.ensure(120);
  d.y+=d.rowsBlock([{title:'Order',rows:r.order},{title:'Truck & driver',rows:r.truck}],{start:14,step:20,base:14,valPad:90})+18;
  d.ensure(25.9+44+30);
  d.section('Truck compartments',M,d.y);d.y+=25.9;
  d.y+=d.cards(r.compartments,{top:d.y,perRow:4,h:44,labelSize:8.5,labelBase:16.1,valBase:35.1,valSize:14})+20.1;
  d.table('Discharge history',[
    {h:'#',x:8,b:true},{h:'Date / time (UTC)',x:28,max:100},{h:'Tank',x:136,max:100},{h:'Quantity',x:250,a:'r',b:true},
    {h:'Stock before',x:326,a:'r'},{h:'Expected closing',x:414,a:'r'},{h:'Recorded closing',x:d.CW-8,a:'r',b:true}],
    r.dischargeRows,{zebra:true,rowLine:false,minH:34,baseOff:21,after:0});
  if(r.info){d.ensure(40);d.text(r.info[0],M,d.y+16,9,false,C.GRAY);d.text(r.info[1],M+d.tw(r.info[0],9,false)+20,d.y+16,9,false,C.GRAY);d.y+=16;}
  if(r.dischargeNote){d.text(r.dischargeNote,M,d.y+14,8.5,'i',C.AMBER);d.y+=14;}
  d.y+=24.1;
  d.ensure(25.9+34+10);
  d.section('Purchase remark',M,d.y);d.y+=25.9;
  const rl=d.wrap(r.remark,10,false,d.CW-28),bh=Math.max(34,rl.length*13+21);
  d.box(M,d.y,d.CW,bh,C.CARD,4.5);
  rl.forEach((s,i)=>d.text(s,M+14,d.y+21+i*13,10,r.remarkEmpty?'i':false,r.remarkEmpty?C.GRAY:C.INK));
  d.y+=bh;
  return d.finish(r.footer,'Purchase Report - '+r.title);
}

/* ---------- DSR (DAILY SALES REPORT) ---------- */
function createDsrReportPdf(r){
  const d=createPdfDoc(),M=d.M,C=d.C;
  d.header({kicker:'DAILY SALES REPORT  \u00b7  STATION DAILY RECONCILIATION',title:r.title,h:84,kBase:28,tBase:54,pillTop:31.5,pillBase:48.5,status:r.statusLabel});
  d.y=105.8;
  // ---- page 1 ----
  d.section('Key figures',M,d.y);d.y+=24.2;
  const kw=[100.1,169.9,69.8,69.8,69.8],kg=(d.CW-kw.reduce((a,b)=>a+b,0))/4;
  d.y+=d.cards(r.key,{top:d.y,widths:kw,gap:kg,h:58,pad:10,labelBase:19,valBase:43,valSize:14})+28;
  d.table('Dispenser & nozzle performance',[
    {h:'Dispenser / nozzle',x:8,max:170},{h:'Opening',x:248,a:'r'},{h:'Closing',x:314,a:'r'},{h:'Sold',x:380,a:'r',b:true},{h:'Meter',x:446,a:'r'},{h:'Recon.',x:d.CW-8,a:'r',b:true}],
    r.dispRows,{hdrGap:25.9,hdrH:22,hdrBase:14.1,minH:36,numOff:18.1,nameOff:13.1,subOff:24.1,lineW:1,after:31.5});
  // tank table (rows then four cards per tank)
  d.ensure(26+22+36+52+40);
  d.section('Tank reconciliation',M,d.y);d.y+=25.9;
  const tcols=[{h:'Tank / product',x:8},{h:'Opening',x:206,a:'r'},{h:'Purchases',x:276,a:'r'},{h:'Sold',x:346,a:'r'},{h:'Expected',x:426,a:'r'},{h:'Recorded',x:d.CW-8,a:'r',b:true}];
  d.box(M,d.y,d.CW,22,C.NAVY,6);tcols.forEach(c=>d.text(c.h.toUpperCase(),M+c.x,d.y+14.1,7.5,true,[255,255,255],c.a==='r'?'r':'l'));d.y+=22;
  r.tanks.forEach(tk=>{
    d.ensure(36+10+42+30);
    d.box(M,d.y,d.CW,36,C.CARD);
    d.text(d.fit(tk.name,9,true,190),M+8,d.y+13.1,9,true);
    d.text(d.fit(tk.sub,8,false,190),M+8,d.y+24.1,8,false,C.GRAY);
    tk.cells.forEach((v,i)=>d.text(v,M+tcols[i+1].x,d.y+18.1,9.5,tcols[i+1].b,C.INK,'r'));
    d.hline(M,M+d.CW,d.y+35.5,C.LINE,1);d.y+=36+10;
    d.y+=d.cards(tk.cards,{top:d.y,perRow:4,gap:8,h:42,pad:10,labelBase:14.8,valBase:32.8,valSize:13})+32;
  });
  d.section('Sales statistics',M,d.y);d.y+=9;
  d.y+=d.lines(r.stats,{base:17,step:22});
  // ---- page 2 ----
  d.topY=47.9;d.newPage();
  const colW=(d.CW-24)/2;
  d.y+=d.rowsBlock([{title:'Reconciliation overview',rows:r.overview},{title:'Performance statistics',rows:r.perf}],{start:8.8,step:24,base:19,size:9,valSize:9,valPad:110})+43.4;
  d.section('Shift summary',M,d.y);d.y+=24.1;
  r.shifts.forEach(s=>{
    d.ensure(56+10);
    d.box(M,d.y,d.CW,55.5,C.CARD,4.5);
    d.text(d.fit(s.title,11,true,170),M+14,d.y+22.8,11,true);
    d.text(d.fit(s.sub,8.5,false,170),M+14,d.y+37.8,8.5,false,C.GRAY);
    s.cols.forEach((c,i)=>{const x=M+190+i*80;
      d.text(c.label.toUpperCase(),x,d.y+20.8,7.5,false,C.GRAY);
      d.text(d.fit(c.value,10.5,true,c.w||76),x,d.y+37.8,10.5,true,c.tone==='good'?C.GREEN:C.INK);});
    d.y+=55.5+10;
  });
  d.y+=18.5;
  d.y+=d.rowsBlock([{title:'Final daily performance',rows:r.finalLeft},{title:'',rows:r.finalRight}],{start:8.8,step:24,base:19,size:9,valSize:9,valPad:110})+0;
  return d.finish(r.footer,'DSR - '+r.title);
}

async function downloadAdminSaleHistoryDetails(id){
  // Generate the PDF from the same data and section order shown in the
  // Admin Sales History View Details card.
  let item=(adminSalesHistoryData.history||[]).find(x=>String(x.takeover?.id)===String(id))
    || (adminSalesData.history||[]).find(x=>String(x.takeover?.id)===String(id));
  if(!item){
    try{
      const data=await api('/api/shift-takeovers/'+encodeURIComponent(id)+'/sale-record');
      if(data?.takeover)item={takeover:data.takeover,sales:Array.isArray(data.sales)?data.sales:[]};
    }catch(e){toast(e.message||'Unable to load the sales record for PDF.');return;}
  }
  if(!item?.takeover){toast('Sales details are not available for this record.');return;}

  const t=item.takeover||{},initial=t,sales=Array.isArray(item.sales)?item.sales:[],saleMeta={};
  try{
    const data=await api('/api/shift-takeovers/'+encodeURIComponent(id)+'/sale-record');
    if(data?.takeover)Object.assign(t,data.takeover);
    if(Array.isArray(data?.sales))sales.splice(0,sales.length,...data.sales);
  }catch(_){}

  let takeovers=[],shifts=[],nozzles=[],tanks=[],products=[],employees=[];
  const results=await Promise.allSettled([
    api('/api/shift-takeovers'),api('/api/shifts'),api('/api/nozzles'),
    api('/api/tanks'),api('/api/products'),api('/api/employees')
  ]);
  takeovers=Array.isArray(results[0]?.value)?results[0].value:[];
  shifts=Array.isArray(results[1]?.value)?results[1].value:[];
  nozzles=Array.isArray(results[2]?.value)?results[2].value:[];
  tanks=Array.isArray(results[3]?.value)?results[3].value:[];
  products=Array.isArray(results[4]?.value)?results[4].value:[];
  employees=Array.isArray(results[5]?.value)?results[5].value:[];

  const fullTakeover=takeovers.find(x=>String(x.id)===String(id));
  if(fullTakeover)Object.assign(t,fullTakeover);
  const shift=shifts.find(x=>String(x.id)===String(t.shift_id));
  const nozzleId=shift?.nozzle_id||t.nozzle_id||item.dispenser?.nozzle_id;
  const nozzle=nozzles.find(x=>String(x.id)===String(nozzleId));
  const employee=employees.find(x=>String(x.id)===String(t.to_employee_id));
  const tankId=t.tank_id||nozzle?.tank_id||item.tank?.id||item.tank_id;
  const tank=tanks.find(x=>String(x.id)===String(tankId));
  const productId=tank?.product_id||item.product?.id||item.product_id;
  const product=products.find(x=>String(x.id)===String(productId)||
    String(x.name||'').toLowerCase()===String(tank?.product||item.dispenser?.product||'').toLowerCase());

  const opening=Array.isArray(t.nozzle_opening_readings)?t.nozzle_opening_readings:[];
  const closing=Array.isArray(t.nozzle_closing_readings)?t.nozzle_closing_readings:[];
  const nozzleSales=Array.isArray(t.nozzle_sales_liters)?t.nozzle_sales_liters:[];
  const ids=[];
  [...opening,...closing,...nozzleSales].forEach(x=>{
    const n=x?.nozzle_uuid||x?.nozzle_id;
    if(n!=null&&!ids.some(v=>String(v)===String(n)))ids.push(n);
  });
  if(!ids.length&&nozzleId)ids.push(nozzleId);

  const productCode=product?.code_name||item.product?.code_name||item.product_code||t.product_code||tank?.product_code||'—';
  const tankCode=tank?.tank_code||item.tank?.tank_code||item.tank_code||t.tank_code||'—';
  const dispenserCode=nozzle?.nozzle_code||item.dispenser?.nozzle_code||item.dispenser?.code||t.dispenser_code||'Dispenser';
  const attendant=employee?.name||item.to_employee?.name||t.to_employee_name||item.to_employee_id||'—';
  const fromEmployee=employees.find(x=>String(x.id)===String(t.from_employee_id));
  const fromName=item.from_employee?.name||t.from_employee_name||fromEmployee?.name||'Attendant';
  const shiftName=shift?.name||item.shift?.name||(fromName+' → '+(item.to_employee?.name||t.to_employee_name||attendant));
  const dsrId=item.dsr_id||item.dsr?.id||t.dsr_id||t.dsr?.id||dailyReportIdFromTimestamp(t.shift_started_at||shift?.start_time);
  const submittedAt=t.sales_submitted_at||initial.sales_submitted_at;
  const confirmedAt=t.sales_confirmed_at||initial.sales_confirmed_at;
  const startedAt=t.shift_started_at||shift?.start_time;
  const endedAt=t.shift_ended_at||shift?.end_time;
  const totalAmount=Number(t.total_sales_amount||initial.total_sales_amount||0);
  const totalLiters=Number(t.total_sales_liters||initial.total_sales_liters||0);
  // Tank stock is recorded on shift activation/handover. Historical sales records
  // may expose it through either the takeover or normalized shift fields.
  const tankOpening=Number(t.tank_opening_liters ?? t.opening_tank_liters ?? shift?.tank_opening_liters ?? shift?.opening_tank_liters ?? shift?.opening_liters);
  const tankClosing=Number(t.tank_closing_liters ?? t.closing_tank_liters ?? shift?.tank_closing_liters ?? shift?.closing_liters ?? shift?.closing_tank_liters);
  const recordedTankSales=Number(t.tank_sales_liters ?? t.total_sales_liters ?? totalLiters);
  const tankSold=Number.isFinite(recordedTankSales)?recordedTankSales:totalLiters;
  const status=String(t.sales_status||'confirmed').replace(/_/g,' ');
  const statusLabel=status.replace(/\b\w/g,m=>m.toUpperCase());

  const readingRows=ids.map((nid,i)=>{
    const o=opening.find(x=>String(x?.nozzle_uuid||x?.nozzle_id)===String(nid))||opening[i]||{};
    const cl=closing.find(x=>String(x?.nozzle_uuid||x?.nozzle_id)===String(nid))||closing[i]||{};
    const ss=nozzleSales.find(x=>String(x?.nozzle_uuid||x?.nozzle_id)===String(nid))||nozzleSales[i]||{};
    const nn=nozzles.find(x=>String(x.id)===String(nid))||nozzle;
    const openVal=o.opening_reading??o.reading;
    const closeVal=cl.closing_reading??cl.reading;
    const soldVal=ss.liters_sold??(Number.isFinite(Number(openVal))&&Number.isFinite(Number(closeVal))?Number(closeVal)-Number(openVal):0);
    return [nn?.nozzle_code||ss.nozzle_id||('Nozzle '+(i+1)),productCode,tankCode,reading(openVal),reading(closeVal),liters(soldVal)+' L'];
  });
  const finalReadingRows=readingRows.length?readingRows:[['—',productCode,tankCode,'—','—',liters(totalLiters)+' L']];
  const saleRows=sales.map((x,i)=>[
    String(i+1),x.sale_type_name||'Sale',money(x.amount),
    x.reason||x.sale_type_description||'—'
  ]);
  const entryTotal=sales.reduce((sum,x)=>sum+Number(x.amount||0),0);

  const tankExpected=Number.isFinite(tankOpening)?tankOpening-totalLiters:NaN;
  const tankDiff=Number.isFinite(tankOpening)&&Number.isFinite(tankClosing)?tankClosing-tankExpected:NaN;
  const variancePct=Number.isFinite(tankOpening)&&tankOpening>0&&Number.isFinite(tankDiff)?tankDiff/tankOpening*100:NaN;
  const tankOpeningLabel=Number.isFinite(tankOpening)?liters(tankOpening)+' L':'—';
  const tankClosingLabel=Number.isFinite(tankClosing)?liters(tankClosing)+' L':'—';
  const tankDiffLabel=Number.isFinite(tankDiff)?(tankDiff>=0?'+':'')+liters(tankDiff)+' L':'—';
  const varianceLabel=Number.isFinite(variancePct)?(variancePct>=0?'+':'')+variancePct.toFixed(2)+'%':'—';
  const entryTotalLabel=money(entryTotal);
  const differenceValue=Math.abs(totalAmount-entryTotal);
  const differenceLabel=money(differenceValue);
  const fmtDate=v=>{if(!v)return '—';const d=new Date(v);return Number.isNaN(d.getTime())?'—':d.toLocaleString('en-US');};
  const fmtNum=v=>{const n=Number(v);return Number.isFinite(n)?n.toLocaleString('en-US',{maximumFractionDigits:2}):'—';};
  const fmtMoney=v=>currencyLabel()+' '+Number(v||0).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});
  const WARN=[180,83,9];
  // Prefer the stored tank variance (matches the on-screen card); otherwise use the calculated one.
  const storedVar=Number(t.tank_variance_liters),storedPct=Number(t.tank_variance_pct);
  const hasTank=Number.isFinite(tankOpening)&&Number.isFinite(tankClosing);
  const varLiters=(t.tank_variance_liters!=null&&Number.isFinite(storedVar))?storedVar:tankDiff;
  const varPct=(t.tank_variance_pct!=null&&Number.isFinite(storedPct))?storedPct:variancePct;
  const varTone=Number.isFinite(varLiters)&&Math.abs(varLiters)>=0.005?WARN:[21,128,61];
  const tankRow=[tankCode,hasTank?fmtNum(tankOpening)+' L':'—',hasTank?fmtNum(tankClosing)+' L':'—',fmtNum(tankSold)+' L',
    Number.isFinite(varLiters)?(varLiters>0?'+':'')+fmtNum(varLiters)+' L':'—',
    Number.isFinite(varPct)?(varPct>0?'+':'')+varPct.toFixed(2)+'%':'—'];
  tankRow.tone=[0,0,0,0,varTone,varTone];
  const numCell=v=>{const n=Number(String(v).replace(/,/g,''));return Number.isFinite(n)?fmtNum(n):v;};
  const meterRows=finalReadingRows.map(rw=>[rw[0],rw[1],rw[2],numCell(rw[3]),numCell(rw[4]),String(rw[5]).replace(/^[\d,.\-]+/,m=>numCell(m))]);
  const blob=createSalesReportPdf({
    title:String(dsrId||'DSR'),
    subtitle:'Shift: '+shiftName,
    statusLabel:statusLabel,
    overview:[
      {label:'Dispenser',value:dispenserCode},{label:'Product',value:productCode},{label:'Tank',value:tankCode},
      {label:'Liters sold',value:fmtNum(totalLiters)+' L',size:14,tone:'good'}
    ],
    leftTitle:'Shift details',rightTitle:'Timing & reference',
    left:[
      {label:'Dispenser',value:dispenserCode},{label:'Product',value:productCode},{label:'Tank',value:tankCode},
      {label:'Attendant',value:attendant},{label:'Shift',value:shiftName}
    ],
    right:[
      {label:'DSR ID',value:dsrId||'—'},{label:'Started',value:fmtDate(startedAt)},
      {label:'Ended',value:fmtDate(endedAt)},{label:'Shift ID',value:t.shift_id||'—',small:true}
    ],
    meterRows:meterRows,
    tankRows:[tankRow],
    saleRows:sales.length?sales.map((x,i)=>[String(i+1),x.sale_type_name||'Sale',fmtMoney(x.amount),x.reason||x.sale_type_description||'—']):[['—','No sale entries recorded','—','—']],
    totals1:[
      {label:'Total liters sold',value:fmtNum(totalLiters)+' L',size:11.5},
      {label:'Calculated amount',value:fmtMoney(totalAmount),size:11.5},
      {label:'Entries total',value:fmtMoney(entryTotal),size:11.5},
      {label:'Difference',value:fmtMoney(differenceValue),size:11.5,tone:differenceValue>=0.005?'warn':undefined}
    ],
    totals2:[
      {label:'Status',value:statusLabel,size:11.5,tone:/confirmed/i.test(statusLabel)?'good':undefined},
      {label:'Submitted',value:fmtDate(submittedAt),size:11.5},
      {label:'Confirmed',value:fmtDate(confirmedAt),size:11.5}
    ]
  });
  const url=URL.createObjectURL(blob),link=document.createElement('a');
  link.href=url;
  link.download='sales-'+String(t.shift_id||id).slice(0,8)+'-report.pdf';
  document.body.appendChild(link);link.click();link.remove();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
  showAttendantActionResult('success','PDF downloaded','The confirmed sales PDF has been downloaded successfully.');
}
function downloadPurchaseDetailPdf(){
  const id=window.currentPurchaseDetailId;
  const p=window.currentPurchaseDetailData||((typeof purchaseDetailData!=='undefined'&&Array.isArray(purchaseDetailData)?purchaseDetailData:[]).find(x=>String(x.id)===String(id)));
  if(!p){toast('Purchase details are not available. Please reopen the detail card and try again.');return;}
  const history=Array.isArray(p.discharge_history)?p.discharge_history:[],compartments=Array.isArray(p.compartment_liters)?p.compartment_liters:[];
  const firstNum=(...a)=>{for(const v of a){if(v!=null&&v!==''&&Number.isFinite(Number(v)))return Number(v);}return null;};
  const fmtL=v=>v==null?'—':Number(v).toLocaleString('en-US',{maximumFractionDigits:2})+' L';
  const fmtDate=v=>{if(!v)return '—';const t=new Date(v);return Number.isNaN(t.getTime())?'—':t.toLocaleString('en-US');};
  const utcStamp=v=>{const t=new Date(v);return(!v||Number.isNaN(t.getTime()))?'—':t.toISOString().slice(0,19).replace('T','  ');};
  const isId=v=>/^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(String(v||''));
  const ordered=firstNum(p.ordered_quantity_liters,p.quantity_liters)||0;
  const delivered=firstNum(p.delivered_quantity_liters,p.quantity_liters,p.ordered_quantity_liters)||0;
  const discharged=firstNum(p.discharged_quantity_liters)||0,remaining=Math.max(0,delivered-discharged);
  const productName=p.product||p.product_name||p.product_code||'—';
  const rawStatus=String(p.status||'recorded').replace(/_/g,' '),statusLabel=rawStatus.charAt(0).toUpperCase()+rawStatus.slice(1);
  const invoice=String(p.invoice_number||'—');
  const purchaseDate=fmtDate(p.purchase_date||p.created_at);
  const entries=history.map(e=>{
    const qty=firstNum(e.quantity_liters,e.discharged_quantity_liters)||0;
    const before=firstNum(e.physical_tank_liters_before,e.system_liters_before,e.tank_liters_before,e.stock_before_liters);
    const expected=firstNum(e.expected_closing_liters,e.expected_liters,e.system_liters_before!=null?Number(e.system_liters_before)+qty:null);
    const recorded=firstNum(e.recorded_closing_liters,e.tank_liters_after,e.closing_liters,before!=null?before+qty:null);
    const who=[e.shift_attendant_name,e.attendant_name,e.discharged_by_name,e.discharged_by].find(v=>v&&!isId(v))||'—';
    return{qty,before,expected,recorded,who,status:e.tank_stock_status||'—',tank:e.tank_code||e.tank_id||'—',when:e.discharge_datetime||e.discharged_at||e.created_at};
  });
  const dischargeRows=entries.length?entries.map((e,i)=>[String(i+1),utcStamp(e.when),e.tank,fmtL(e.qty),fmtL(e.before),fmtL(e.expected),fmtL(e.recorded)])
    :[['—','No discharge operations recorded','—','—','—','—','—']];
  // Explanatory lines, built only from what the data actually shows.
  const noteParts=[];
  if(ordered>0&&Math.abs(delivered-ordered)>=0.005)noteParts.push('Delivered '+(delivered>ordered?'exceeds':'is below')+' ordered by '+fmtL(Math.abs(delivered-ordered))+'.');
  const tankSet=[...new Set(entries.map(e=>e.tank).filter(x=>x!=='—'))];
  if(entries.length>1)noteParts.push('Total discharged across '+(tankSet.length===2?'both':tankSet.length)+' tank'+(tankSet.length===1?'':'s')+': '+entries.map(e=>fmtL(e.qty)).join(' + ')+' = '+fmtL(entries.reduce((s,e)=>s+e.qty,0))+'.');
  const every=entries.length>1?(entries.length===2?' (both discharges)':' (all discharges)'):'';
  const uniq=a=>[...new Set(a)].join(', ');
  const info=entries.length?['Shift attendant(s): '+uniq(entries.map(e=>e.who))+every,'Stock status: '+uniq(entries.map(e=>e.status))+every]:null;
  const allKnown=entries.length&&entries.every(e=>e.before!=null&&e.expected!=null&&e.recorded!=null);
  const dischargeNote=(allKnown&&entries.every(e=>Math.abs(e.expected)<0.005&&Math.abs(e.recorded-(e.before+e.qty))<0.01))
    ?'Note: Expected closing is recorded as 0 L for '+(entries.length===1?'this discharge':entries.length===2?'both discharges':'all discharges')+', while recorded closing equals stock before + quantity.':null;
  const compSum=compartments.reduce((s,q)=>s+(Number(q)||0),0);
  const compCards=compartments.map((q,i)=>({label:'Compartment '+(i+1),value:fmtL(Number(q)||0),style:'outline'}));
  compCards.push({label:'Total',value:fmtL(compartments.length?compSum:delivered),style:'dark'});
  const remarkText=String(p.remark||p.purchase_remark||'').trim();
  const blob=createPurchaseReportPdf({
    title:'Invoice #'+invoice,
    subtitle:'Product: '+productName+'   \u00b7   Purchased '+purchaseDate,
    statusLabel:statusLabel,
    quantities:[
      {label:'Ordered',value:fmtL(ordered)},{label:'Delivered',value:fmtL(delivered)},
      {label:'Discharged',value:fmtL(discharged),tone:(discharged>0&&remaining<0.005)?'good':undefined},
      {label:'Undischarged',value:fmtL(remaining),tone:remaining>=0.005?'warn':undefined}
    ],
    note:noteParts.join(' '),
    order:[{label:'Invoice number',value:invoice},{label:'Purchase date',value:purchaseDate},{label:'Product',value:productName},{label:'Status',value:statusLabel}],
    truck:[{label:'Driver',value:p.driver_name||'—'},{label:'Driver phone',value:p.driver_phone||'—'},{label:'Plate number',value:p.plate_number||p.truck_plate||'—'},{label:'Compartments',value:String(p.truck_compartments||compartments.length||'—')}],
    compartments:compCards,
    dischargeRows:dischargeRows,
    info:info,
    dischargeNote:dischargeNote,
    remark:remarkText||'No purchase remark recorded.',remarkEmpty:!remarkText,
    footer:'Invoice '+invoice+'  \u00b7  '+productName+'  \u00b7  Purchase detail'
  });
  const url=URL.createObjectURL(blob),link=document.createElement('a');
  link.href=url;link.download='purchase-'+invoice.replace(/[^A-Za-z0-9_-]/g,'_')+'-report.pdf';
  document.body.appendChild(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
  toast('PDF downloaded');
}
window.downloadPurchaseDetailPdf=downloadPurchaseDetailPdf;

async function openAdminSaleHistoryDetails(id){
  // Admin Sales uses adminSalesData.history. The attendant dashboard may also
  // populate adminSalesHistoryData, but an empty attendant-only history must
  // never hide the actual Admin Sales History records.
  const historySource=(typeof adminSalesHistoryData!=='undefined'&&Array.isArray(adminSalesHistoryData.history))
    ?adminSalesHistoryData.history
    :[];
  const adminHistorySource=(typeof adminSalesData!=='undefined'&&Array.isArray(adminSalesData.history))
    ?adminSalesData.history
    :[];
  const source=historySource.length?historySource:adminHistorySource;
  const item=source.find(function(x){return String((x&&x.takeover&&x.takeover.id)||'')===String(id);})||((window.__attendantTakeoverDetailsItem&&String(window.__attendantTakeoverDetailsItem.takeover?.id)===String(id))?window.__attendantTakeoverDetailsItem:null);
  const modal=document.getElementById('admin-sale-history-details');
  const box=document.getElementById('admin-sale-history-details-content');
  const download=document.getElementById('admin-sale-history-download');
  if(!item){
    if(box)box.innerHTML='<div class="history-detail-section"><p class="muted">Shift details could not be found.</p></div>';
    if(modal){modal.classList.add('open');modal.setAttribute('aria-hidden','false');}
    return;
  }
  if(download)download.dataset.takeoverId=String(id);
  if(box)box.innerHTML='<div class="history-detail-section"><p class="muted">Loading complete shift details…</p></div>';
  if(modal){modal.classList.add('open');modal.setAttribute('aria-hidden','false');}

  let t=(item&&item.takeover)||{};
  let sales=Array.isArray(item&&item.sales)?item.sales:[];
  try{
    const data=await api('/api/shift-takeovers/'+encodeURIComponent(id)+'/sale-record');
    if(data&&data.takeover)t=data.takeover;
    if(data&&Array.isArray(data.sales))sales=data.sales;
  }catch(e){}

  try{
    const dispenser=(item.dispenser&&(
      item.dispenser.nozzle_code||item.dispenser.code||item.dispenser.name
    ))||t.dispenser_code||'Dispenser';
    const productCode=(item.product&&item.product.code_name)||item.product_code||t.product_code||'—';
    const tankCode=(item.tank&&item.tank.tank_code)||item.tank_code||t.tank_code||'—';
    const attendant=(item.to_employee&&item.to_employee.name)||t.to_employee_name||item.to_employee_id||'—';
    const from=(item.from_employee&&item.from_employee.name)||t.from_employee_name||'';
    const to=(item.to_employee&&item.to_employee.name)||t.to_employee_name||attendant;
    const shiftName=(item.shift&&item.shift.name)||((from||'Attendant')+' → '+(to||'Attendant'));
    const dsrId=item.dsr_id||(item.dsr&&item.dsr.id)||t.dsr_id||dailyReportIdFromTimestamp(t.shift_started_at);
    const submittedAt=t.sales_submitted_at||item.sales_submitted_at;
    const confirmedAt=t.sales_confirmed_at||item.sales_confirmed_at;
    const startedAt=t.shift_started_at;
    const endedAt=t.shift_ended_at;
    const totalAmount=Number(t.total_sales_amount||0);
    const totalLiters=Number(t.total_sales_liters||0);
    const status=String(t.sales_status||'confirmed').replace(/_/g,' ');
    const statusLabel=status.replace(/\b\w/g,function(m){return m.toUpperCase();});

    const opening=Array.isArray(t.nozzle_opening_readings)?t.nozzle_opening_readings:[];
    const closing=Array.isArray(t.nozzle_closing_readings)?t.nozzle_closing_readings:[];
    const nozzleSales=Array.isArray(t.nozzle_sales_liters)?t.nozzle_sales_liters:[];
    const ids=[];
    opening.concat(closing,nozzleSales).forEach(function(x){
      const n=x&&(x.nozzle_uuid||x.nozzle_id);
      if(n!=null&&ids.indexOf(n)<0)ids.push(n);
    });
    if(!ids.length&&t.nozzle_id)ids.push(t.nozzle_id);
    if(!ids.length&&(item.dispenser&&item.dispenser.nozzle_id))ids.push(item.dispenser.nozzle_id);

    const rows=ids.map(function(nid,i){
      const o=opening.find(function(x){return String((x&&x.nozzle_uuid)||x&&x.nozzle_id)===String(nid);})||opening[i]||{};
      const cl=closing.find(function(x){return String((x&&x.nozzle_uuid)||x&&x.nozzle_id)===String(nid);})||closing[i]||{};
      const s=nozzleSales.find(function(x){return String((x&&x.nozzle_uuid)||x&&x.nozzle_id)===String(nid);})||nozzleSales[i]||{};
      const openVal=o.opening_reading!=null?o.opening_reading:o.reading;
      const closeVal=cl.closing_reading!=null?cl.closing_reading:cl.reading;
      const soldVal=s.liters_sold!=null?s.liters_sold:(Number.isFinite(Number(openVal))&&Number.isFinite(Number(closeVal))?Number(closeVal)-Number(openVal):0);
      const nozzleCode=(s.nozzle_id||o.nozzle_id||cl.nozzle_id||s.nozzle_code||o.nozzle_code||cl.nozzle_code||String(nid));
      return '<div class="history-detail-reading-row"><div><strong>'+h(nozzleCode)+'</strong><small>'+h(productCode)+'</small></div><div><span>Opening</span><b>'+reading(openVal)+'</b></div><div><span>Closing</span><b>'+reading(closeVal)+'</b></div><div><span>Sold</span><b>'+liters(soldVal)+' L</b></div></div>';
    }).join('');

    const saleRows=sales.map(function(s,i){
      return '<div class="history-detail-sale"><span class="history-detail-sale-number">'+(i+1)+'</span><div class="history-detail-sale-name"><strong>'+h(s.sale_type_name||'Sale')+'</strong>'+(s.sale_type_description?'<small>'+h(s.sale_type_description)+'</small>':'')+(s.reason?'<small class="reason">Reason: '+h(s.reason)+'</small>':'')+'</div><strong class="history-detail-sale-value">'+money(s.amount)+'</strong></div>';
    }).join('');
    const entryTotal=sales.reduce(function(sum,s){return sum+Number(s.amount||0);},0);
    const tankOpening=Number(t.tank_opening_liters);
    const tankClosing=Number(t.tank_closing_liters);

    const content=[
      '<div class="history-detail-overview"><div class="history-detail-main"><span class="section-kicker">SHIFT DETAILS</span><h4>'+h(dispenser)+'</h4><p>'+h(productCode)+' · '+h(tankCode)+'</p></div><div class="history-detail-amount"><span>'+h(statusLabel)+'</span><strong>'+money(totalAmount)+'</strong><small>'+liters(totalLiters)+' L</small></div></div>',
      '<div class="history-detail-section"><div class="history-detail-section-head"><div><span class="section-kicker">SHIFT</span><h4>Shift information</h4></div></div><div class="history-detail-info-grid"><div><span>Attendant</span><strong>'+h(attendant)+'</strong></div><div><span>Shift</span><strong>'+h(shiftName)+'</strong></div><div><span>Started</span><strong>'+h(startedAt?new Date(startedAt).toLocaleString():'—')+'</strong></div><div><span>Ended</span><strong>'+h(endedAt?new Date(endedAt).toLocaleString():'—')+'</strong></div><div><span>Dispenser / Nozzle</span><strong>'+h(dispenser)+'</strong></div><div><span>Tank</span><strong>'+h(tankCode)+'</strong></div><div><span>Product</span><strong>'+h(productCode)+'</strong></div><div><span>DSR ID</span><strong class="mono">'+h(dsrId||'—')+'</strong></div><div class="wide"><span>Shift ID</span><strong class="mono">'+h(t.shift_id||'—')+'</strong></div></div></div>',
      '<div class="history-detail-section"><div class="history-detail-section-head"><div><span class="section-kicker">READINGS</span><h4>Opening & closing meter readings</h4></div></div><div class="history-detail-readings">'+(rows||'<div class="history-detail-empty">No nozzle readings were recorded.</div>')+'</div><div class="history-detail-total-row"><span>Total liters sold</span><strong>'+liters(totalLiters)+' L</strong></div></div>',
      '<div class="history-detail-section"><div class="history-detail-section-head"><div><span class="section-kicker">TANK STOCK</span><h4>Tank opening & closing stock</h4></div></div><div class="history-detail-info-grid"><div><span>Opening stock</span><strong>'+(Number.isFinite(tankOpening)?liters(tankOpening):'—')+' L</strong></div><div><span>Closing stock</span><strong>'+(Number.isFinite(tankClosing)?liters(tankClosing):'—')+' L</strong></div><div><span>Tank sales</span><strong>'+liters(t.tank_sales_liters)+' L</strong></div><div><span>Stock variance</span><strong>'+liters(t.tank_variance_liters)+' L</strong></div></div></div>',
      '<div class="history-detail-section"><div class="history-detail-section-head"><div><span class="section-kicker">SALES</span><h4>Recorded sales</h4></div><span class="history-detail-count">'+sales.length+' '+(sales.length===1?'entry':'entries')+'</span></div><div class="history-detail-sales">'+(saleRows||'<div class="history-detail-empty">No sale entries were recorded.</div>')+'</div><div class="history-detail-total-row"><span>Entries total</span><strong>'+money(entryTotal)+'</strong></div></div>',
      '<div class="history-detail-section"><div class="history-detail-info-grid"><div><span>Submitted</span><strong>'+h(submittedAt?new Date(submittedAt).toLocaleString():'—')+'</strong></div><div><span>Confirmed</span><strong>'+h(confirmedAt?new Date(confirmedAt).toLocaleString():'—')+'</strong></div></div></div>'
    ].join('');
    if(box)box.innerHTML=content;
  }catch(e){
    if(box)box.innerHTML='<div class="history-detail-section"><p class="muted">Unable to display shift details: '+h(e&&e.message?e.message:'Unknown error')+'</p></div>';
  }
}
function closeAdminSaleHistoryDetails(){const modal=document.getElementById('admin-sale-history-details');if(modal){modal.classList.remove('open');modal.setAttribute('aria-hidden','true');}}
window.openAdminSaleHistoryDetails=openAdminSaleHistoryDetails;
window.closeAdminSaleHistoryDetails=closeAdminSaleHistoryDetails;
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
        '<div class="dispenser-card-actions"><button type="button" class="dispenser-danger-action" style="width:100%;min-height:44px;padding:11px 18px;font-size:14px;" onclick="cancelAdminPendingShift(\''+pending.id+'\')">Cancel assignment</button></div>'+
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

async function _performDispenserActivation(pending){
  if(!pending?.id)return false;
  try{
    await api('/api/shifts',{method:'POST',body:JSON.stringify({
      employee_id:pending.employeeId,
      nozzle_id:pending.id,
      opening_tank_liters:pending.openingTankLiters,
      activation_nozzles:pending.selected.map(x=>({nozzle_id:x.nozzle_id,opening_reading:x.activation_number}))
    })});
    window.pendingDispenserAssignment=null;
    pendingDispenserActivationId=null;
    await loadSettingsData();
    return true;
  }catch(e){
    toast(e.message);
    return false;
  }
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
  const tank=(window.tankRecords||[]).find(x=>String(x.id)===String(d.tank_id));
  const openingTankMm=Number(document.getElementById('dispenser-activation-tank-dip')?.value);
  const openingTankLiters=tankLitersFromDip(tank,openingTankMm);
  const selected=[];
  ids.forEach((nozzleId,i)=>{
    const box=document.getElementById('nozzle-activation-input-'+i);
    const input=document.getElementById('nozzle-activation-number-'+i);
    if(box&&box.style.display!=='none'&&input&&input.value.trim()!==''&&Number(input.value)>=0){
      selected.push({nozzle_id:nozzleId,activation_number:Number(input.value)});
    }
  });
  const error=document.getElementById('dispenser-activate-error');
  const review=document.getElementById('dispenser-activation-review');
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

  const product=(window.productRecords||[]).find(p=>String(p.name||'').toLowerCase()===String(d.product||'').toLowerCase());
  const productCode=product?.code_name||d.product||'—';
  const tankCode=tank?.tank_code||d.tank_id||'Not connected';
  const nozzleReadings=selected.map(x=>'<div style="display:flex;justify-content:space-between;gap:12px;padding:7px 0;border-bottom:1px solid #edf0f3"><span>'+h(x.nozzle_id)+'</span><b>'+reading(x.activation_number)+'</b></div>').join('');
  const details=
    '<div style="display:grid;gap:10px">'+
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">'+
        '<div><span class="muted" style="font-size:11px">DISPENSER</span><b style="display:block;margin-top:3px">'+h(d.nozzle_code||id)+'</b></div>'+
        '<div><span class="muted" style="font-size:11px">PRODUCT</span><b style="display:block;margin-top:3px">'+h(productCode)+'</b></div>'+
        '<div><span class="muted" style="font-size:11px">ATTENDANT</span><b style="display:block;margin-top:3px">'+h(attendantName)+'</b></div>'+
        '<div><span class="muted" style="font-size:11px">TANK</span><b style="display:block;margin-top:3px">'+h(tankCode)+'</b></div>'+
      '</div>'+
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">'+
        '<div><span class="muted" style="font-size:11px">TANK OPENING DIP</span><b style="display:block;margin-top:3px">'+h(reading(openingTankMm))+' mm</b></div>'+
        '<div><span class="muted" style="font-size:11px">TANK OPENING VOLUME</span><b style="display:block;margin-top:3px">'+h(liters(openingTankLiters))+' L</b></div>'+
      '</div>'+
      '<div><span class="muted" style="font-size:11px">OPENING NOZZLE READINGS</span><div style="margin-top:4px">'+nozzleReadings+'</div></div>'+
      '<p class="muted" style="margin:2px 0 0">Review these details before assigning the shift. Nothing will be assigned until you press Confirm.</p>'+
    '</div>';

  window.pendingDispenserAssignment={
    id,
    employeeId,
    attendantName,
    openingTankMm,
    openingTankLiters,
    selected,
    productCode,
    tankCode
  };
  if(review)review.innerHTML='';
  const modal=document.getElementById('dispenser-activate-modal');
  if(modal){modal.classList.remove('open');modal.setAttribute('aria-hidden','true');}
  showSettingsConfirmation(
    'Confirm Shift Assignment',
    details,
    ()=>_performDispenserActivation(window.pendingDispenserAssignment),
    'Shift assigned successfully',
    h(d.nozzle_code||id)+' is now assigned to '+h(attendantName)+'.'
  );
  return true;
}

function confirmDispenserActivation(){
  return _confirmDispenserActivation();
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
          return '<div class="purchase-card" id="purchase-card-'+h(String(p.id||''))+'" data-purchase-id="'+h(String(p.id||''))+'" data-purchase-invoice="'+h(String(p.invoice_number||''))+'">'+
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
    if(location.hash&&location.hash.indexOf('#purchase-')===0){
      const purchaseId=decodeURIComponent(location.hash.slice('#purchase-'.length));
      setTimeout(()=>{
        const card=document.getElementById('purchase-card-'+CSS.escape(purchaseId));
        if(card){
          card.scrollIntoView({behavior:'smooth',block:'center'});
          card.classList.add('purchase-card-linked');
          setTimeout(()=>card.classList.remove('purchase-card-linked'),1800);
        }
      },80);
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
  const dayClosed=card.dataset.dayClosed==='true';
  const ready=dayClosed&&checks.length>0&&checks.every(x=>x.checked);
  if(selectAll){
    selectAll.checked=ready;
    selectAll.indeterminate=checks.some(x=>x.checked)&&!ready;
  }
  if(button)button.disabled=!dayClosed||checks.length===0||!ready;
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
      const dsrHash=String(location.hash||'');
      if(dsrHash.startsWith('#dsr-')){
        const targetDate=decodeURIComponent(dsrHash.slice('#dsr-'.length));
        setTimeout(()=>{
          const target=Array.from(document.querySelectorAll('.daily-confirm-card')).find(card=>String(card.dataset.reportDate||'')===targetDate);
          if(target){target.scrollIntoView({behavior:'smooth',block:'center'});target.classList.add('purchase-card-linked');setTimeout(()=>target.classList.remove('purchase-card-linked'),2200);}
        },100);
      }
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
    '<div class="dsr-history-card-body" hidden><div class="dsr-history-stats"><div class="dsr-history-stat"><span>Fuel sold</span><strong>'+liters(item.total_sales_liters)+' L</strong></div><div class="dsr-history-stat"><span>Calculated sales</span><strong>'+money(item.calculated_sales_amount ?? item.total_sales_amount ?? 0)+'</strong></div><div class="dsr-history-stat"><span>Entered payments</span><strong>'+((item.entered_payment_amount!=null)?money(item.entered_payment_amount):'—')+'</strong></div><div class="dsr-history-stat"><span>Financial difference</span><strong>'+((item.financial_difference!=null)?money(item.financial_difference):'—')+'</strong></div><div class="dsr-history-stat"><span>Shifts</span><strong>'+Number(item.shift_count||0)+'</strong></div><div class="dsr-history-stat"><span>Dispensers</span><strong>'+Number(item.dispenser_count||0)+'</strong></div></div><div class="dsr-history-actions" style="display:flex;justify-content:flex-end;margin-top:10px"><button type="button" class="primary dsr-history-report-button" style="width:50%;min-height:38px;display:inline-flex;align-items:center;justify-content:center;box-sizing:border-box;padding:0 12px;border:1px solid #4b83bd;border-radius:9px;background:#4b83bd;color:#fff;box-shadow:0 3px 9px rgba(75,131,189,.16);font:inherit;font-size:12px;font-weight:800;cursor:pointer" onclick="previewDailyReport(this.closest(\'.dsr-history-card\').dataset.dsrDate)">View Full Report</button></div></div></article>';
}
function renderDsrHistoryCard(item){
  const date=String(item?.date||'');
  const confirmedAt=item?.confirmed_at ? new Date(item.confirmed_at).toLocaleString() : 'Confirmed';
  const dateLabel=dailyReportIdLabel(date);
  return '<article class="dsr-history-card" data-dsr-date="'+h(date)+'">'+
    '<button type="button" class="dsr-history-card-head" onclick="toggleDsrCardFromShared(this)" aria-expanded="false"><span class="dsr-history-card-title"><strong>'+h(dateLabel)+'</strong><small>Confirmed '+h(confirmedAt)+'</small></span><span class="dsr-history-card-right"><span class="dsr-history-badge">✓ CONFIRMED</span><span class="dsr-history-toggle">⌄</span></span></button>'+
    '<div class="dsr-history-card-body" hidden><div class="dsr-history-stats"><div class="dsr-history-stat"><span>Fuel sold</span><strong>'+liters(item.total_sales_liters)+' L</strong></div><div class="dsr-history-stat"><span>Calculated sales</span><strong>'+money(item.calculated_sales_amount ?? item.total_sales_amount ?? 0)+'</strong></div><div class="dsr-history-stat"><span>Entered payments</span><strong>'+((item.entered_payment_amount!=null)?money(item.entered_payment_amount):'—')+'</strong></div><div class="dsr-history-stat"><span>Financial difference</span><strong>'+((item.financial_difference!=null)?money(item.financial_difference):'—')+'</strong></div><div class="dsr-history-stat"><span>Shifts</span><strong>'+Number(item.shift_count||0)+'</strong></div><div class="dsr-history-stat"><span>Dispensers</span><strong>'+Number(item.dispenser_count||0)+'</strong></div></div><div class="dsr-history-actions" style="display:flex;justify-content:flex-end;margin-top:10px"><a class="primary dsr-history-report-button" style="width:50%;min-height:38px;display:inline-flex;align-items:center;justify-content:center;box-sizing:border-box;padding:0 12px;border:1px solid #4b83bd;border-radius:9px;background:#4b83bd;color:#fff;box-shadow:0 3px 9px rgba(75,131,189,.16);font:inherit;font-size:12px;font-weight:800;text-decoration:none;cursor:pointer" href="admin-dsr-detail.html?date='+encodeURIComponent(date)+'" onclick="if(typeof window.openDsrDetailPopup===\'function\'){window.openDsrDetailPopup('+JSON.stringify(date)+');return false;}">View Full Report</a></div></div></article>';
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
  const dayClosed=item.report_day_closed!==false;
  const dayClosedMessage=!dayClosed?'This DSR can be reviewed, but confirmation stays locked until '+h(dailyReportIdLabel(item.date))+' has ended.':'';
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
    ?'<div class="daily-dsr-readiness"><div class="daily-confirm-label">'+(!dayClosed?'Confirmation locked until day end':'Completion required')+'</div>'+(dayClosed?'':('<div class="daily-dsr-readiness-row"><span>•</span><strong>'+dayClosedMessage+'</strong></div>'))+missing.map(x=>'<div class="daily-dsr-readiness-row"><span>•</span><strong>'+h(x)+'</strong></div>').join('')+'</div>'
    :'';
  return '<article class="card daily-confirm-card '+(waiting?'is-waiting':'')+'" data-report-date="'+h(item.date)+'" data-dsr-id="'+h(dailyReportIdLabel(item.date))+'" data-day-closed="'+(dayClosed?'true':'false')+'">'+
    '<div class="daily-confirm-head"><div><span class="section-kicker">'+(!dayClosed?'DSR NOT READY':(waiting?'DSR NOT READY':'DSR READY FOR CONFIRMATION'))+'</span><h3>'+h(dailyReportIdLabel(item.date))+'</h3><p class="muted">'+Number(item.dispenser_count||0)+' dispenser(s) • '+Number(item.shift_count||0)+' shift(s)</p></div><span class="pending-sale-badge">'+(!dayClosed?'Day in progress':(waiting?'Waiting':'Pending'))+'</span></div>'+
    '<div class="daily-confirm-summary"><div><span>Fuel sold</span><strong>'+liters(item.total_sales_liters)+' L</strong></div><div><span>Calculated sales</span><strong>'+money(item.total_sales_amount)+'</strong></div></div>'+
    readiness+
    '<div class="daily-confirm-methods"><div class="daily-confirm-label"><span>Sales awaiting confirmation</span><small>'+(waiting?'Sales will appear after recording is complete.':methodCount+' payment method'+(methodCount===1?'':'s')+' recorded')+'</small></div>'+methodControls+(methods||'<div class="daily-empty">'+(waiting?'Sales will appear here after they are recorded.':'No recorded sale methods.')+'</div>')+'</div>'+
    '<div class="daily-confirm-note">'+(!dayClosed?dayClosedMessage:(waiting?'This report is not ready yet. Complete all shifts, record the required handovers, and finish sales recording before confirmation.':'Review each recorded sales method, then confirm the DSR. Confirmation finalizes the linked shift sales for this report date.'))+'</div>'+
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
document.addEventListener('touchstart',event=>{
  const modal=event.target.closest?.('#admin-dispenser-details-modal');
  if(!modal||!modal.classList.contains('open'))return;
  const touch=event.touches?.[0];
  if(!touch)return;
  modal._dispenserSwipeStartX=touch.clientX;
  modal._dispenserSwipeStartY=touch.clientY;
  modal._dispenserSwipeTracking=true;
},{passive:true});
document.addEventListener('touchend',event=>{
  const modal=event.target.closest?.('#admin-dispenser-details-modal');
  if(!modal||!modal._dispenserSwipeTracking)return;
  modal._dispenserSwipeTracking=false;
  const touch=event.changedTouches?.[0];
  if(!touch)return;
  const dx=touch.clientX-Number(modal._dispenserSwipeStartX||0);
  const dy=touch.clientY-Number(modal._dispenserSwipeStartY||0);
  if(Math.abs(dx)<45||Math.abs(dx)<=Math.abs(dy))return;
  const slides=modal.querySelectorAll('.admin-dispenser-slide');
  if(slides.length<2)return;
  let current=[...slides].findIndex(s=>s.classList.contains('active'));
  if(current<0)current=0;
  const direction=dx<0?1:-1;
  const target=Math.max(0,Math.min(slides.length-1,current+direction));
  if(target===current)return;
  slides.forEach((s,i)=>{
    s.classList.toggle('active',i===target);
    s.classList.remove('swipe-in-next','swipe-in-prev');
  });
  const incoming=slides[target];
  incoming.classList.add(direction>0?'swipe-in-next':'swipe-in-prev');
  setTimeout(()=>incoming.classList.remove('swipe-in-next','swipe-in-prev'),260);
  modal.querySelectorAll('.admin-dispenser-slide-dot').forEach((d,i)=>d.classList.toggle('active',i===target));
},{passive:true});
document.addEventListener('keydown',event=>{
  const card=event.target.closest?.('#dispensers .activated-dispenser-card');
  if(card&&(event.key==='Enter'||event.key===' ')){event.preventDefault();openAdminDispenserDetails(card.getAttribute('data-dispenser-id'));return;}
  if(event.key==='Escape')closeAdminDispenserDetails();
});
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
  const num=v=>Number.isFinite(Number(v))?Number(v):0;
  const fmtNum=v=>Number(v).toLocaleString('en-US',{maximumFractionDigits:2});
  const pct=v=>(v!=null&&Number.isFinite(Number(v)))?Number(v).toFixed(1)+'%':'-';
  const fmtL=v=>fmtNum(num(v))+' L';
  const fmtM=v=>currencyLabel()+' '+num(v).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});
  const signedL=v=>(num(v)>=0?'+':'')+fmtL(v);
  const rd=v=>(v!=null&&Number.isFinite(Number(v)))?fmtNum(v):'-';
  const perf=r.dsr_performance||{},summary=r.summary||{},sales=r.dsr_sales_summary||{};
  const dispensers=Array.isArray(r.dsr_dispenser_details)?r.dsr_dispenser_details:[];
  const tanks=Array.isArray(r.dsr_tank_details)?r.dsr_tank_details:[];
  const shifts=Array.isArray(r.shift_summary)?r.shift_summary:[];
  const methods=Array.isArray(sales.by_type)?sales.by_type:[];
  const products=Array.isArray(sales.by_product)?sales.by_product:[];
  const productInfo=window.currentDsrProductInfo||{};
  const productFor=p=>productInfo[String(p||'').toLowerCase()]||{code:p||'Unknown',name:p||'Unknown'};
  const dt=new Date(String(d||'')+'T00:00:00');
  const dateLabel=Number.isNaN(dt.getTime())?String(d||'Report'):dt.toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'});
  const ready=Boolean(r.report_ready);
  const avgNozzle=perf.average_nozzle_reconciliation_pct;
  const tankDiff=num(perf.tank_difference_liters);
  const meterDiff=num(perf.sales_amount_difference);
  const entered=perf.entered_payment_amount==null?'-':fmtM(perf.entered_payment_amount);
  const topDisp=[...dispensers].sort((a,b)=>num(b.sales_liters)-num(a.sales_liters))[0];
  const topProduct=[...products].sort((a,b)=>num(b.amount)-num(a.amount))[0];

  const dispRows=[];
  dispensers.forEach(disp=>(disp.nozzles||[]).forEach(n=>{
    const pc=productFor(n.product);
    const nozzleLabel=n.nozzle_code&&String(n.nozzle_code).toLowerCase()!==String(disp.dispenser||'').toLowerCase()?n.nozzle_code:'N'+(n.nozzle_number||1);
    dispRows.push([{t:disp.dispenser||'Dispenser',sub:'Nozzle: '+nozzleLabel+' \u00b7 '+(pc.code||pc.name||'Unknown')},
      rd(n.opening_reading),rd(n.closing_reading),fmtL(n.sales_liters),fmtL(n.meter_delta_liters),pct(n.meter_reconciliation_pct)]);
  }));
  if(!dispRows.length)dispRows.push([{t:'No dispenser data',sub:'-'},'-','-','-','-','-']);

  const tankBlocks=tanks.map(t=>{
    const warn=Math.abs(num(t.difference_liters))>=0.005?'warn':undefined;
    return{name:t.tank||'Tank',sub:'Product: '+(productFor(t.product).name||t.product||'-'),
      cells:[fmtL(t.opening_stock_liters),'+'+fmtL(t.purchase_discharged_liters),fmtL(t.nozzle_sales_liters),fmtL(t.expected_closing_liters),fmtL(t.closing_stock_liters)],
      cards:[{label:'Adjustment',value:signedL(t.documented_stock_adjustment_liters)},{label:'Continuity',value:signedL(t.opening_adjustment_liters)},
        {label:'Difference',value:signedL(t.difference_liters),tone:warn},{label:'Variance',value:pct(t.variance_pct),tone:warn}]};
  });

  const stats=[];
  products.forEach(x=>stats.push({label:'By product \u00b7 '+(productFor(x.product).code||x.product||'Product'),value:fmtL(x.liters)+'  \u00b7  '+fmtM(x.amount)+'  \u00b7  '+pct(x.percentage)}));
  if(!products.length)stats.push({label:'By product',value:'No product sales recorded'});
  methods.forEach(x=>stats.push({label:'By method \u00b7 '+(x.type||'Method'),value:fmtM(x.amount)+'  \u00b7  '+pct(x.percentage)}));
  if(!methods.length)stats.push({label:'By method',value:'No payment-method sales recorded'});
  stats.push({label:'Sales total',value:fmtM(sales.total_amount??perf.total_sales_amount),big:true});
  stats.push({label:'Liters total',value:fmtL(sales.total_liters??perf.total_sales_liters),big:true});

  const shiftCards=shifts.map((s,i)=>({
    title:'SHIFT '+(i+1)+' - '+(s.attendant||s.employee_name||'Unknown'),
    sub:(s.dispenser||'-')+' / '+(productFor(s.product).code||s.product||''),
    cols:[{label:'Start',value:dailyReportTime(s.started_at||s.start_time)},{label:'End',value:dailyReportTime(s.ended_at||s.end_time)},
      {label:'Sold',value:fmtL(s.sales_liters||s.total_sales_liters)},{label:'Sales',value:fmtM(s.sales_amount||s.total_sales_amount),tone:'good',w:93}]
  }));

  const blob=createDsrReportPdf({
    title:'DSR - '+dateLabel,statusLabel:ready?'Confirmed':'Pending',
    footer:'DSR - '+dateLabel+'  \u00b7  Station daily reconciliation',
    key:[{label:'Fuel sold',value:fmtL(perf.total_sales_liters??summary.sales_liters)},
      {label:'Total sales',value:fmtM(perf.total_sales_amount??summary.sales_amount),tone:'good'},
      {label:'Shifts',value:String(num(perf.shift_count)),size:16},{label:'Dispensers',value:String(num(perf.dispenser_count)),size:16},{label:'Tanks',value:String(num(perf.tank_count)),size:16}],
    dispRows:dispRows,tanks:tankBlocks,stats:stats,
    overview:[
      {label:'Avg. liters / shift',value:fmtL(perf.average_liters_per_shift)},{label:'Avg. sales / shift',value:fmtM(perf.average_sales_per_shift)},
      {label:'Calculated sales',value:fmtM(perf.calculated_sales_amount)},{label:'Entered payments',value:entered},
      {label:'Financial difference',value:fmtM(perf.financial_difference==null?meterDiff:perf.financial_difference)},
      {label:'Avg. nozzle reconciliation',value:pct(avgNozzle)}],
    perf:[
      {label:'Total tank difference',value:signedL(tankDiff)},
      {label:'Top dispenser',value:topDisp?(topDisp.dispenser||'-')+' \u00b7 '+fmtL(topDisp.sales_liters):'-'},
      {label:'Top product',value:topProduct?(topProduct.product||'-')+' \u00b7 '+fmtL(topProduct.liters):'-'},
      {label:'Average nozzle reconciliation',value:pct(avgNozzle)},{label:'Nozzle count',value:String(num(perf.nozzle_count))},{label:'Attendants',value:String(num(perf.attendant_count))}],
    shifts:shiftCards,
    finalLeft:[
      {label:'Report status',value:ready?'CONFIRMED':'PENDING'},{label:'Fuel sold',value:fmtL(perf.total_sales_liters)},
      {label:'Calculated sales',value:fmtM(perf.calculated_sales_amount??perf.total_sales_amount)},{label:'Entered payments',value:entered},
      {label:'Financial difference',value:perf.financial_difference==null?'-':fmtM(perf.financial_difference)}],
    finalRight:[
      {label:'Average nozzle reconciliation',value:pct(avgNozzle)},{label:'Tank difference',value:signedL(tankDiff)},
      {label:'Shifts / attendants',value:num(perf.shift_count)+' / '+num(perf.attendant_count)},{label:'Dispensers / nozzles',value:num(perf.dispenser_count)+' / '+num(perf.nozzle_count)}]
  });
  const url=URL.createObjectURL(blob),link=document.createElement('a');
  link.href=url;link.download='DSR-'+String(d||'report').replace(/[^A-Za-z0-9_-]/g,'_')+'-report.pdf';
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
      '<div class="daily-stat"><span>Calculated sales</span><b>'+money(perf.calculated_sales_amount ?? perf.total_sales_amount ?? s.sales_amount)+'</b><small>Meter-calculated</small></div>'+
      '<div class="daily-stat"><span>Entered payments</span><b>'+((perf.entered_payment_amount!=null)?money(perf.entered_payment_amount):'—')+'</b><small>Confirmed payments</small></div>'+
      '<div class="daily-stat"><span>Financial difference</span><b>'+((perf.financial_difference!=null)?money(perf.financial_difference):'—')+'</b><small>Payments − calculated</small></div>'+
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
      '<div class="dsr-sales-total"><div class="dsr-sales-total-row"><span>Calculated sales</span><strong>'+money(salesSummary.total_amount)+'</strong></div><div class="dsr-sales-total-row"><span>Entered payments</span><strong>'+money(perf.entered_payment_amount ?? perf.total_sales_amount ?? 0)+'</strong></div><div class="dsr-sales-total-row"><span>Financial difference</span><strong>'+money(perf.financial_difference ?? 0)+'</strong></div><div class="dsr-sales-total-row"><span>Liters sold</span><strong>'+liters(salesSummary.total_liters)+' L</strong></div></div>';

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
      ['Calculated sales',money(perf.calculated_sales_amount||0)],
      ['Entered payments',money(perf.entered_payment_amount ?? perf.total_sales_amount ?? 0)],
      ['Financial difference',money(perf.financial_difference ?? perf.sales_amount_difference ?? 0)],
      ['Financial status',String(perf.financial_reconciliation_status||((Math.abs(Number(perf.financial_difference ?? perf.sales_amount_difference ?? 0))<=1)?'matched':'variance')).replace(/^./,m=>m.toUpperCase())],
      ['Meter-calculated sales',money(perf.calculated_sales_amount||0)],
      ['Entered − calculated',money(perf.financial_difference ?? perf.sales_amount_difference ?? 0)],
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
      return '<article class="daily-revision-card"><div class="daily-revision-head"><div><span class="daily-card-kicker">ARCHIVED VERSION</span><h3>Revision '+h(r.revision_no)+'</h3><small>'+h(r.archived_at?new Date(r.archived_at).toLocaleString():'—')+'</small></div><span class="daily-dsr-status-preview">Archived</span></div><div class="daily-revision-grid"><div><span>Fuel sold</span><strong>'+liters(snap.total_sales_liters||0)+' L</strong></div><div><span>Calculated sales</span><strong>'+money(snap.total_sales_amount||0)+'</strong></div><div><span>Purchase contribution</span><strong>'+liters(snap.total_purchases_liters||0)+' L</strong></div><div><span>Reason</span><strong>'+h(r.revision_reason||'DSR regenerated')+'</strong></div></div></article>';
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
  // Assign Shift must use the tank dip entered during dispenser activation.
  // _confirmDispenserActivation converts dip (mm) to liters from the tank calibration;
  // do not read the hidden liters field here or ask the user to enter liters manually.
  return _confirmDispenserActivation();
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


function adminProductSalesTimestamp(s){
  return s.sale_time||s.created_at||s.timestamp||s.date||s.sold_at||'';
}
function adminProductMonthKey(d){
  return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0');
}
function adminProductMonthLabel(key){
  const p=key.split('-');
  return new Date(Number(p[0]),Number(p[1])-1,1).toLocaleDateString(undefined,{month:'short'});
}
function adminProductBuildLineChart(rows){
  const w=560,hg=190,pad=28;
  const vals=rows.map(r=>Number(r.value)||0);
  const max=Math.max(...vals,1);
  const points=rows.map((r,i)=>{
    const x=pad+(rows.length===1?0:i*(w-pad*2)/(rows.length-1));
    const y=hg-pad-(Number(r.value)||0)/max*(hg-pad*2);
    return {x,y};
  });
  const path=points.map((p,i)=>(i?'L':'M')+p.x.toFixed(1)+' '+p.y.toFixed(1)).join(' ');
  const dots=points.map(p=>'<circle cx="'+p.x.toFixed(1)+'" cy="'+p.y.toFixed(1)+'" r="3" class="admin-product-chart-dot"></circle>').join('');
  const labels=rows.map((r,i)=>'<text x="'+points[i].x.toFixed(1)+'" y="'+(hg-7)+'" text-anchor="middle" class="admin-product-chart-label">'+h(r.label)+'</text>').join('');
  return '<svg class="admin-product-chart" viewBox="0 0 '+w+' '+hg+'" role="img" aria-label="Product sales performance chart"><line x1="'+pad+'" y1="'+(hg-pad)+'" x2="'+(w-pad)+'" y2="'+(hg-pad)+'" class="admin-product-chart-axis"></line><path d="'+path+'" class="admin-product-chart-line"></path>'+dots+labels+'</svg>';
}
function adminProductBuildBars(rows){
  const w=560,hg=190,pad=28;
  const max=Math.max(...rows.map(r=>Number(r.value)||0),1);
  const gap=7, inner=w-pad*2, bw=Math.max(5,(inner-gap*(rows.length-1))/rows.length);
  const bars=rows.map((r,i)=>{
    const value=Number(r.value)||0;
    const bh=Math.max(value?2:0,(hg-pad*2)*value/max);
    const x=pad+i*(bw+gap), y=hg-pad-bh;
    return '<rect x="'+x.toFixed(1)+'" y="'+y.toFixed(1)+'" width="'+bw.toFixed(1)+'" height="'+bh.toFixed(1)+'" rx="3" class="admin-product-chart-bar"></rect><text x="'+(x+bw/2).toFixed(1)+'" y="'+(hg-7)+'" text-anchor="middle" class="admin-product-chart-label">'+h(r.label)+'</text>';
  }).join('');
  return '<svg class="admin-product-chart" viewBox="0 0 '+w+' '+hg+'" role="img" aria-label="Product sales volume chart"><line x1="'+pad+'" y1="'+(hg-pad)+'" x2="'+(w-pad)+'" y2="'+(hg-pad)+'" class="admin-product-chart-axis"></line>'+bars+'</svg>';
}
/* Admin Fuel Configuration — product details popup.
   Uses delegated events so product cards never need inline JavaScript. */
function ensureAdminDispenserDetailsModal(){
  let modal=document.getElementById('admin-dispenser-details-modal'); if(modal)return modal;
  modal=document.createElement('div'); modal.id='admin-dispenser-details-modal'; modal.className='admin-dispenser-details-modal'; modal.setAttribute('aria-hidden','true');
  modal.innerHTML='<div class="admin-dispenser-details-backdrop" data-dispenser-popup-close></div><div class="admin-dispenser-details-card" role="dialog" aria-modal="true"><div class="admin-dispenser-details-top"><div><span class="section-kicker">DISPENSER</span><h3>Dispenser Details</h3></div><button type="button" class="admin-dispenser-details-close" data-dispenser-popup-close>×</button></div><div id="admin-dispenser-details-content" class="admin-dispenser-details-content"></div></div>';
  document.body.appendChild(modal); return modal;
}
function closeAdminDispenserDetails(){const m=document.getElementById('admin-dispenser-details-modal');if(m){m.classList.remove('open');m.setAttribute('aria-hidden','true');}}
function adminDispenserMetric(l,v,n){return '<div class="admin-dispenser-metric"><span>'+h(l)+'</span><strong>'+h(v)+'</strong>'+(n?'<small>'+h(n)+'</small>':'')+'</div>';}
async function openAdminDispenserDetails(id){
  const modal=ensureAdminDispenserDetailsModal(),content=modal.querySelector('#admin-dispenser-details-content');
  modal.classList.add('open');modal.setAttribute('aria-hidden','false');content.innerHTML='<div class="admin-dispenser-details-loading">Loading dispenser details…</div>';
  try{
    const [dispensers,tanks,products,shifts,employees,sales]=await Promise.all([api('/api/nozzles'),api('/api/tanks'),api('/api/products'),api('/api/shifts'),api('/api/users'),api('/api/sales')]);
    const d=dispensers.find(x=>String(x.id)===String(id)); if(!d)throw new Error('Dispenser details could not be found.');
    const tank=tanks.find(x=>String(x.id)===String(d.tank_id));
    const product=products.find(p=>String(p.name||'').toLowerCase()===String(d.product||tank?.product||'').toLowerCase()||String(p.code_name||'').toLowerCase()===String(d.product||'').toLowerCase());
    const shift=shifts.filter(x=>x.status==='active').find(x=>String(x.nozzle_id)===String(d.id));
    const attendant=shift?employees.find(x=>String(x.id)===String(shift.employee_id)):null;
    const color=String(product?.color||'#1264d8').trim()||'#1264d8'; modal.querySelector('.admin-dispenser-details-card').style.setProperty('--product-color',color);
    const count=Number(d.nozzle_count||1), reads=Array.isArray(shift?.activation_nozzles)?shift.activation_nozzles:[], nums=reads.map(x=>Number(x?.opening_reading)).filter(Number.isFinite), opening=nums.length?nums.reduce((a,b)=>a+b,0):null;
    const salesFor=(sales||[]).filter(x=>String(x.nozzle_id||'')===String(d.id)), today=new Date().toISOString().slice(0,10), todaySales=salesFor.filter(x=>String(x.sale_time||x.created_at||'').slice(0,10)===today);
    const allL=salesFor.reduce((a,x)=>a+Number(x.quantity_liters||0),0), dayL=todaySales.reduce((a,x)=>a+Number(x.quantity_liters||0),0);
    const hero='<div class="admin-dispenser-details-hero"><div><span class="field-label">DISPENSER</span><h2>'+h(d.nozzle_code||'Dispenser')+'</h2><p>'+h(product?.code_name||d.product||tank?.product||'—')+' • '+h(tank?.tank_code||'No tank')+'</p></div><span class="admin-dispenser-details-status">ACTIVE</span></div>';
    const overview='<section class="admin-dispenser-details-section"><div class="admin-dispenser-details-section-head"><span>OVERVIEW</span><small>Current dispenser status</small></div><div class="admin-dispenser-metrics">'+adminDispenserMetric('Product',product?.code_name||d.product||tank?.product||'—','product code')+adminDispenserMetric('Connected tank',tank?.tank_code||'—','assigned tank')+adminDispenserMetric('Nozzles',String(count),'configured')+adminDispenserMetric('Shift attendant',attendant?.name||'No active shift',shift?'current shift':'')+'</div></section>';
    const shiftBox='<section class="admin-dispenser-details-section"><div class="admin-dispenser-details-section-head"><span>SHIFT</span><small>'+(shift?'Active now':'No active shift')+'</small></div><div class="admin-dispenser-metrics">'+adminDispenserMetric('Opening reading',opening===null?'—':reading(opening),'combined nozzle reading')+adminDispenserMetric('Shift ID',shift?.id||'—','current assignment')+adminDispenserMetric('Tank stock',tank?.current_liters==null?'—':liters(tank.current_liters)+' L','current tank stock')+adminDispenserMetric('Tank capacity',tank?.capacity_liters==null?'—':liters(tank.capacity_liters)+' L','tank capacity')+'</div></section>';
    const perf='<section class="admin-dispenser-details-section"><div class="admin-dispenser-details-section-head"><span>PERFORMANCE</span><small>Sales recorded on this dispenser</small></div><div class="admin-dispenser-metrics">'+adminDispenserMetric('Today volume',liters(dayL)+' L','today')+adminDispenserMetric('All-time volume',liters(allL)+' L','available records')+adminDispenserMetric('Today sales',String(todaySales.length),'confirmed records')+adminDispenserMetric('All-time sales',String(salesFor.length),'confirmed records')+'</div></section>';
    const config='<section class="admin-dispenser-details-section"><div class="admin-dispenser-details-section-head"><span>CONFIGURATION</span><small>Dispenser setup</small></div><div class="admin-dispenser-metrics">'+adminDispenserMetric('Dispenser ID',d.id||'—','system identifier')+adminDispenserMetric('Status',d.active?'Active':'Inactive','configuration')+adminDispenserMetric('Nozzle count',String(count),'configured nozzles')+adminDispenserMetric('Tank',tank?.tank_code||'—','connection')+'</div></section>';
    content.innerHTML='<div class="admin-dispenser-slides"><article class="admin-dispenser-slide active">'+hero+overview+shiftBox+'</article><article class="admin-dispenser-slide">'+perf+config+'</article></div><div class="admin-dispenser-slide-controls"><button type="button" class="admin-dispenser-slide-arrow" data-dispenser-slide-prev>‹</button><div class="admin-dispenser-slide-dots"><button type="button" class="admin-dispenser-slide-dot active" data-dispenser-slide-to="0"></button><button type="button" class="admin-dispenser-slide-dot" data-dispenser-slide-to="1"></button></div><button type="button" class="admin-dispenser-slide-arrow" data-dispenser-slide-next>›</button></div>';
  }catch(e){content.innerHTML='<div class="admin-dispenser-details-error">'+h(e.message||'Unable to load dispenser details.')+'</div>';}
}
function ensureAdminProductDetailsModal(){
  let modal=document.getElementById('admin-product-details-modal');
  if(modal)return modal;
  modal=document.createElement('div');
  modal.id='admin-product-details-modal';
  modal.className='admin-product-details-modal';
  modal.setAttribute('aria-hidden','true');
  modal.innerHTML='<div class="admin-product-details-backdrop" data-product-popup-close></div>'+
    '<div class="admin-product-details-card" role="dialog" aria-modal="true" aria-labelledby="admin-product-details-title">'+
      '<div class="admin-product-details-top"><h3 id="admin-product-details-title" class="admin-product-details-title">Product Details</h3><button type="button" class="admin-product-details-close" data-product-popup-close aria-label="Close">×</button></div>'+
      '<div id="admin-product-details-content" class="admin-product-details-content"></div>'+
    '</div>';
  document.body.appendChild(modal);
  return modal;
}
function closeAdminProductDetails(){
  const modal=document.getElementById('admin-product-details-modal');
  if(!modal)return;
  modal.classList.remove('open');
  modal.setAttribute('aria-hidden','true');
}
function adminProductDetailMetric(label,value,note){
  return '<div class="admin-product-metric"><span>'+h(label)+'</span><strong>'+h(value)+'</strong>'+(note?'<small>'+h(note)+'</small>':'')+'</div>';
}
async function openAdminProductDetails(productId){
  const modal=ensureAdminProductDetailsModal();
  const content=modal.querySelector('#admin-product-details-content');
  const title=modal.querySelector('#admin-product-details-title');
  modal.classList.add('open');
  modal.setAttribute('aria-hidden','false');
  if(content)content.innerHTML='<div class="admin-product-details-loading">Loading product details…</div>';
  try{
    const [products,tanks,dispensers,sales]=await Promise.all([
      api('/api/products'),
      api('/api/tanks'),
      api('/api/nozzles'),
      api('/api/sales')
    ]);
    const product=(products||[]).find(p=>String(p.id)===String(productId));
    if(!product)throw new Error('Product details could not be found.');
    const name=String(product.name||'');
    const code=String(product.code_name||name||'—');
    const color=String(product.color||'#1264d8').trim()||'#1264d8';
    const popupCard=modal.querySelector('.admin-product-details-card');
    if(popupCard)popupCard.style.setProperty('--product-color',color);
    const productTanks=(tanks||[]).filter(t=>String(t.product||'').toLowerCase()===name.toLowerCase()&&t.active===true);
    const tankIds=new Set(productTanks.map(t=>String(t.id)));
    const productDispensers=(dispensers||[]).filter(d=>d.active===true&&tankIds.has(String(d.tank_id)));
    const todayDate=new Date().toISOString().slice(0,10);
    const productSales=(sales||[]).filter(s=>String(s.product||'').toLowerCase()===name.toLowerCase());
    const todaySales=productSales.filter(s=>String(s.sale_time||'').slice(0,10)===todayDate);
    const totalLiters=productSales.reduce((sum,s)=>sum+Number(s.quantity_liters||0),0);
    const totalRevenue=productSales.reduce((sum,s)=>sum+Number(s.amount||0),0);
    const todayLiters=todaySales.reduce((sum,s)=>sum+Number(s.quantity_liters||0),0);
    const todayRevenue=todaySales.reduce((sum,s)=>sum+Number(s.amount||0),0);
    const stock=productTanks.reduce((sum,t)=>sum+Number(t.current_liters||0),0);
    const capacity=productTanks.reduce((sum,t)=>sum+Number(t.capacity_liters||0),0);
    const stockPct=capacity>0?Math.max(0,Math.min(100,stock/capacity*100)):0;
    const tankRows=productTanks.length?productTanks.map(t=>'<div class="admin-product-tank-row"><div><strong>'+h(t.tank_code)+'</strong><small>'+h(liters(t.capacity_liters)+' L capacity')+'</small></div><b>'+h(liters(t.current_liters)+' L')+'</b></div>').join(''):'<div class="admin-product-details-loading">No active tanks assigned to this product.</div>';
    if(title)title.textContent=code+' Details';
    const hero='<div class="admin-product-details-hero" style="--product-color:'+h(color)+'"><div><span class="field-label">PRODUCT</span><h2>'+h(code)+'</h2><p>'+h(name)+'</p></div><span class="admin-product-details-status">ACTIVE</span></div>';
    const overview='<section class="admin-product-details-section"><div class="admin-product-details-section-head"><span>OVERVIEW</span><small>Current product status</small></div><div class="admin-product-metrics">'+
      adminProductDetailMetric('Selling price',money(product.selling_price),'per litre')+
      adminProductDetailMetric('Current stock',liters(stock)+' L',stockPct.toFixed(1)+'% of active tank capacity')+
      adminProductDetailMetric('Active tanks',String(productTanks.length),'assigned tanks')+
      adminProductDetailMetric('Active dispensers',String(productDispensers.length),'connected dispensers')+
      '</div></section>';
    const todaySection='<section class="admin-product-details-section"><div class="admin-product-details-section-head"><span>TODAY</span><small>'+h(new Date().toLocaleDateString())+'</small></div><div class="admin-product-metrics">'+
      adminProductDetailMetric('Volume sold',liters(todayLiters)+' L','today')+
      adminProductDetailMetric('Sales revenue',money(todayRevenue),'today')+
      adminProductDetailMetric('Sales count',String(todaySales.length),'confirmed records')+
      adminProductDetailMetric('All-time volume',liters(totalLiters)+' L','available records')+
      '</div></section>';

    const now=new Date();
    const monthlyRows=[];
    for(let i=11;i>=0;i--){
      const d=new Date(now.getFullYear(),now.getMonth()-i,1);
      const key=adminProductMonthKey(d);
      const rows=productSales.filter(s=>adminProductMonthKey(new Date(adminProductSalesTimestamp(s)))===key);
      monthlyRows.push({label:adminProductMonthLabel(key),value:rows.reduce((sum,s)=>sum+Number(s.quantity_liters||0),0)});
    }
    const dailyRows=[];
    for(let i=6;i>=0;i--){
      const d=new Date(now.getFullYear(),now.getMonth(),now.getDate()-i);
      const key=d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
      const rows=productSales.filter(s=>String(adminProductSalesTimestamp(s)).slice(0,10)===key);
      dailyRows.push({label:d.toLocaleDateString(undefined,{weekday:'short'}),value:rows.reduce((sum,s)=>sum+Number(s.quantity_liters||0),0)});
    }
    const monthlyTotal=monthlyRows.reduce((sum,r)=>sum+r.value,0);
    const monthlyAverage=monthlyRows.reduce((sum,r)=>sum+r.value,0)/12;
    const bestMonth=monthlyRows.reduce((best,r)=>r.value>best.value?r:best,{label:'—',value:0});
    const performance='<section class="admin-product-details-section"><div class="admin-product-details-section-head"><span>PERFORMANCE</span><small>Sales volume trend</small></div><div class="admin-product-performance-summary">'+
      adminProductDetailMetric('12-month volume',liters(monthlyTotal)+' L','recorded sales')+
      adminProductDetailMetric('Monthly average',liters(monthlyAverage)+' L','12-month average')+
      adminProductDetailMetric('Best month',h(bestMonth.label),liters(bestMonth.value)+' L')+
      '</div><div class="admin-product-chart-wrap"><div class="admin-product-chart-title">Monthly volume</div>'+adminProductBuildLineChart(monthlyRows)+'</div></section>';
    const tanksSection='<section class="admin-product-details-section"><div class="admin-product-details-section-head"><span>ACTIVE TANKS</span><small>'+h(liters(stock)+' L total stock')+'</small></div><div class="admin-product-tank-list">'+tankRows+'</div></section>';
    const slideOne='<article class="admin-product-slide active" data-product-slide="0" style="--product-color:'+h(color)+'">'+hero+overview+performance+'</article>';
    const slideTwo='<article class="admin-product-slide" data-product-slide="1" style="--product-color:'+h(color)+'">'+todaySection+'<section class="admin-product-details-section"><div class="admin-product-details-section-head"><span>RECENT PERFORMANCE</span><small>Last 7 days</small></div><div class="admin-product-chart-wrap">'+adminProductBuildBars(dailyRows)+'</div></section>'+tanksSection+'</article>';
    if(content)content.innerHTML='<div class="admin-product-slides">'+slideOne+slideTwo+'</div><div class="admin-product-slide-controls"><button type="button" class="admin-product-slide-arrow" data-product-slide-prev aria-label="Previous">‹</button><div class="admin-product-slide-dots"><button type="button" class="admin-product-slide-dot active" data-product-slide-to="0" aria-label="Slide 1"></button><button type="button" class="admin-product-slide-dot" data-product-slide-to="1" aria-label="Slide 2"></button></div><button type="button" class="admin-product-slide-arrow" data-product-slide-next aria-label="Next">›</button></div>';
  }catch(e){
    if(content)content.innerHTML='<div class="admin-product-details-error">'+h(e.message||'Unable to load product details.')+'</div>';
  }
}
document.addEventListener('click',event=>{
  const card=event.target.closest?.('#dispensers .activated-dispenser-card');
  if(card){event.preventDefault();openAdminDispenserDetails(card.getAttribute('data-dispenser-id'));return;}
  if(event.target.closest?.('[data-dispenser-popup-close]')){closeAdminDispenserDetails();return;}
  const modal=event.target.closest?.('#admin-dispenser-details-modal'); if(!modal)return;
  const slides=modal.querySelectorAll('.admin-dispenser-slide'); if(slides.length<2)return;
  let current=[...slides].findIndex(x=>x.classList.contains('active')); if(current<0)current=0; let target=null;
  if(event.target.closest('[data-dispenser-slide-next]'))target=Math.min(1,current+1);
  if(event.target.closest('[data-dispenser-slide-prev]'))target=Math.max(0,current-1);
  const dot=event.target.closest('[data-dispenser-slide-to]'); if(dot)target=Number(dot.getAttribute('data-dispenser-slide-to'))||0;
  if(target===null||target===current)return;
  slides.forEach((x,i)=>x.classList.toggle('active',i===target)); modal.querySelectorAll('.admin-dispenser-slide-dot').forEach((x,i)=>x.classList.toggle('active',i===target));
});
document.addEventListener('click',event=>{
  const card=event.target.closest?.('#products .activated-product-card');
  if(card){
    event.preventDefault();
    openAdminProductDetails(card.getAttribute('data-product-id'));
    return;
  }
  if(event.target.closest?.('[data-product-popup-close]')){
    closeAdminProductDetails();
    return;
  }
  const modal=event.target.closest?.('#admin-product-details-modal');
  if(!modal)return;
  const content=modal.querySelector('#admin-product-details-content');
  const slides=modal.querySelectorAll('.admin-product-slide');
  if(!content||slides.length<2)return;
  let current=[...slides].findIndex(s=>s.classList.contains('active'));
  if(current<0)current=0;
  let target=null;
  if(event.target.closest('[data-product-slide-next]'))target=Math.min(slides.length-1,current+1);
  if(event.target.closest('[data-product-slide-prev]'))target=Math.max(0,current-1);
  const dot=event.target.closest('[data-product-slide-to]');
  if(dot)target=Math.max(0,Math.min(slides.length-1,Number(dot.getAttribute('data-product-slide-to'))||0));
  if(target===null||target===current)return;
  slides.forEach((s,i)=>s.classList.toggle('active',i===target));
  modal.querySelectorAll('.admin-product-slide-dot').forEach((d,i)=>d.classList.toggle('active',i===target));
  content.setAttribute('data-product-slide-current',String(target));
});
document.addEventListener('touchstart',event=>{
  const modal=event.target.closest?.('#admin-product-details-modal');
  if(!modal||!modal.classList.contains('open'))return;
  const touch=event.touches?.[0];
  if(!touch)return;
  modal._productSwipeStartX=touch.clientX;
  modal._productSwipeStartY=touch.clientY;
  modal._productSwipeTracking=true;
},{passive:true});
document.addEventListener('touchend',event=>{
  const modal=event.target.closest?.('#admin-product-details-modal');
  if(!modal||!modal._productSwipeTracking)return;
  modal._productSwipeTracking=false;
  const touch=event.changedTouches?.[0];
  if(!touch)return;
  const dx=touch.clientX-Number(modal._productSwipeStartX||0);
  const dy=touch.clientY-Number(modal._productSwipeStartY||0);
  if(Math.abs(dx)<45||Math.abs(dx)<=Math.abs(dy))return;
  const slides=modal.querySelectorAll('.admin-product-slide');
  if(slides.length<2)return;
  let current=[...slides].findIndex(s=>s.classList.contains('active'));
  if(current<0)current=0;
  const direction=dx<0?1:-1;
  const target=Math.max(0,Math.min(slides.length-1,current+direction));
  if(target===current)return;
  slides.forEach((s,i)=>{
    s.classList.toggle('active',i===target);
    s.classList.remove('swipe-in-next','swipe-in-prev');
  });
  const incoming=slides[target];
  incoming.classList.add(direction>0?'swipe-in-next':'swipe-in-prev');
  setTimeout(()=>incoming.classList.remove('swipe-in-next','swipe-in-prev'),260);
  modal.querySelectorAll('.admin-product-slide-dot').forEach((d,i)=>d.classList.toggle('active',i===target));
  const content=modal.querySelector('#admin-product-details-content');
  if(content)content.setAttribute('data-product-slide-current',String(target));
},{passive:true});
document.addEventListener('keydown',event=>{
  const card=event.target.closest?.('#products .activated-product-card');
  if(card&&(event.key==='Enter'||event.key===' ')){
    event.preventDefault();
    openAdminProductDetails(card.getAttribute('data-product-id'));
    return;
  }
  if(event.key==='Escape')closeAdminProductDetails();
});

// Explicit page entry exports for the boot loader.
window.adminDashboard=adminDashboard;
window.adminSalesConfirmations=adminSalesConfirmations;
window.adminSalesHistory=adminSalesHistory;
window.adminSettings=adminSettings;
window.userDashboard=userDashboard;

// Prefetch dashboard sub-pages so navigation feels immediate.
(function prefetchDashboardSubPages(){
  if(document.body?.classList?.contains('admin-shell')===false)return;
  const links=[...document.querySelectorAll('.dashboard-section-nav a[href]')];
  const urls=[...new Set(links.map(a=>a.getAttribute('href')).filter(Boolean))];
  const add=(url)=>{
    if(!url||document.head.querySelector('link[rel=\"prefetch\"][href=\"'+url+'\"]'))return;
    const link=document.createElement('link');
    link.rel='prefetch';
    link.as='document';
    link.href=url;
    link.fetchPriority='low';
    document.head.appendChild(link);
  };
  // Start with the currently visible dashboard group; do not block page rendering.
  if('requestIdleCallback' in window){
    requestIdleCallback(()=>urls.forEach(add),{timeout:1200});
  }else{
    setTimeout(()=>urls.forEach(add),250);
  }
})();

document.addEventListener('click',event=>{
  const link=event.target.closest?.('.tank-movement-invoice-link');
  if(!link)return;
  event.preventDefault();
  const id=String(link.dataset.purchaseId||'');
  const invoice=String(link.dataset.purchaseInvoice||'');
  if(id){
    location.href='admin-purchases.html#purchase-'+encodeURIComponent(id);
  }else{
    location.href='admin-purchases.html#purchase-invoice-'+encodeURIComponent(invoice);
  }
});

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
    'admin-monthly-report.html':'monthly-report',
    'admin-settings.html':'settings',
    /* All Admin Dashboard sub-pages keep Dashboard selected in the main sidebar. */
    'admin-fuel-configuration.html':'dashboard',
    'admin-inventory.html':'dashboard',
    'admin-attendants.html':'dashboard',
    'admin-accounting-control.html':'dashboard'
  };
  const active=map[page]||'';
  links.forEach(link=>{
    const on=link.dataset.adminNav===active;
    link.classList.toggle('active',on);
    if(on)link.setAttribute('aria-current','page');else link.removeAttribute('aria-current');
  });
});

// Admin Sales History: delegated View details click handler for dynamically rebuilt cards.
document.addEventListener('click',event=>{
  const button=event.target.closest?.('#full-sales-history-list .compact-detail-button');
  if(!button)return;
  event.preventDefault();
  event.stopPropagation();
  const card=button.closest('.admin-history-sale-card');
  const id=card?.getAttribute('data-takeover-id');
  if(!id){toast('This sales record could not be opened.');return;}
  const opener=window.openAdminSaleHistoryDetails;
  if(typeof opener==='function')opener(id);else toast('Sales details are still loading. Please try again.');
},{capture:true});



