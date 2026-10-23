-- Correct handover stock reconciliation to use the live pre-handover balance,
-- and repair cached balances from the latest valid physical closing readings.
CREATE OR REPLACE FUNCTION public.record_shift_takeover_tank_movement()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_balance_before numeric;
  v_capacity numeric;
  v_recorded_sales numeric := 0;
  v_unrecorded_sales numeric := 0;
  v_expected_after_sales numeric;
  v_adjustment numeric;
  v_sale_exists boolean := false;
  v_adjustment_exists boolean := false;
BEGIN
  IF NEW.tank_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT COALESCE(t.current_liters, 0), t.capacity_liters
    INTO v_balance_before, v_capacity
  FROM public.tanks t
  WHERE t.id = NEW.tank_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Tank does not exist for shift takeover';
  END IF;

  IF NEW.tank_closing_liters IS NULL
     OR NEW.tank_closing_liters < 0
     OR NEW.tank_closing_liters > v_capacity THEN
    RAISE EXCEPTION 'Physical closing stock must be between 0 L and tank capacity (% L)', v_capacity;
  END IF;

  IF COALESCE(NEW.tank_sales_liters, 0) < 0 THEN
    RAISE EXCEPTION 'Tank sales liters cannot be negative';
  END IF;

  SELECT COALESCE(SUM(s.quantity_liters), 0)
    INTO v_recorded_sales
  FROM public.sales s
  JOIN public.nozzles n ON n.id = s.nozzle_id
  WHERE s.shift_id = NEW.shift_id
    AND n.tank_id = NEW.tank_id;

  v_unrecorded_sales := GREATEST(
    COALESCE(NEW.tank_sales_liters, 0) - v_recorded_sales,
    0
  );

  SELECT EXISTS (
    SELECT 1 FROM public.tank_movements tm
    WHERE tm.reference_id = NEW.id
      AND tm.movement_type = 'sale'
  ) OR (
    NEW.handover_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.tank_movements tm
      WHERE tm.reference_id = NEW.handover_id
        AND tm.movement_type = 'sale'
    )
  ) INTO v_sale_exists;

  IF v_unrecorded_sales > 0 AND NOT v_sale_exists THEN
    INSERT INTO public.tank_movements(
      tank_id, movement_type, quantity_liters, reference_id, notes, created_by, created_at
    )
    VALUES(
      NEW.tank_id, 'sale', v_unrecorded_sales, NEW.id,
      'Shift handover physical fuel sale not already recorded as a fuel sale.',
      NEW.to_employee_id, COALESCE(NEW.shift_ended_at, now())
    );
  END IF;

  -- Sales and purchases already reflected in the live balance must not be
  -- rebuilt from a stale shift opening value.
  v_expected_after_sales := v_balance_before - COALESCE(NEW.tank_sales_liters, 0);
  IF v_expected_after_sales < 0 THEN
    RAISE EXCEPTION 'Handover sales (% L) exceed the live tank balance (% L)',
      COALESCE(NEW.tank_sales_liters, 0), v_balance_before;
  END IF;

  -- Validate a signed reconciliation adjustment against the post-sale balance.
  UPDATE public.tanks
  SET current_liters = v_expected_after_sales,
      updated_at = COALESCE(NEW.shift_ended_at, now())
  WHERE id = NEW.tank_id;

  v_adjustment := NEW.tank_closing_liters - v_expected_after_sales;

  SELECT EXISTS (
    SELECT 1 FROM public.tank_movements tm
    WHERE tm.reference_id = NEW.id
      AND tm.movement_type = 'adjustment'
  ) INTO v_adjustment_exists;

  IF NOT v_adjustment_exists AND abs(v_adjustment) > 0.01 THEN
    INSERT INTO public.tank_movements(
      tank_id, movement_type, quantity_liters, reference_id, notes, created_by, created_at
    )
    VALUES(
      NEW.tank_id, 'adjustment', v_adjustment, NEW.id,
      'Shift handover physical reconciliation adjustment using live tank balance.',
      NEW.to_employee_id, COALESCE(NEW.shift_ended_at, now())
    );
  END IF;

  UPDATE public.tanks
  SET current_liters = NEW.tank_closing_liters,
      updated_at = COALESCE(NEW.shift_ended_at, now())
  WHERE id = NEW.tank_id;

  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.record_shift_takeover_tank_movement() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_shift_takeover_tank_movement() TO service_role;

-- Only apply this repair where no later tank movements supersede the physical reading.
WITH latest_closing AS (
  SELECT DISTINCT ON (st.tank_id)
         st.tank_id, st.tank_closing_liters, st.shift_ended_at
  FROM public.shift_takeovers st
  WHERE st.tank_closing_liters IS NOT NULL
    AND st.shift_ended_at IS NOT NULL
  ORDER BY st.tank_id, st.shift_ended_at DESC, st.created_at DESC
)
UPDATE public.tanks t
SET current_liters = lc.tank_closing_liters,
    updated_at = now()
FROM latest_closing lc
WHERE t.id = lc.tank_id
  AND t.active = true
  AND lc.tank_closing_liters >= 0
  AND lc.tank_closing_liters <= t.capacity_liters
  AND NOT EXISTS (
    SELECT 1 FROM public.tank_movements tm
    WHERE tm.tank_id = t.id
      AND tm.created_at > lc.shift_ended_at
  )
  AND t.current_liters IS DISTINCT FROM lc.tank_closing_liters;
