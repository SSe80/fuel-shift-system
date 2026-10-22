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

  -- Match the guarded sale block in the live function. Fail closed if it drifts.
  v_old := $old$  if v_total_sales_liters > 0 then
    insert into public.tank_movements(tank_id,movement_type,quantity_liters,reference_id,notes,created_by)
    values(v_old_nozzle.tank_id,'sale',v_total_sales_liters,v_h.id,'Shift handover meter reconciliation sale',p_to_employee_id);
  end if;

$old$;

  v_new := $new$  if v_total_sales_liters > 0 then
    insert into public.tank_movements(tank_id,movement_type,quantity_liters,reference_id,notes,created_by)
    values(v_old_nozzle.tank_id,'sale',v_total_sales_liters,v_h.id,'Shift handover meter reconciliation sale',p_to_employee_id);

    -- Deduct the meter-derived liters in the same transaction as the sale.
    -- Never overwrite accounting stock with the physical closing dip.
    update public.tanks
    set current_liters = coalesce(current_liters, 0) - v_total_sales_liters,
        updated_at = v_end_time
    where id = v_old_nozzle.tank_id;
  end if;

$new$;

  if position(v_old in v_def) = 0 then
    raise exception 'Expected guarded handover sale block not found; refusing to patch confirm_shift_handover';
  end if;

  v_def := replace(v_def, v_old, v_new);
  execute v_def;
end
$migration$;
