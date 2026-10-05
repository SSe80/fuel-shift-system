(function(){
  'use strict';

  function parseCalibrationCsv(text){
    const rows=[];
    const lines=String(text||'').replace(/^\uFEFF/,'').split(/\r?\n/);
    let orientation='height_liters';

    const numeric = value => /^[-+]?\d+(?:\.\d+)?$/.test(String(value).trim());
    const cleanNumberText = value => String(value ?? '')
      .trim()
      .replace(/^["']|["']$/g,'')
      .replace(/\s/g,'')
      .replace(/,/g,'');

    for(let i=0;i<lines.length;i++){
      const raw=lines[i].trim();
      if(!raw) continue;

      const delimiter = raw.includes(';') ? ';' : raw.includes('\t') ? '\t' : ',';
      let cols;

      if(delimiter !== ','){
        cols=raw.split(delimiter).map(x=>x.trim().replace(/^["']|["']$/g,''));
      }else{
        // First try normal CSV quoting. This handles files such as:
        // 1,000,115   and   "1,000",115
        const parts=raw.split(',');
        if(parts.length===1){
          cols=[raw.trim().replace(/^["']|["']$/g,'')];
        }else{
          const unquoted=parts.map(x=>x.trim().replace(/^["']|["']$/g,''));
          // When commas are thousands separators, all fields are numeric.
          // In Liters,Height mm format the last numeric token is height and
          // every preceding token belongs to the liters value.
          if(unquoted.length>2 && unquoted.every(numeric)){
            cols=[unquoted.slice(0,-1).join(''),unquoted[unquoted.length-1]];
          }else{
            cols=unquoted;
          }
        }
      }

      // Detect the column order from the header.
      if(/height/i.test(raw) && /liter/i.test(raw)){
        const heightIndex=cols.findIndex(x=>/height/i.test(x));
        const litersIndex=cols.findIndex(x=>/liter/i.test(x));
        if(heightIndex>=0 && litersIndex>=0){
          orientation=heightIndex<litersIndex?'height_liters':'liters_height';
        }
        continue;
      }

      if(cols.length!==2){
        throw new Error('CSV row '+(i+1)+' has '+cols.length+' columns. Use height_mm,liters or the original Liters,Height mm format.');
      }

      let heightText=cols[0];
      let litersText=cols[1];
      if(orientation==='liters_height'){
        heightText=cols[1];
        litersText=cols[0];
      }

      const height=Number(cleanNumberText(heightText));
      const liters=Number(cleanNumberText(litersText));

      if(!Number.isFinite(height)||!Number.isFinite(liters)){
        throw new Error('CSV row '+(i+1)+' contains an invalid number. Check that the row contains numeric liters and height values.');
      }
      if(height<0||liters<0) throw new Error('CSV row '+(i+1)+' cannot contain negative values.');

      rows.push({height_mm:height,liters:liters});
    }

    if(rows.length<2) throw new Error('CSV must contain at least two calibration points.');

    for(let i=1;i<rows.length;i++){
      if(rows[i].height_mm<=rows[i-1].height_mm){
        if(rows[i].height_mm===rows[i-1].height_mm){
          throw new Error('Duplicate calibration height: '+rows[i].height_mm+' mm (CSV rows '+(i+1)+' and '+(i+2)+').');
        }
        throw new Error('Calibration heights must be strictly increasing. CSV row '+(i+2)+' has '+rows[i].height_mm+' mm after '+rows[i-1].height_mm+' mm.');
      }
    }
    return rows;
  }

  function calibrationFileChanged(input){
    const status=document.getElementById('edit-tank-calibration-status');
    const file=input&&input.files&&input.files[0];
    if(!file){
      window.pendingTankCalibration=null;
      if(status) status.textContent='No new calibration file selected.';
      return;
    }
    const reader=new FileReader();
    reader.onload=function(){
      try{
        const points=parseCalibrationCsv(reader.result);
        window.pendingTankCalibration=points;

        const first=points[0], last=points[points.length-1];
        const test=points.find(p=>Number(p.height_mm)===1600);
        let message=points.length+' calibration points loaded from '+file.name+'.';
        if(test) message+=' 1600 mm = '+Number(test.liters).toLocaleString()+' L.';
        else if(first && last) message+=' Range: '+Number(first.height_mm).toLocaleString()+'–'+Number(last.height_mm).toLocaleString()+' mm.';
        if(status) status.textContent=message;

        if(typeof updateCalibrationVerification==='function') updateCalibrationVerification(points);
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

  function formatCalibrationLiters(value){
    if(typeof liters==='function') return liters(value)+' L';
    return Number(value).toLocaleString(undefined,{maximumFractionDigits:2})+' L';
  }

  function calibrationValueAt(points,mm){
    const p=points.slice().sort((a,b)=>Number(a.height_mm)-Number(b.height_mm));
    if(mm<=Number(p[0].height_mm)) return Number(p[0].liters);
    if(mm>=Number(p[p.length-1].height_mm)) return Number(p[p.length-1].liters);
    for(let i=1;i<p.length;i++){
      const a=p[i-1],b=p[i],ah=Number(a.height_mm),bh=Number(b.height_mm);
      if(mm<=bh){
        const ratio=(mm-ah)/(bh-ah);
        return Number(a.liters)+(Number(b.liters)-Number(a.liters))*ratio;
      }
    }
    return null;
  }

  function updateCalibrationVerification(points){
    const count=document.getElementById('edit-tank-calibration-point-count');
    const result=document.getElementById('edit-tank-calibration-test-result');
    if(count) count.textContent=Array.isArray(points)&&points.length
      ? points.length+' calibration points loaded. The full curve will be used for dip conversion.'
      : 'No calibration loaded.';
    if(result){
      const test=Array.isArray(points)?points.find(p=>Number(p.height_mm)===1600):null;
      result.textContent=test
        ? '1,600 mm = '+formatCalibrationLiters(test.liters)+' (calibration point)'
        : 'Enter a dip to verify the calibration.';
    }
  }

  function verifyTankCalibrationDip(value){
    const result=document.getElementById('edit-tank-calibration-test-result');
    const input=Number(value);
    let points=Array.isArray(window.pendingTankCalibration)?window.pendingTankCalibration:[];
    if(!points.length){
      const id=document.getElementById('edit-tank-id')?.value;
      const tank=(window.tankRecords||[]).find(x=>String(x.id)===String(id));
      points=Array.isArray(tank?.calibration_points)?tank.calibration_points:[];
    }
    if(!result) return;
    if(!Number.isFinite(input)||input<0){ result.textContent='Enter a valid dip in mm.'; return; }
    if(points.length<2){ result.textContent='No calibration points are available for this tank.'; return; }
    const litersValue=calibrationValueAt(points,input);
    result.textContent=Number.isFinite(litersValue)
      ? input.toLocaleString()+' mm ≈ '+formatCalibrationLiters(litersValue)
      : 'Could not calculate calibration value.';
  }

  window.verifyTankCalibrationDip=verifyTankCalibrationDip;
  window.calibrationFileChanged=calibrationFileChanged;
  window.parseTankCalibrationCsv=parseCalibrationCsv;

  const originalOpen=window.openTankEdit;
  window.openTankEdit=function(id){
    if(typeof originalOpen==='function') originalOpen(id);
    window.pendingTankCalibration=null;
    const input=document.getElementById('edit-tank-calibration-file');
    const status=document.getElementById('edit-tank-calibration-status');
    if(input) input.value='';
    const test=document.getElementById('edit-tank-calibration-test-mm');
    if(test) test.value='';
    const tank=(window.tankRecords||[]).find(x=>String(x.id)===String(id));
    const count=Array.isArray(tank&&tank.calibration_points)?tank.calibration_points.length:0;
    if(status) status.textContent=count?count+' calibration points currently stored. Upload a CSV to replace them.':'No calibration CSV stored for this tank.';
    updateCalibrationVerification(Array.isArray(tank&&tank.calibration_points)?tank.calibration_points:[]);
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