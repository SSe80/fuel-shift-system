-- Enforce the controlled accounting-period boundary.
create or replace function public.validate_new_tank_movement()
returns trigger language plpgsql security definer set search_path=public as $$
declare v_any_period boolean; v_open_period boolean;
begin
  select exists(select 1 from public.accounting_periods) into v_any_period;
  if v_any_period then
    select exists(select 1 from public.accounting_periods where status='OPEN') into v_open_period;
    if not v_open_period then raise exception 'No open controlled accounting period; tank movements are locked'; end if;
    if NEW.movement_type='opening' then raise exception 'Tank opening movements are not allowed inside a controlled period; use the control-period opening snapshot'; end if;
  end if;
  return NEW;
end; $$;
drop trigger if exists trg_validate_new_tank_movement on public.tank_movements;
create trigger trg_validate_new_tank_movement before insert on public.tank_movements for each row execute function public.validate_new_tank_movement();

create or replace function public.record_fuel_sale(p_shift_id uuid,p_employee_id uuid,p_nozzle_id uuid,p_product text,p_quantity_liters numeric,p_unit_price numeric,p_payment_method text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_shift public.shifts%rowtype; v_nozzle public.nozzles%rowtype; v_tank public.tanks%rowtype; v_sale public.sales%rowtype; v_new_liters numeric;
begin
 if p_quantity_liters<=0 then raise exception 'Quantity must be greater than zero'; end if;
 if p_unit_price<0 then raise exception 'Unit price cannot be negative'; end if;
 select * into v_shift from public.shifts where id=p_shift_id and employee_id=p_employee_id and nozzle_id=p_nozzle_id and status='active' for update;
 if not found then raise exception 'Active shift not found'; end if;
 select * into v_nozzle from public.nozzles where id=p_nozzle_id and active=true for share;
 if not found then raise exception 'Active nozzle not found'; end if;
 if lower(trim(p_product))<>lower(trim(v_nozzle.product)) then raise exception 'Product does not match assigned nozzle'; end if;
 if v_nozzle.tank_id is null then raise exception 'No tank is assigned to the nozzle'; end if;
 select * into v_tank from public.tanks where id=v_nozzle.tank_id for update;
 if not found then raise exception 'Tank not found'; end if;
 if p_quantity_liters>coalesce(v_tank.current_liters,0) then raise exception 'Not enough fuel in the tank'; end if;
 v_new_liters:=coalesce(v_tank.current_liters,0)-p_quantity_liters;
 insert into public.sales(shift_id,employee_id,nozzle_id,product,quantity_liters,unit_price,amount,payment_method)
 values(p_shift_id,p_employee_id,p_nozzle_id,v_nozzle.product,p_quantity_liters,p_unit_price,p_quantity_liters*p_unit_price,p_payment_method) returning * into v_sale;
 insert into public.tank_movements(tank_id,movement_type,quantity_liters,reference_id,notes,created_by)
 values(v_tank.id,'sale',p_quantity_liters,v_sale.id,'Fuel sale',p_employee_id);
 update public.tanks set current_liters=v_new_liters,updated_at=now() where id=v_tank.id;
 return jsonb_build_object('sale',to_jsonb(v_sale),'tank_id',v_tank.id,'remaining_liters',v_new_liters);
end; $$;

create or replace function public.activate_dispenser(p_nozzle_id uuid,p_employee_id uuid,p_opening_tank_liters numeric,p_activated_nozzles jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_nozzle public.nozzles%rowtype; v_tank public.tanks%rowtype; v_item jsonb; v_opening numeric; v_count integer:=0; v_shift_id uuid; v_first_opening numeric; v_controlled boolean;
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
  v_opening:=(v_item->>'opening_reading')::numeric;
  if coalesce(v_opening,-1)<0 then raise exception 'Invalid nozzle opening reading'; end if;
  if not exists(select 1 from unnest(v_nozzle.nozzle_ids) x where x=v_item->>'nozzle_id') then raise exception 'Invalid nozzle ID for this dispenser'; end if;
  if v_first_opening is null then v_first_opening:=v_opening; end if;
  v_count:=v_count+1;
 end loop;
 if v_count=0 then raise exception 'At least one nozzle must be activated'; end if;
 if not v_controlled then
  update public.tanks set current_liters=p_opening_tank_liters,updated_at=now() where id=v_tank.id;
  insert into public.tank_movements(tank_id,movement_type,quantity_liters,notes,created_by) values(v_tank.id,'opening',p_opening_tank_liters,'Dispenser activation opening balance',p_employee_id);
 end if;
 update public.nozzles set active=true,activated_by=p_employee_id,activated_at=now(),opening_tank_liters=p_opening_tank_liters where id=v_nozzle.id;
 if not exists(select 1 from public.shifts where nozzle_id=v_nozzle.id and status in ('assigned','active')) then
  insert into public.shifts(employee_id,nozzle_id,opening_reading,status,assigned_by,assigned_at) values(p_employee_id,v_nozzle.id,v_first_opening,'assigned',p_employee_id,now()) returning id into v_shift_id;
 end if;
 return jsonb_build_object('ok',true,'tank_id',v_tank.id,'opening_tank_liters',p_opening_tank_liters,'activated_nozzles',p_activated_nozzles,'shift_id',v_shift_id,'controlled_period',v_controlled);
end; $$;

do $$
declare v_def text;
begin
 v_def:=pg_get_functiondef('public.confirm_dispenser_deactivation(uuid,uuid,jsonb,numeric)'::regprocedure);
 v_def:=replace(v_def,'v_nozzle.tank_id,''sale'',-v_total_liters','v_nozzle.tank_id,''sale'',v_total_liters');
 execute v_def;
end $$;