-- Fix shift handover reconciliation ordering.
-- The handover RPC must calculate nozzle liters before writing the authoritative
-- tank SALE movement. Historical data is untouched.

do $outer$
declare v_def text;
begin
  v_def:=pg_get_functiondef('public.confirm_shift_handover(uuid,uuid,numeric,numeric,numeric)'::regprocedure);

  v_def:=replace(v_def,
$old$  insert into public.tank_movements(tank_id,movement_type,quantity_liters,reference_id,notes,created_by)
  values(v_old_nozzle.tank_id,'sale',v_total_sales_liters,v_h.id,'Shift handover meter reconciliation sale',p_to_employee_id);

$old$,
'');

  v_def:=replace(v_def,
$old2$  v_tank_sales:=v_total_sales_liters;
  v_opening_tank:=coalesce(v_shift.opening_tank_liters,0);
$old2$,
$new2$  v_tank_sales:=v_total_sales_liters;
  v_opening_tank:=coalesce(v_shift.opening_tank_liters,0);

  if v_total_sales_liters <= 0 then
    raise exception 'Shift handover must contain positive nozzle sales liters';
  end if;

  insert into public.tank_movements(tank_id,movement_type,quantity_liters,reference_id,notes,created_by)
  values(v_old_nozzle.tank_id,'sale',v_total_sales_liters,v_h.id,'Shift handover meter reconciliation sale',p_to_employee_id);
$new2$);

  execute v_def;
end
$outer$;