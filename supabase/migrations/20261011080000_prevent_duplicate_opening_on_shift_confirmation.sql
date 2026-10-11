-- Shift confirmation must not reset stock or add a second opening movement
-- when assignment has already established the tank baseline.
CREATE OR REPLACE FUNCTION public.confirm_shift_activation(
  p_shift_id uuid,
  p_employee_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_shift public.shifts%rowtype;
  v_nozzle public.nozzles%rowtype;
  v_tank public.tanks%rowtype;
  v_item jsonb;
  v_opening numeric;
  v_first_opening numeric := NULL;
  v_count integer := 0;
  v_dispenser public.dispensers%rowtype;
  v_dn public.dispenser_nozzles%rowtype;
  v_controlled boolean;
  v_any_period boolean;
  v_has_movements boolean;
BEGIN
  SELECT * INTO v_shift
  FROM public.shifts
  WHERE id = p_shift_id
    AND employee_id = p_employee_id
    AND status = 'assigned'
  FOR UPDATE;

  IF NOT FOUND THEN RAISE EXCEPTION 'Pending shift assignment not found'; END IF;

  IF NOT EXISTS(
    SELECT 1 FROM public.employees
    WHERE id = p_employee_id AND role = 'attendant' AND active = true
  ) THEN
    RAISE EXCEPTION 'Active attendant not found';
  END IF;

  IF v_shift.activation_nozzles IS NULL
     OR jsonb_typeof(v_shift.activation_nozzles) <> 'array'
     OR jsonb_array_length(v_shift.activation_nozzles) = 0 THEN
    RAISE EXCEPTION 'Nozzle activation readings are missing';
  END IF;

  IF v_shift.opening_tank_liters IS NULL OR v_shift.opening_tank_liters < 0 THEN
    RAISE EXCEPTION 'Tank opening liters are missing';
  END IF;

  SELECT * INTO v_nozzle
  FROM public.nozzles
  WHERE id = v_shift.nozzle_id
  FOR UPDATE;

  IF NOT FOUND THEN RAISE EXCEPTION 'Dispenser not found'; END IF;
  IF v_nozzle.tank_id IS NULL THEN RAISE EXCEPTION 'Dispenser has no connected tank'; END IF;

  SELECT * INTO v_tank
  FROM public.tanks
  WHERE id = v_nozzle.tank_id
  FOR UPDATE;

  IF NOT FOUND OR NOT v_tank.active THEN
    RAISE EXCEPTION 'Connected tank is not active';
  END IF;

  IF v_shift.opening_tank_liters > v_tank.capacity_liters THEN
    RAISE EXCEPTION 'Tank opening liters cannot exceed tank capacity';
  END IF;

  SELECT * INTO v_dispenser
  FROM public.dispensers
  WHERE dispenser_code = v_nozzle.nozzle_code
  LIMIT 1
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Normalized dispenser not found for %', v_nozzle.nozzle_code;
  END IF;

  IF EXISTS(
    SELECT 1 FROM public.shifts
    WHERE nozzle_id = v_shift.nozzle_id
      AND status = 'active'
      AND id <> v_shift.id
  ) THEN
    RAISE EXCEPTION 'Dispenser already has an active shift';
  END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(v_shift.activation_nozzles) LOOP
    BEGIN
      v_opening := (v_item->>'opening_reading')::numeric;
    EXCEPTION WHEN OTHERS THEN
      RAISE EXCEPTION 'Invalid nozzle opening reading';
    END;

    IF COALESCE(v_opening, -1) < 0 THEN
      RAISE EXCEPTION 'Invalid nozzle opening reading';
    END IF;

    SELECT * INTO v_dn
    FROM public.dispenser_nozzles
    WHERE dispenser_id = v_dispenser.id
      AND nozzle_code = v_item->>'nozzle_id'
    LIMIT 1
    FOR UPDATE;

    IF NOT FOUND THEN RAISE EXCEPTION 'Invalid nozzle ID for this dispenser'; END IF;

    IF v_first_opening IS NULL THEN v_first_opening := v_opening; END IF;
    v_count := v_count + 1;

    INSERT INTO public.shift_nozzle_readings(
      shift_id, nozzle_id, opening_reading, opening_liters, opened_at
    )
    VALUES(v_shift.id, v_dn.id, v_opening, NULL, now())
    ON CONFLICT(shift_id, nozzle_id) DO UPDATE
      SET opening_reading = EXCLUDED.opening_reading,
          opened_at = EXCLUDED.opened_at;
  END LOOP;

  IF v_count = 0 OR v_first_opening IS NULL THEN
    RAISE EXCEPTION 'At least one nozzle must be activated';
  END IF;

  SELECT EXISTS(
    SELECT 1 FROM public.accounting_periods WHERE lower(status) = 'open'
  ) INTO v_controlled;

  SELECT EXISTS(SELECT 1 FROM public.accounting_periods) INTO v_any_period;

  IF NOT v_controlled THEN
    IF v_any_period THEN
      RAISE EXCEPTION 'No controlled accounting period is open; the shift cannot be confirmed until a period is opened';
    END IF;

    -- Assignment may already have created the opening movement. Only establish
    -- a baseline here as a fallback if the tank truly has no movement history.
    SELECT EXISTS(
      SELECT 1 FROM public.tank_movements WHERE tank_id = v_tank.id
    ) INTO v_has_movements;

    IF NOT v_has_movements THEN
      UPDATE public.tanks
      SET current_liters = v_shift.opening_tank_liters,
          opening_stock_liters = v_shift.opening_tank_liters,
          updated_at = now()
      WHERE id = v_tank.id;

      INSERT INTO public.tank_movements(
        tank_id, movement_type, quantity_liters, notes, created_by
      )
      VALUES(
        v_tank.id, 'opening', v_shift.opening_tank_liters,
        'Initial tank opening baseline recorded on shift confirmation',
        p_employee_id
      );
    END IF;
  END IF;

  UPDATE public.dispenser_nozzles
  SET active = true
  WHERE dispenser_id = v_dispenser.id
    AND id IN (
      SELECT r.nozzle_id FROM public.shift_nozzle_readings r WHERE r.shift_id = v_shift.id
    );

  UPDATE public.dispensers SET active = true WHERE id = v_dispenser.id;

  UPDATE public.nozzles
  SET active = true,
      activated_by = p_employee_id,
      activated_at = now(),
      opening_tank_liters = v_shift.opening_tank_liters
  WHERE id = v_nozzle.id;

  UPDATE public.shifts
  SET status = 'active',
      start_time = now(),
      opening_reading = v_first_opening
  WHERE id = v_shift.id;

  RETURN jsonb_build_object(
    'ok', true,
    'shift_id', v_shift.id,
    'nozzle_id', v_shift.nozzle_id,
    'opening_tank_liters', v_shift.opening_tank_liters,
    'opening_reading', v_first_opening,
    'activated_nozzles', v_shift.activation_nozzles,
    'opening_baseline_created', (NOT v_controlled AND NOT v_any_period AND NOT v_has_movements)
  );
END;
$function$;
