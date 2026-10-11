DO $migration$
DECLARE
  v_definition text;
  v_original text;
  v_target text := 'abs(v_submitted_amount - v_net_amount) > 1';
BEGIN
  v_definition := pg_get_functiondef('public.confirm_shift_takeover_sales_with_return_v2(uuid,uuid,jsonb,numeric)'::regprocedure);
  v_original := v_definition;

  IF (length(v_definition) - length(replace(v_definition, v_target, ''))) / length(v_target) <> 1 THEN
    RAISE EXCEPTION 'Expected exactly one hardcoded tolerance expression in confirmation result metadata; no changes applied';
  END IF;

  v_definition := replace(v_definition, v_target, 'abs(v_submitted_amount - v_net_amount) > v_sales_difference_tolerance');

  IF v_definition = v_original
     OR position('abs(v_submitted_amount - v_net_amount) > v_sales_difference_tolerance' IN v_definition) = 0 THEN
    RAISE EXCEPTION 'Could not update confirmation result metadata to use configured tolerance';
  END IF;

  EXECUTE v_definition;
END
$migration$;