-- Make attendant Record Sale validation use the same configurable ETB tolerance shown in the review card.
-- This prevents the UI from allowing a configured difference while the RPC rejects it at a hard-coded ETB 0.01.
DO $migration$
DECLARE
  v_definition text;
  v_original text;
BEGIN
  v_definition := pg_get_functiondef('public.record_shift_takeover_sales(uuid,uuid,jsonb)'::regprocedure);
  v_original := v_definition;
  IF position('v_allowed_difference numeric' IN v_definition) = 0 THEN
    v_definition := replace(v_definition, '  v_expected_net_amount numeric;',
      '  v_expected_net_amount numeric;' || chr(10) || '  v_allowed_difference numeric := 0;');
  END IF;
  IF position('v_allowed_difference := coalesce' IN v_definition) = 0 THEN
    v_definition := regexp_replace(v_definition,
      '  DELETE FROM public.shift_takeover_sales WHERE takeover_id = v_t.id;',
      '  SELECT greatest(0, coalesce(sales_difference_tolerance,0)) INTO v_allowed_difference' || chr(10) ||
      '  FROM public.station_settings WHERE id = true;' || chr(10) ||
      '  v_allowed_difference := coalesce(v_allowed_difference,0);' || chr(10) || chr(10) ||
      '  DELETE FROM public.shift_takeover_sales WHERE takeover_id = v_t.id;');
  END IF;
  v_definition := replace(v_definition,
    'IF abs(v_total - v_expected_net_amount) > 0.01 THEN',
    'IF abs(v_total - v_expected_net_amount) > v_allowed_difference THEN');
  v_definition := replace(v_definition,
    'Entered sales total must match net calculated sales after returned fuel within ETB 0.01. Entered %, net calculated % (gross %, return deduction %)',
    'Entered sales total is outside the configured sales difference tolerance of ETB %. Entered %, net calculated % (gross %, return deduction %)');
  v_definition := replace(v_definition,
    'round(v_total,2),v_expected_net_amount,round(coalesce(v_t.total_sales_amount,0),2),round(coalesce(v_t.returned_amount,0),2);',
    'v_allowed_difference,round(v_total,2),v_expected_net_amount,round(coalesce(v_t.total_sales_amount,0),2),round(coalesce(v_t.returned_amount,0),2);');
  IF v_definition = v_original
     OR position('v_allowed_difference numeric' IN v_definition) = 0
     OR position('> v_allowed_difference THEN' IN v_definition) = 0
     OR position('v_allowed_difference,round(v_total,2)' IN v_definition) = 0 THEN
    RAISE EXCEPTION 'Unable to safely update record_shift_takeover_sales tolerance validation';
  END IF;
  EXECUTE v_definition;
END
$migration$;
