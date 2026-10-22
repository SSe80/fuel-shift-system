-- Fix live tank inventory after a confirmed shift handover.
-- The handover ledger records a positive SALE movement, but the hardened
-- handover workflow intentionally stopped copying the physical closing dip
-- into tanks.current_liters. Apply the meter-derived sale to the live balance
-- in the same transaction as the movement, without overwriting it with the
-- physical measurement.
do $migration$
declare
  v_def text;
  v_old text;
  v_new text;
begin
  v_def := pg_get_functiondef(
    'public.confirm_shift_handover(uuid,uuid,numeric,numeric,numeric)'::regprocedure
  );

  -- Match the current function's sale-movement block exactly. The blank line
  -- after the movement is intentional and makes this fail closed on drift.
  v_old := $old$  insert into public.tank_movements(tank_id,movement_type,quantity_liters,reference_id,notes,created_by)
  values(v_old_nozzle.tank_id,'sale',v_total_sales_liters,v_h.id,'Shift handover meter reconciliation sale',p_to_employee_id);

$old$;

  v_new := $new$  insert into public.tank_movements(tank_id,movement_type,quantity_liters,reference_id,notes,created_by)
  values(v_old_nozzle.tank_id,'sale',v_total_sales_liters,v_h.id,'Shift handover meter reconciliation sale',p_to_employee_id);

  -- Deduct the confirmed meter-derived liters from the operational balance.
  -- Do not replace accounting stock with the physical closing measurement.
  update public.tanks
  set current_liters = coalesce(current_liters, 0) - v_total_sales_liters,
      updated_at = v_end_time
  where id = v_old_nozzle.tank_id;

$new$;

  if position(v_old in v_def) = 0 then
    raise exception 'Expected handover sale movement block not found; refusing to patch confirm_shift_handover';
  end if;

  v_def := replace(v_def, v_old, v_new);
  execute v_def;
end
$migration$;
