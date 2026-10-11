DO $migration$
DECLARE
  v_definition text;
  v_original text;
BEGIN
  v_definition := pg_get_functiondef('public.confirm_shift_takeover_sales_with_return_v2(uuid,uuid,jsonb,numeric)'::regprocedure);
  v_original := v_definition;

  IF position('v_submitted_amount numeric := 0;' IN v_definition) = 0
     OR position('IF abs(v_submitted_amount - v_net_amount) > 1 THEN' IN v_definition) = 0
     OR position('abs(v_submitted_amount - COALESCE(v_t.total_sales_amount, 0)) <= 1' IN v_definition) = 0 THEN
    RAISE EXCEPTION 'Could not locate expected sales-tolerance checks in confirmation function; no changes applied';
  END IF;

  v_definition := replace(
    v_definition,
    'v_submitted_amount numeric := 0;',
    'v_submitted_amount numeric := 0;
  v_sales_difference_tolerance numeric := 1.00;'
  );

  v_definition := replace(
    v_definition,
    '  IF abs(v_submitted_amount - v_net_amount) > 1 THEN',
    '  SELECT coalesce(sales_difference_tolerance,1.00) INTO v_sales_difference_tolerance FROM public.station_settings WHERE id=true LIMIT 1;
  v_sales_difference_tolerance := greatest(0,coalesce(v_sales_difference_tolerance,1.00));

  IF abs(v_submitted_amount - v_net_amount) > v_sales_difference_tolerance THEN'
  );

  v_definition := replace(
    v_definition,
    'abs(v_submitted_amount - COALESCE(v_t.total_sales_amount, 0)) <= 1',
    'abs(v_submitted_amount - COALESCE(v_t.total_sales_amount, 0)) <= v_sales_difference_tolerance'
  );

  v_definition := replace(
    v_definition,
    'within ETB 1.00. Returned fuel value:',
    'within configured ETB tolerance. Returned fuel value:'
  );

  IF v_definition = v_original
     OR position('> v_sales_difference_tolerance THEN' IN v_definition) = 0
     OR position('<= v_sales_difference_tolerance' IN v_definition) = 0 THEN
    RAISE EXCEPTION 'Sales tolerance function rewrite verification failed; no changes applied';
  END IF;

  EXECUTE v_definition;
END
$migration$;