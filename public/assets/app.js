async function userDashboard(){
  try{
    const me=await currentUser();
    if(me.role!=='attendant')return location.href='admin-dashboard.html';
    document.getElementById('name').textContent=me.name;
    const [shifts,nozzles,products,tanks,handovers,employees]=await Promise.all([
      api('/api/shifts'),api('/api/nozzles'),api('/api/products'),api('/api/tanks'),api('/api/handovers'),api('/api/users')
    ]);
    const productCodes=Object.fromEntries(products.map(p=>[String(p.name).toLowerCase(),p.code_name]));
    const codeForProduct=product=>productCodes[String(product||'').toLowerCase()]||product;
    const tankNames=Object.fromEntries(tanks.map(t=>[t.id,t.tank_code]));
    const employeeNames=Object.fromEntries(employees.map(e=>[e.id,e.name]));
    const active=shifts.filter(s=>s.status==='active');
    const box=document.getElementById('shift');
    const pendingHandovers=handovers.filter(x=>x.status==='pending'&&String(x.to_employee_id)===String(me.id));
    const pendingHandoverHtml=pendingHandovers.length?pendingHandovers.map(x=>{
      const shift=shifts.find(s=>s.id===x.shift_id);
      const n=nozzles.find(item=>item.id===shift?.nozzle_id);
      return '<div class="card"><div class="top"><div><h3>Pending Handover</h3><span class="badge">Awaiting your confirmation</span></div></div><p>From: <b>'+h(employeeNames[x.from_employee_id]||x.from_employee_id)+'</b></p><p>Dispenser: <b>'+h(n?.nozzle_code||shift?.nozzle_id||'Dispenser')+'</b> • '+h(codeForProduct(n?.product||''))+'</p><p>Closing meter: <b>'+liters(x.closing_reading)+'</b> • Closing tank: <b>'+liters(x.closing_liters)+' L</b></p><form class="form" onsubmit="confirmHandoverFromDashboard(event,\''+x.id+'\')"><input id="dashboard-confirm-reading-'+x.id+'" type="number" min="0" step="0.01" placeholder="Opening meter reading" required><input id="dashboard-confirm-mm-'+x.id+'" type="number" min="0" step="0.01" placeholder="Opening dip (mm)" required><input id="dashboard-confirm-liters-'+x.id+'" type="number" min="0" step="0.01" placeholder="Opening tank liters" required><input id="dashboard-handover-pin-'+x.id+'" type="password" inputmode="numeric" autocomplete="current-password" placeholder="Enter your PIN" required><button class="primary">Confirm Handover & Start Shift</button></form></div>';
    }).join(''):'';
    const activeHtml=active.length?active.map(s=>{
      const n=nozzles.find(x=>x.id===s.nozzle_id);
      return '<div class="card"><div class="top"><h3>Active Shift</h3><span class="badge">active</span></div><p>Dispenser: <b>'+h(n?.nozzle_code||s.nozzle_id)+'</b> • '+h(codeForProduct(n?.product||''))+'</p><p>Tank: <b>'+h(tankNames[n?.tank_id]||n?.tank_id||'Not connected')+'</b></p><p>Opening meter: <b>'+liters(s.opening_reading)+'</b></p><div class="row"><a class="btn primary" href="sales.html?shift_id='+encodeURIComponent(s.id)+'">Record Sale</a><a class="btn" href="handover.html?shift_id='+encodeURIComponent(s.id)+'">Handover</a></div><form class="form" onsubmit="closeShift(event,\''+s.id+'\')"><input id="close-reading-'+s.id+'" type="number" min="0" step="0.01" placeholder="Closing meter reading" required><input id="close-mm-'+s.id+'" type="number" min="0" step="0.01" placeholder="Closing dip (mm)" required><input id="close-liters-'+s.id+'" type="number" min="0" step="0.01" placeholder="Closing tank liters" required><button class="primary">Close Shift</button></form></div>';
    }).join(''):'';
    box.innerHTML=pendingHandoverHtml+activeHtml;
  }catch(e){
    if(e.message==='Unauthorized')location.href='attendant-login.html';
    else{const s=document.getElementById('employee-status');if(s)s.textContent=e.message;}
  }
}