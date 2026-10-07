-- Harden shift handover reconciliation.
-- Historical shift records are untouched.
-- Physical tank closing is audit data; the tank ledger is driven by actual
-- purchase/sale movements.

do $do$
declare v_def text;
begin
  v_def:=pg_get_functiondef('public.confirm_shift_handover(uuid,uuid,numeric,numeric,numeric)'::regprocedure);

  v_def:=replace(v_def,
    $old$select coalesce(sum(p.quantity_liters),0) into v_tank_purchases
  from public.purchases p
  where p.shift_id=v_shift.id
    and p.tank_id=v_old_nozzle.tank_id
    and p.purchase_date>=v_shift.start_time
    and p.purchase_date<=v_end_time;$old$,
    $new$select coalesce(sum(tm.quantity_liters),0) into v_tank_purchases
  from public.tank_movements tm
  join public.purchases p on p.id=tm.reference_id
  where tm.tank_id=v_old_nozzle.tank_id
    and tm.movement_type='purchase'
    and p.shift_id=v_shift.id
    and tm.created_at>=v_shift.start_time
    and tm.created_at<=v_end_time;$new$);

  v_def:=replace(v_def,
    $old$v_tank_variance:=(v_opening_tank+v_tank_purchases-v_h.closing_liters)-v_tank_sales;$old$,
    $new$v_tank_variance:=v_h.closing_liters-(v_opening_tank+v_tank_purchases-v_tank_sales);$new$);

  v_def:=replace(v_def,
    $old$update shifts
  set status='completed',end_time=v_end_time,closing_reading=v_h.closing_reading,closing_mm=v_h.closing_mm,closing_liters=v_h.closing_liters
  where id=v_shift.id;$old$,
    $new$insert into public.tank_movements(tank_id,movement_type,quantity_liters,reference_id,notes,created_by)
  values(v_old_nozzle.tank_id,'sale',v_total_sales_liters,v_h.id,'Shift handover meter reconciliation sale',p_to_employee_id);

  update shifts
  set status='completed',end_time=v_end_time,closing_reading=v_h.closing_reading,closing_mm=v_h.closing_mm,closing_liters=v_h.closing_liters
  where id=v_shift.id;$new$);

  v_def:=replace(v_def,
    $old$  if v_old_nozzle.tank_id is not null then
    update tanks set current_liters=v_h.closing_liters,updated_at=v_end_time where id=v_old_nozzle.tank_id;
  end if;

  return jsonb_build_object($old$,
    $new$  return jsonb_build_object($new$);

  execute v_def;
end $do$;
