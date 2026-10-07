-- Record authoritative nozzle opening readings during dispenser activation.
-- Existing historical shifts are untouched.

create or replace function public.activate_dispenser(p_nozzle_id uuid,p_employee_id uuid,p_opening_tank_liters numeric,p_activated_nozzles jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
 v_nozzle public.nozzles%rowtype; v_tank public.tanks%rowtype; v_item jsonb; v_opening numeric; v_code text;
 v_count integer:=0; v_shift_id uuid; v_first_opening numeric; v_controlled boolean; v_dn_id uuid;
begin
 if p_opening_tank_liters is null or p_opening_tank_liters<0 then raise exception 'Invalid tank opening liters'; end if;
 select exists(select 1 from public.accounting_periods) into v_controlled;
 select * into v_nozzle from public.nozzles where id=p_nozzle_id for update;
 if not found then raise exception 'Dispenser not found'; end if;
 if v_nozzle.tank_id is null then raise exception 'Dispenser has no connected tank'; end if;
 select * into v_tank from public.tanks where id=v_nozzle.tank_id for update;
 if not found or not v_tank.active then raise exception 'Connected tank is not active'; end if;
 if not exists(select 1 from public.employees where id=p_employee_id and role='attendant' and active=true) then raise exception 'Active attendant not found'; end if;
 if jsonb_typeof(p_activated_nozzles)<>'array' or jsonb_array_length(p_activated_nozzles)=0 then raise exception 'At least one nozzle must be activated'; end if;

 for v_item in select * from jsonb_array_elements(p_activated_nozzles) loop
  v_code:=nullif(trim(v_item->>'nozzle_id'),'');
  v_opening:=(v_item->>'opening_reading')::numeric;
  if v_code is null or coalesce(v_opening,-1)<0 then raise exception 'Invalid nozzle opening reading'; end if;
  if not exists(select 1 from unnest(v_nozzle.nozzle_ids) x where x=v_code) then raise exception 'Invalid nozzle ID for this dispenser'; end if;
  if not exists(select 1 from public.dispenser_nozzles dn join public.dispensers d on d.id=dn.dispenser_id where dn.nozzle_code=v_code and d.dispenser_code=v_nozzle.nozzle_code) then raise exception 'Physical nozzle not found'; end if;
  if v_first_opening is null then v_first_opening:=v_opening; end if;
  v_count:=v_count+1;
 end loop;
 if v_count=0 then raise exception 'At least one nozzle must be activated'; end if;

 if not v_controlled then
  update public.tanks set current_liters=p_opening_tank_liters,updated_at=now() where id=v_tank.id;
  insert into public.tank_movements(tank_id,movement_type,quantity_liters,notes,created_by)
  values(v_tank.id,'opening',p_opening_tank_liters,'Dispenser activation opening balance',p_employee_id);
 end if;

 update public.nozzles set active=true,activated_by=p_employee_id,activated_at=now(),opening_tank_liters=p_opening_tank_liters where id=v_nozzle.id;

 select id into v_shift_id from public.shifts
 where nozzle_id=v_nozzle.id and status in ('assigned','active')
 order by start_time desc nulls last,assigned_at desc nulls last limit 1
 for update;

 if v_shift_id is null then
  insert into public.shifts(employee_id,nozzle_id,opening_reading,status,assigned_by,assigned_at)
  values(p_employee_id,v_nozzle.id,v_first_opening,'assigned',p_employee_id,now())
  returning id into v_shift_id;
 end if;

 for v_item in select * from jsonb_array_elements(p_activated_nozzles) loop
  v_code:=trim(v_item->>'nozzle_id');
  v_opening:=(v_item->>'opening_reading')::numeric;
  select dn.id into v_dn_id
  from public.dispenser_nozzles dn
  join public.dispensers d on d.id=dn.dispenser_id
  where dn.nozzle_code=v_code and d.dispenser_code=v_nozzle.nozzle_code
  limit 1;
  insert into public.shift_nozzle_readings(shift_id,nozzle_id,opening_reading,opened_at)
  values(v_shift_id,v_dn_id,v_opening,now())
  on conflict (shift_id,nozzle_id) do update set opening_reading=excluded.opening_reading,opened_at=excluded.opened_at;
 end loop;

 return jsonb_build_object('ok',true,'tank_id',v_tank.id,'opening_tank_liters',p_opening_tank_liters,'activated_nozzles',p_activated_nozzles,'shift_id',v_shift_id,'controlled_period',v_controlled);
end; $$;