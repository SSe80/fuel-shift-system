-- Harden purchase discharge reconciliation.
-- Physical tank stock entered before discharge is an audit measurement only.
-- It must never overwrite accounting stock or create an automatic adjustment.
create or replace function public.discharge_fuel_purchase(
  p_purchase_id uuid,
  p_discharged_by uuid,
  p_tank_id uuid,
  p_compartment_indexes integer[],
  p_tank_liters_before numeric
) returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_purchase public.purchases%rowtype;
  v_tank public.tanks%rowtype;
  v_system_before numeric;
  v_physical_difference numeric;
  v_new numeric;
  v_indexes integer[];
  v_idx integer;
  v_liters numeric;
  v_total numeric := 0;
  v_compartments jsonb;
  v_all_indexes integer[];
  v_new_discharged_indexes integer[];
  v_fully_discharged boolean := false;
  v_event jsonb;
  v_operation_id uuid := gen_random_uuid();
begin
  if p_compartment_indexes is null or cardinality(p_compartment_indexes)=0 then raise exception 'Select at least one compartment'; end if;
  if p_tank_liters_before is null or p_tank_liters_before < 0 then raise exception 'Enter valid physical tank stock before discharge'; end if;

  select * into v_purchase from public.purchases where id=p_purchase_id for update;
  if not found then raise exception 'Purchase not found'; end if;
  if v_purchase.status <> 'pending_discharge' then raise exception 'Purchase is not pending discharge'; end if;

  select * into v_tank from public.tanks where id=p_tank_id and active=true for update;
  if not found then raise exception 'Selected tank is not active or was not found'; end if;

  if v_purchase.product_id is not null and v_tank.product_id is not null then
    if v_purchase.product_id <> v_tank.product_id then raise exception 'Selected tank does not match the purchase product'; end if;
  elsif lower(trim(coalesce(v_purchase.product,''))) <> lower(trim(coalesce(v_tank.product,''))) then
    raise exception 'Selected tank does not match the purchase product';
  end if;

  v_compartments := coalesce(v_purchase.compartment_liters,'[]'::jsonb);
  if jsonb_typeof(v_compartments) <> 'array' or jsonb_array_length(v_compartments)=0 then v_compartments := jsonb_build_array(v_purchase.quantity_liters); end if;

  v_indexes := array(select distinct x from unnest(p_compartment_indexes) x order by x);
  if cardinality(v_indexes) <> cardinality(p_compartment_indexes) then raise exception 'Duplicate compartment selection'; end if;
  v_all_indexes := array(select generate_series(1,jsonb_array_length(v_compartments)));

  foreach v_idx in array v_indexes loop
    if not (v_idx = any(v_all_indexes)) then raise exception 'Invalid compartment selection'; end if;
    if v_idx = any(coalesce(v_purchase.discharged_compartment_indexes,'{}'::integer[])) then raise exception 'One or more selected compartments were already discharged'; end if;
    v_liters := (v_compartments -> (v_idx-1))::text::numeric;
    if v_liters <= 0 then raise exception 'Selected compartment has an invalid quantity'; end if;
    v_total := v_total + v_liters;
  end loop;

  if v_total <= 0 then raise exception 'Selected quantity must be greater than zero'; end if;

  v_system_before := coalesce(v_tank.current_liters,0);
  v_physical_difference := p_tank_liters_before - v_system_before;
  v_new := v_system_before + v_total;
  if v_new > v_tank.capacity_liters then raise exception 'Discharge would exceed tank capacity based on accounting stock'; end if;

  v_new_discharged_indexes := array(select distinct x from unnest(coalesce(v_purchase.discharged_compartment_indexes,'{}'::integer[]) || v_indexes) x order by x);
  v_fully_discharged := cardinality(v_new_discharged_indexes)=cardinality(v_all_indexes);

  v_event := jsonb_build_object(
    'operation_id',v_operation_id,'discharge_datetime',now(),'discharged_by',p_discharged_by,
    'tank_id',v_tank.id,'tank_code',v_tank.tank_code,
    'system_liters_before',v_system_before,'physical_tank_liters_before',p_tank_liters_before,
    'physical_vs_system_difference_liters',v_physical_difference,'tank_liters_after',v_new,
    'discharged_quantity_liters',v_total,'compartment_indexes',to_jsonb(v_indexes),
    'compartment_liters',(select jsonb_agg((v_compartments -> (x-1)) order by x) from unnest(v_indexes) x)
  );

  update public.tanks set current_liters=v_new,updated_at=now() where id=v_tank.id;

  update public.purchases
  set discharged_compartment_indexes=v_new_discharged_indexes,
      discharged_quantity_liters=coalesce(discharged_quantity_liters,0)+v_total,
      discharge_history=coalesce(discharge_history,'[]'::jsonb) || jsonb_build_array(v_event),
      status=case when v_fully_discharged then 'discharged' else 'pending_discharge' end,
      discharged_at=case when v_fully_discharged then now() else discharged_at end,
      discharged_by=case when v_fully_discharged then p_discharged_by else discharged_by end
  where id=v_purchase.id;

  insert into public.tank_movements(tank_id,movement_type,quantity_liters,reference_id,notes,created_by)
  values(v_tank.id,'purchase',v_total,v_purchase.id,'Fuel purchase compartments discharged; physical pre-discharge reading recorded for reconciliation',p_discharged_by);

  select * into v_purchase from public.purchases where id=p_purchase_id;
  return jsonb_build_object('purchase',to_jsonb(v_purchase),'tank_id',v_tank.id,'system_liters_before',v_system_before,'physical_tank_liters_before',p_tank_liters_before,'physical_vs_system_difference_liters',v_physical_difference,'new_liters',v_new,'discharged_quantity_liters',v_total,'fully_discharged',v_fully_discharged,'operation_id',v_operation_id);
end;
$function$;