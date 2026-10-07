(function(){
  function closingMoney(v){return Number(v||0).toLocaleString(undefined,{maximumFractionDigits:2});}
  async function loadVerifiedClosings(){
    const box=document.getElementById('accounting-period-summary');
    const status=document.getElementById('accounting-period-status');
    const button=document.getElementById('open-accounting-period-button');
    const closeButton=document.getElementById('accounting-period-close-button');
    if(!box||!status||!button)return;
    try{
      const data=await api('/api/accounting/current-period');
      if(!data?.open||!data.period){
        if(closeButton)closeButton.style.display='none';
        button.textContent='Open period';
        button.onclick=openAccountingPeriodModal;
        return;
      }
      if(closeButton)closeButton.style.display='inline-flex';
      button.textContent='Record physical closing';
      button.onclick=openPhysicalClosingModal;
      const closeData=await api('/api/accounting/closing?period_id='+encodeURIComponent(data.period.id));
      const closings=Array.isArray(closeData?.closings)?closeData.closings:[];
      const tanks=await api('/api/tanks').catch(()=>[]);
      const tankMap=Object.fromEntries((Array.isArray(tanks)?tanks:[]).map(t=>[String(t.id),t]));
      const byTank=Object.fromEntries(closings.map(c=>[String(c.tank_id),c]));
      status.textContent='Open · '+(closings.length)+' of '+(Array.isArray(tanks)?tanks.filter(t=>t.active).length:0)+' tanks have verified physical closing';
      box.innerHTML='<div class="accounting-period-summary-grid">'+
        (Array.isArray(tanks)?tanks.filter(t=>t.active).map(t=>{
          const c=byTank[String(t.id)];
          if(!c)return '<div class="accounting-period-mini"><strong>'+h(t.tank_code||'Tank')+'</strong><span>Physical closing: Not recorded</span></div>';
          const cls=String(c.variance_status||'').toLowerCase();
          const diff=Number(c.difference_liters||0);
          return '<div class="accounting-period-mini '+cls+'"><strong>'+h(t.tank_code||'Tank')+'</strong><span>Physical '+closingMoney(c.physical_liters)+' L</span><span>Expected '+closingMoney(c.expected_closing_liters)+' L</span><span>Difference '+(diff>=0?'+':'')+closingMoney(diff)+' L</span><span>'+h(c.variance_status||'')+(c.variance_percent!=null?' · '+Number(c.variance_percent).toFixed(2)+'%':'')+'</span></div>';
        }).join(''):'')+'</div>';
    }catch(e){
      status.textContent='Unable to load physical closing status';
    }
  }
  window.loadVerifiedClosings=loadVerifiedClosings;
  window.closePhysicalClosingModal=function(){
    const m=document.getElementById('physical-closing-modal');
    if(m){m.classList.remove('open');m.setAttribute('aria-hidden','true');}
  };
  window.openPhysicalClosingModal=async function(){
    const data=await api('/api/accounting/current-period');
    if(!data?.open||!data.period){toast('Open a controlled accounting period first.');return;}
    const tanks=await api('/api/tanks');
    let m=document.getElementById('physical-closing-modal');
    if(!m){
      m=document.createElement('div');m.id='physical-closing-modal';m.className='modal';m.setAttribute('aria-hidden','true');
      m.innerHTML='<div class="modal-backdrop" onclick="closePhysicalClosingModal()"></div><form class="modal-card form" style="max-width:620px;max-height:88vh;overflow:auto" onsubmit="submitPhysicalClosing(event)"><div class="top"><div><span class="section-kicker">CONTROLLED ACCOUNTING</span><h3>Record physical closing</h3><p class="muted">Verified physical measurement is recorded for reconciliation only. It will not overwrite tank ledger stock or create an automatic adjustment.</p></div><button type="button" class="modal-close" onclick="closePhysicalClosingModal()">×</button></div><div id="physical-closing-fields"></div><div class="row"><button type="button" onclick="closePhysicalClosingModal()">Cancel</button><button type="submit" class="primary">Save verified closing</button></div></form></div>';
      document.body.appendChild(m);
    }
    const closings=(await api('/api/accounting/closing?period_id='+encodeURIComponent(data.period.id))).closings||[];
    const done=new Set(closings.map(x=>String(x.tank_id)));
    const active=tanks.filter(t=>t.active&&!done.has(String(t.id)));
    const fields=document.getElementById('physical-closing-fields');
    fields.innerHTML=active.length?active.map(t=>'<div class="card" style="margin:0 0 10px;padding:14px"><strong>'+h(t.tank_code||'Tank')+'</strong><label>Physical liters<input class="physical-closing-liters" data-tank-id="'+h(t.id)+'" type="number" min="0" max="'+h(t.capacity_liters||'')+'" step="0.01" required placeholder="Enter measured liters"></label><label>Height / dip (optional)<input class="physical-closing-height" data-tank-id="'+h(t.id)+'" type="number" min="0" step="0.01" placeholder="Optional mm"></label><label>Calibration version<input class="physical-closing-calibration" data-tank-id="'+h(t.id)+'" required placeholder="e.g. CAL-2026-01"></label><label>Notes (optional)<textarea class="physical-closing-notes" data-tank-id="'+h(t.id)+'" rows="2" placeholder="Measurement notes"></textarea></div>').join(''):'<p class="muted">All active tanks already have a verified closing for this period.</p>';
    m.classList.add('open');m.setAttribute('aria-hidden','false');
  };
  window.submitPhysicalClosing=async function(event){
    event?.preventDefault();
    const period=(await api('/api/accounting/current-period')).period;
    if(!period)return;
    const rows=[...document.querySelectorAll('#physical-closing-fields .physical-closing-liters')];
    const button=document.querySelector('#physical-closing-modal button[type="submit"]');
    if(button){button.disabled=true;button.textContent='Saving…';}
    try{
      for(const input of rows){
        const id=input.dataset.tankId;
        const height=document.querySelector('.physical-closing-height[data-tank-id="'+CSS.escape(id)+'"]')?.value;
        const calibration=document.querySelector('.physical-closing-calibration[data-tank-id="'+CSS.escape(id)+'"]')?.value.trim();
        const notes=document.querySelector('.physical-closing-notes[data-tank-id="'+CSS.escape(id)+'"]')?.value.trim();
        await api('/api/accounting/closing',{method:'POST',body:JSON.stringify({period_id:period.id,tank_id:id,physical_liters:Number(input.value),physical_height_mm:height?Number(height):null,calibration_version:calibration,notes:notes||null})});
      }
      closePhysicalClosingModal();toast('Verified physical closing recorded');await loadVerifiedClosings();
      if(typeof loadAccountingReconciliation==='function')await loadAccountingReconciliation();
    }catch(e){toast(e.message||'Unable to record physical closing');}
    finally{if(button){button.disabled=false;button.textContent='Save verified closing';}}
  };
  document.addEventListener('DOMContentLoaded',()=>setTimeout(loadVerifiedClosings,250));
})();
window.closeAccountingPeriod=function(){
  return api('/api/accounting/current-period').then(async d=>{
    if(!d?.open||!d.period){toast('No open accounting period.');return;}
    const r=await api('/api/accounting/closing?period_id='+encodeURIComponent(d.period.id));
    const closings=r.closings||[];
    const tanks=await api('/api/tanks');
    const active=(Array.isArray(tanks)?tanks:[]).filter(t=>t.active);
    if(closings.length!==active.length){toast('Complete verified physical closing for every active tank first.');return;}
    if(!confirm('Close this controlled accounting period? This cannot be reopened through the normal workflow.'))return;
    try{
      await api('/api/accounting/close',{method:'POST',body:JSON.stringify({period_id:d.period.id})});
      toast('Accounting period closed'); await loadVerifiedClosings();
      if(typeof loadAccountingReconciliation==='function')await loadAccountingReconciliation();
    }catch(e){toast(e.message||'Unable to close accounting period');}
  });
};
