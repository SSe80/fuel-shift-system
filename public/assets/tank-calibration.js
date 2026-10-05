(function(){
  'use strict';

  function parseCalibrationCsv(text){
    const rows=[];
    const lines=String(text||'').replace(/^\uFEFF/,'').split(/\r?\n/);
    for(let i=0;i<lines.length;i++){
      const raw=lines[i].trim();
      if(!raw) continue;
      const cols=raw.split(/[,;\t]/).map(x=>x.trim().replace(/^"|"$/g,''));
      if(i===0 && /height/i.test(cols[0]) && /liter/i.test(cols[1])) continue;
      if(cols.length<2) throw new Error('CSV row '+(i+1)+' must contain height_mm and liters.');

      // Accept normal CSV (height,liter) and also values such as "1,000,500"
      // when the comma is a thousands separator rather than a column separator.
      let heightText, litersText;
      if(cols.length===2){
        heightText=cols[0]; litersText=cols[1];
      }else if(cols.length===3 && /^\\d+$/.test(cols[0]) && /^\\d+$/.test(cols[1]) && /^\\d+$/.test(cols[2])){
        // Ambiguous 3-column CSV: prefer the documented height_mm,liters format.
        // A row like 1000,500 must never be silently interpreted as height 1.
        heightText=cols[0]; litersText=cols.slice(1).join('');
      }else{
        throw new Error('CSV row '+(i+1)+' has '+cols.length+' columns. Use height_mm,liters (for example 70,500).');
      }
      const height=Number(heightText.replace(/,/g,''));
      const liters=Number(litersText.replace(/,/g,''));
      if(!Number.isFinite(height)||!Number.isFinite(liters)) throw new Error('CSV row '+(i+1)+' contains an invalid number.');
      if(height<0||liters<0) throw new Error('CSV row '+(i+1)+' cannot contain negative values.');
      rows.push({height_mm:height,liters:liters});
    }
    rows.sort((a,b)=>a.height_mm-b.height_mm);
    if(rows.length<2) throw new Error('CSV must contain at least two calibration points.');
    for(let i=1;i<rows.length;i++){
      if(rows[i].height_mm===rows[i-1].height_mm) throw new Error('Duplicate calibration height: '+rows[i].height_mm+' mm (CSV rows '+(rows.findIndex(x=>x===rows[i-1])+1)+' and '+(rows.findIndex(x=>x===rows[i])+1)+'). Check that height_mm values are unique.');
    }
    return rows;
  }

  function calibrationFileChanged(input){
    const status=document.getElementById('edit-tank-calibration-status');
    const file=input&&input.files&&input.files[0];
    if(!file){ window.pendingTankCalibration=null; if(status) status.textContent='No new calibration file selected.'; return; }
    const reader=new FileReader();
    reader.onload=function(){
      try{
        const points=parseCalibrationCsv(reader.result);
        window.pendingTankCalibration=points;
        if(status) status.textContent=points.length+' calibration points loaded from '+file.name+'.';
      }catch(e){
        window.pendingTankCalibration=null;
        input.value='';
        if(status) status.textContent=e.message||'Invalid calibration CSV.';
        if(typeof toast==='function') toast(e.message||'Invalid calibration CSV.');
      }
    };
    reader.onerror=function(){
      window.pendingTankCalibration=null;
      if(status) status.textContent='Could not read the CSV file.';
    };
    reader.readAsText(file);
  }

  window.calibrationFileChanged=calibrationFileChanged;
  window.parseTankCalibrationCsv=parseCalibrationCsv;

  const originalOpen=window.openTankEdit;
  window.openTankEdit=function(id){
    if(typeof originalOpen==='function') originalOpen(id);
    window.pendingTankCalibration=null;
    const input=document.getElementById('edit-tank-calibration-file');
    const status=document.getElementById('edit-tank-calibration-status');
    if(input) input.value='';
    const tank=(window.tankRecords||[]).find(x=>String(x.id)===String(id));
    const count=Array.isArray(tank&&tank.calibration_points)?tank.calibration_points.length:0;
    if(status) status.textContent=count?count+' calibration points currently stored. Upload a CSV to replace them.':'No calibration CSV stored for this tank.';
  };

  window.saveTankEdit=async function(event){
    event.preventDefault();
    const id=document.getElementById('edit-tank-id').value;
    const old=(window.tankRecords||[]).find(x=>String(x.id)===String(id));
    const cap=Number(document.getElementById('edit-tank-capacity').value);
    if(!old) throw new Error('Tank record could not be found. Please reload the page and try again.');
    if(!Number.isFinite(cap)||cap<=0) throw new Error('Enter a valid tank capacity.');

    const points=window.pendingTankCalibration;
    if(Array.isArray(points)){
      const last=points[points.length-1];
      if(last.liters>cap) throw new Error('Calibration liters cannot exceed tank capacity.');
    }
    const details='<p><b>Tank:</b> '+h(old.tank_code||id)+'</p>'+
      settingsDiff('Capacity',liters(old.capacity_liters),liters(cap),'L')+
      (Array.isArray(points)?'<p><b>Calibration:</b> '+points.length+' points will be imported from the CSV.</p>':'<p><b>Calibration:</b> Unchanged</p>');
    showSettingsConfirmation('Review Tank Update',details,()=>window._saveTankEditCsv(),'Tank updated successfully',
      '<p><b>'+h(old.tank_code||id)+'</b> was updated successfully.</p>'+details);
  };

  window._saveTankEditCsv=async function(){
    const id=document.getElementById('edit-tank-id').value;
    const capacity=Number(document.getElementById('edit-tank-capacity').value);
    const points=window.pendingTankCalibration;
    const body={capacity_liters:capacity};
    if(Array.isArray(points)) body.calibration_points=points;
    await api('/api/tanks/'+encodeURIComponent(id),{method:'PATCH',body:JSON.stringify(body)});
    closeTankEdit();
    await loadSettingsData();
  };

  const originalConvert=window.convertTankDip;
  window.convertTankDip=function(id,input){
    const t=(window.tankRecords||[]).find(x=>String(x.id)===String(id));
    const output=document.getElementById('tank-dip-liters-'+id);
    if(!t||!output){ if(typeof originalConvert==='function') originalConvert(id,input); return; }
    const mm=Number(input&&input.value);
    if(!Number.isFinite(mm)||mm<0){output.textContent='—';return;}
    const points=Array.isArray(t.calibration_points)?t.calibration_points:[];
    if(points.length>=2){
      const p=points.slice().sort((a,b)=>Number(a.height_mm)-Number(b.height_mm));
      let value;
      if(mm<=Number(p[0].height_mm)) value=Number(p[0].liters);
      else if(mm>=Number(p[p.length-1].height_mm)) value=Number(p[p.length-1].liters);
      else for(let i=1;i<p.length;i++){
        const a=p[i-1],b=p[i],ah=Number(a.height_mm),bh=Number(b.height_mm);
        if(mm<=bh){ const ratio=(mm-ah)/(bh-ah); value=Number(a.liters)+(Number(b.liters)-Number(a.liters))*ratio; break; }
      }
      output.textContent=Number.isFinite(value)&&value<=Number(t.capacity_liters||0)?liters(value)+' L':'Over capacity';
      return;
    }
    if(typeof originalConvert==='function') originalConvert(id,input);
  };
})();