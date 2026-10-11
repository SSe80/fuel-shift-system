-- Establish a tank opening baseline only once, on the first shift assignment.
-- Never reset a tank that already has movement history, and reject duplicate shift assignments.
CREATE OR REPLACE FUNCTION public.activate_dispenser(
  p_nozzle_id uuid,
  p_employee_id uuid,
  p_opening_tank_liters numeric,
  p_activated_nozzles jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_nozzle public.nozzles%rowtype;
  v_tank public.tanks%rowtype;
  v_item jsonb;
  v_opening numeric;
  v_code text;
  v_count integer := 0;
  v_shift_id uuid;
  v_first_opening numeric;
  v_controlled boolean;
  v_any_period boolean;
  v_has_movements boolean;
  v_dn_id uuid;
BEGIN
  IF p_opening_tank_liters IS NULL OR p_opening_tank_liters < 0 THEN
    RAISE EXCEPTION 'Invalid tank opening liters';
  END IF;

  SELECT EXISTS(
    SELECT 1 FROM public.accounting_periods WHERE lower(status) = 'open'
  ) INTO v_controlled;

  SELECT EXISTS(SELECT 1 FROM public.accounting_periods) INTO v_any_period;

  SELECT * INTO v_nozzle
  FROM public.nozzles
  WHERE id = p_nozzle_id
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

  IF NOT EXISTS(
    SELECT 1 FROM public.employees
    WHERE id = p_employee_id AND role = 'attendant' AND active = true
  ) THEN
    RAISE EXCEPTION 'Active attendant not found';
  END IF;

  -- Check before touching tank stock so retries cannot create extra opening movements.
  IF EXISTS(
    SELECT 1 FROM public.shifts
    WHERE nozzle_id = v_nozzle.id AND status IN ('assigned', 'active')
  ) THEN
    RAISE EXCEPTION 'This dispenser already has an assigned or active shift';
  END IF;

  IF p_activated_nozzles IS NULL
     OR jsonb_typeof(p_activated_nozzles) <> 'array'
     OR jsonb_array_length(p_activated_nozzles) = 0 THEN
    RAISE EXCEPTION 'At least one nozzle must be activated';
  END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_activated_nozzles) LOOP
    v_code := NULLIF(trim(v_item->>'nozzle_id'), '');
    BEGIN
      v_opening := (v_item->>'opening_reading')::numeric;
    EXCEPTION WHEN OTHERS THEN
      RAISE EXCEPTION 'Invalid nozzle opening reading';
    END;

    IF v_code IS NULL OR COALESCE(v_opening, -1) < 0 THEN
      RAISE EXCEPTION 'Invalid nozzle opening reading';
    END IF;

    IF NOT EXISTS(
      SELECT 1 FROM unnest(v_nozzle.nozzle_ids) x WHERE x = v_code
    ) THEN
      RAISE EXCEPTION 'Invalid nozzle ID for this dispenser';
    END IF;

    IF NOT EXISTS(
      SELECT 1
      FROM public.dispenser_nozzles dn
      JOIN public.dispensers d ON d.id = dn.dispenser_id
      WHERE dn.nozzle_code = v_code
        AND d.dispenser_code = v_nozzle.nozzle_code
    ) THEN
      RAISE EXCEPTION 'Physical nozzle % not found', v_code;
    END IF;

    IF v_first_opening IS NULL THEN v_first_opening := v_opening; END IF;
    v_count := v_count + 1;
  END LOOP;

  IF v_count = 0 THEN RAISE EXCEPTION 'At least one nozzle must be activated'; END IF;

  IF NOT v_controlled THEN
    IF v_any_period THEN
      RAISE EXCEPTION 'No controlled accounting period is open; open a period before assigning a shift';
    END IF;

    -- The first shift assigned to a tank establishes its baseline. Later shifts
    -- must not overwrite the live balance or insert another full-tank opening.
    SELECT EXISTS(
      SELECT 1 FROM public.tank_movements WHERE tank_id = v_tank.id
    ) INTO v_has_movements;

    IF NOT v_has_movements THEN
      UPDATE public.tanks
      SET current_liters = p_opening_tank_liters,
          opening_stock_liters = p_opening_tank_liters,
          updated_at = now()
      WHERE id = v_tank.id;

      INSERT INTO public.tank_movements(
        tank_id, movement_type, quantity_liters, notes, created_by
      )
      VALUES(
        v_tank.id, 'opening', p_opening_tank_liters,
        'Initial tank opening baseline recorded on first shift assignment',
        p_employee_id
      );
    END IF;
  END IF;

  UPDATE public.nozzles
  SET active = true,
      activated_by = p_employee_id,
      activated_at = now(),
      opening_tank_liters = p_opening_tank_liters
  WHERE id = v_nozzle.id;

  INSERT INTO public.shifts(
    employee_id, nozzle_id, opening_reading, status, assigned_by, assigned_at
  )
  VALUES(
    p_employee_id, v_nozzle.id, v_first_opening, 'assigned', p_employee_id, now()
  )
  RETURNING id INTO v_shift_id;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_activated_nozzles) LOOP
    v_code := trim(v_item->>'nozzle_id');
    v_opening := (v_item->>'opening_reading')::numeric;

    SELECT dn.id INTO v_dn_id
    FROM public.dispenser_nozzles dn
    JOIN public.dispensers d ON d.id = dn.dispenser_id
    WHERE dn.nozzle_code = v_code
      AND d.dispenser_code = v_nozzle.nozzle_code
    LIMIT 1;

    INSERT INTO public.shift_nozzle_readings(
      shift_id, nozzle_id, opening_reading, opened_at
    )
    VALUES(v_shift_id, v_dn_id, v_opening, now())
    ON CONFLICT (shift_id, nozzle_id) DO UPDATE
      SET opening_reading = EXCLUDED.opening_reading,
          opened_at = EXCLUDED.opened_at;
  END LOOP;

  RETURN jsonb_build_object(
    'ok', true,
    'tank_id', v_tank.id,
    'opening_tank_liters', p_opening_tank_liters,
    'activated_nozzles', p_activated_nozzles,
    'shift_id', v_shift_id,
    'controlled_period', v_controlled,
    'opening_baseline_created', (NOT v_controlled AND NOT v_has_movements)
  );
END;
$function$;
