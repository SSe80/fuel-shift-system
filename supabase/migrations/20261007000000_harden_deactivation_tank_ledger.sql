-- Harden dispenser deactivation reconciliation.
-- The physical tank closing reading is an audit measurement; it must not overwrite
-- the accounting balance. The meter-derived sale is recorded in tank_movements.
create or replace function public.confirm_dispenser_deactivation(
  p_request_id uuid,p_attendant_id uuid,p_closing_nozzle_readings jsonb,p_closing_tank_liters numeric
) returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_req public.dispenser_deactivation_requests%rowtype;
  v_shift public.shifts%rowtype;
  v_nozzle public.nozzles%rowtype;
  v_sr record;
  v_item jsonb;
  v_reading numeric;
  v_liters numeric;
  v_price numeric;
  v_product text;
  v_product_id uuid;
  v_total_liters numeric:=0;
  v_total_amount numeric:=0;
  v_opening_tank numeric:=0;
  v_tank_purchases numeric:=0;
  v_expected_closing numeric:=0;
  v_variance numeric:=0;
  v_variance_pct numeric:=0;
  v_end timestamptz:=now();
  v_h public.handovers%rowtype;
  v_takeover_id uuid;
  v_closing_json jsonb:='[]'::jsonb;
  v_opening_json jsonb:='[]'::jsonb;
  v_sales_json jsonb:='[]'::jsonb;
  v_count integer:=0;
  v_newer_movement boolean:=false;
begin
  if p_closing_tank_liters is null or p_closing_tank_liters<0 then
    raise exception 'Closing tank stock cannot be negative';
  end if;

  select * into v_req
  from dispenser_deactivation_requests
  where id=p_request_id and attendant_id=p_attendant_id and status='pending'
  for update;
  if not found then raise exception 'Pending dispenser deactivation not found'; end if;

  select * into v_shift from shifts where id=v_req.shift_id for update;
  if not found or v_shift.status<>'active' then raise exception 'Active shift not found'; end if;

  select * into v_nozzle from nozzles where id=v_req.nozzle_id for update;
  if not found or not v_nozzle.active then raise exception 'Dispenser is no longer active'; end if;

  if p_closing_nozzle_readings is null or jsonb_typeof(p_closing_nozzle_readings)<>'array' then
    raise exception 'Closing reading is required for every dispenser nozzle';
  end if;

  for v_sr in
    select r.*,dn.nozzle_code,dn.product_id,dn.tank_id
    from shift_nozzle_readings r
    join dispenser_nozzles dn on dn.id=r.nozzle_id
    where r.shift_id=v_shift.id
    order by dn.nozzle_number
  loop
    select x.value into v_item
    from jsonb_array_elements(p_closing_nozzle_readings) x
    where coalesce(x.value->>'nozzle_id','')=v_sr.nozzle_id::text
       or coalesce(x.value->>'nozzle_id','')=v_sr.nozzle_code
    limit 1;

    if v_item is null then
      raise exception 'Closing reading is required for nozzle %',v_sr.nozzle_code;
    end if;

    begin
      v_reading:=(v_item->>'reading')::numeric;
    exception when others then
      raise exception 'Invalid closing reading for nozzle %',v_sr.nozzle_code;
    end;

    if v_reading<v_sr.opening_reading then
      raise exception 'Closing reading for nozzle % cannot be lower than opening reading %',
        v_sr.nozzle_code,v_sr.opening_reading;
    end if;

    v_liters:=v_reading-v_sr.opening_reading;

    select p.id,p.name,p.selling_price
    into v_product_id,v_product,v_price
    from products p where p.id=v_sr.product_id limit 1;

    if v_product_id is null then
      select p.id,p.name,p.selling_price
      into v_product_id,v_product,v_price
      from products p
      where lower(p.name)=lower(v_nozzle.product)
         or lower(p.code_name)=lower(v_nozzle.product)
      order by p.updated_at desc limit 1;
    end if;

    select hph.selling_price into v_price
    from product_price_history hph
    where hph.product_id=v_product_id and hph.changed_at<=v_end
    order by hph.changed_at desc limit 1;

    v_price:=coalesce(v_price,(select p.selling_price from products p where p.id=v_product_id));

    if v_product_id is null or v_price is null then
      raise exception 'Selling price is not configured for nozzle %',v_sr.nozzle_code;
    end if;

    v_total_liters:=v_total_liters+v_liters;
    v_total_amount:=v_total_amount+v_liters*v_price;
    v_count:=v_count+1;

    v_opening_json:=v_opening_json||jsonb_build_array(jsonb_build_object(
      'nozzle_id',v_sr.nozzle_code,'nozzle_uuid',v_sr.nozzle_id,
      'opening_reading',v_sr.opening_reading
    ));
    v_closing_json:=v_closing_json||jsonb_build_array(jsonb_build_object(
      'nozzle_id',v_sr.nozzle_code,'nozzle_uuid',v_sr.nozzle_id,
      'closing_reading',v_reading
    ));
    v_sales_json:=v_sales_json||jsonb_build_array(jsonb_build_object(
      'nozzle_id',v_sr.nozzle_code,'nozzle_uuid',v_sr.nozzle_id,
      'opening_reading',v_sr.opening_reading,'closing_reading',v_reading,
      'liters_sold',v_liters,'product',v_product,'unit_price',v_price,
      'amount',v_liters*v_price
    ));

    update shift_nozzle_readings
    set closing_reading=v_reading,closed_at=v_end
    where id=v_sr.id;
  end loop;

  if v_count=0 then raise exception 'Nozzle closing readings are required'; end if;

  v_opening_tank:=coalesce(v_shift.opening_tank_liters,0);

  -- Only actual purchase movements during this shift affect the shift ledger.
  -- The purchase header quantity is deliberately not used here because one
  -- purchase may be split across tanks/compartments.
  select coalesce(sum(tm.quantity_liters),0)
  into v_tank_purchases
  from tank_movements tm
  where tm.tank_id=v_nozzle.tank_id
    and lower(tm.movement_type)='purchase'
    and tm.created_at>=v_shift.start_time
    and tm.created_at<=v_end;

  v_expected_closing:=v_opening_tank+v_tank_purchases-v_total_liters;
  if v_expected_closing<0 then
    raise exception 'Deactivation would create negative expected tank stock';
  end if;

  -- Policy: physical - expected. Do not hide the variance by changing stock.
  v_variance:=p_closing_tank_liters-v_expected_closing;
  v_variance_pct:=case
    when abs(v_expected_closing)>0 then abs(v_variance)/abs(v_expected_closing)*100
    else 0
  end;

  update shifts
  set status='completed',
      end_time=v_end,
      closing_reading=(select max((x->>'closing_reading')::numeric)
                       from jsonb_array_elements(v_closing_json) x),
      closing_liters=p_closing_tank_liters
  where id=v_shift.id;

  insert into handovers(
    shift_id,from_employee_id,to_employee_id,closing_reading,closing_liters,
    closing_nozzle_readings,status,confirmed_at,opening_reading,opening_liters
  )
  values(
    v_shift.id,v_shift.employee_id,v_req.requested_by,
    (select max((x->>'closing_reading')::numeric) from jsonb_array_elements(v_closing_json) x),
    p_closing_tank_liters,v_closing_json,'confirmed',v_end,
    (select max((x->>'opening_reading')::numeric) from jsonb_array_elements(v_opening_json) x),
    v_shift.opening_tank_liters
  )
  returning * into v_h;

  insert into handover_nozzle_readings(handover_id,nozzle_id,closing_reading,recorded_at)
  select v_h.id,(x->>'nozzle_uuid')::uuid,(x->>'closing_reading')::numeric,v_end
  from jsonb_array_elements(v_closing_json) x;

  -- The meter-derived fuel movement is the authoritative stock reduction.
  insert into tank_movements(
    tank_id,movement_type,quantity_liters,reference_id,notes,created_by
  )
  values(
    v_nozzle.tank_id,'sale',-v_total_liters,v_h.id,
    'Shift/deactivation meter reconciliation sale',p_attendant_id
  );

  insert into shift_takeovers(
    handover_id,shift_id,from_employee_id,to_employee_id,shift_started_at,shift_ended_at,
    nozzle_opening_readings,nozzle_closing_readings,nozzle_sales_liters,
    total_sales_liters,total_sales_amount,tank_id,tank_opening_liters,
    tank_closing_liters,tank_sales_liters,tank_variance_liters,tank_variance_pct
  )
  values(
    v_h.id,v_shift.id,v_shift.employee_id,v_req.requested_by,v_shift.start_time,v_end,
    v_opening_json,v_closing_json,v_sales_json,v_total_liters,v_total_amount,
    v_nozzle.tank_id,v_opening_tank,p_closing_tank_liters,v_total_liters,
    v_variance,v_variance_pct
  )
  returning id into v_takeover_id;

  -- Do not overwrite the accounting balance with the physical measurement.
  -- Only advance live balance when no newer movement exists.
  select exists(
    select 1 from tank_movements tm
    where tm.tank_id=v_nozzle.tank_id and tm.created_at>v_end
  ) into v_newer_movement;

  if not v_newer_movement then
    update tanks
    set current_liters=v_expected_closing,updated_at=v_end
    where id=v_nozzle.tank_id;
  end if;

  update nozzles set active=false where id=v_nozzle.id;
  if v_nozzle.nozzle_ids is not null then
    update dispenser_nozzles
    set active=false
    where nozzle_code=any(v_nozzle.nozzle_ids);
  end if;

  update dispenser_deactivation_requests
  set status='confirmed',confirmed_at=v_end,confirmed_by=p_attendant_id
  where id=v_req.id;

  return jsonb_build_object(
    'request',to_jsonb(v_req),
    'handover',to_jsonb(v_h),
    'takeover_id',v_takeover_id,
    'expected_closing_liters',v_expected_closing,
    'physical_closing_liters',p_closing_tank_liters,
    'tank_variance_liters',v_variance,
    'tank_variance_pct',v_variance_pct,
    'takeover',(select to_jsonb(st) from shift_takeovers st where st.id=v_takeover_id)
  );
end; $$;

revoke all on function public.confirm_dispenser_deactivation(uuid,uuid,jsonb,numeric) from public,anon,authenticated;
grant execute on function public.confirm_dispenser_deactivation(uuid,uuid,jsonb,numeric) to service_role;
