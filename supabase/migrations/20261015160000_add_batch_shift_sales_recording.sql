-- Atomically record one attendant's sales across multiple shift takeovers.
-- Each shift still gets its own shift_takeover_sales rows, preserving DSR and admin review.
CREATE OR REPLACE FUNCTION public.record_shift_takeover_sales_batch(
  p_employee_id uuid,
  p_batch jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_item jsonb;
  v_takeover_id uuid;
  v_sales jsonb;
  v_result jsonb;
  v_results jsonb := '[]'::jsonb;
  v_seen uuid[] := ARRAY[]::uuid[];
  v_count integer := 0;
BEGIN
  IF p_batch IS NULL OR jsonb_typeof(p_batch) <> 'array' THEN
    RAISE EXCEPTION 'Batch must be a JSON array';
  END IF;

  IF jsonb_array_length(p_batch) < 1 OR jsonb_array_length(p_batch) > 20 THEN
    RAISE EXCEPTION 'Select between 1 and 20 shifts per submission';
  END IF;

  -- Validate the complete envelope before writing any shift rows.
  FOR v_item IN SELECT value FROM jsonb_array_elements(p_batch) LOOP
    IF jsonb_typeof(v_item) <> 'object'
       OR nullif(v_item->>'takeover_id','') IS NULL
       OR jsonb_typeof(coalesce(v_item->'sales','[]'::jsonb)) <> 'array' THEN
      RAISE EXCEPTION 'Each batch item must contain a takeover_id and sales array';
    END IF;
    v_takeover_id := (v_item->>'takeover_id')::uuid;
    IF v_takeover_id = ANY(v_seen) THEN
      RAISE EXCEPTION 'A shift was selected more than once';
    END IF;
    v_seen := array_append(v_seen, v_takeover_id);
  END LOOP;

  -- Any exception rolls back this entire RPC transaction, including earlier shifts.
  FOR v_item IN SELECT value FROM jsonb_array_elements(p_batch) LOOP
    v_takeover_id := (v_item->>'takeover_id')::uuid;
    v_sales := coalesce(v_item->'sales','[]'::jsonb);

    v_result := public.record_shift_takeover_sales(
      v_takeover_id,
      p_employee_id,
      v_sales
    );

    v_results := v_results || jsonb_build_array(v_result);
    v_count := v_count + 1;
  END LOOP;

  RETURN jsonb_build_object(
    'recorded', true,
    'batch_count', v_count,
    'results', v_results
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.record_shift_takeover_sales_batch(uuid, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_shift_takeover_sales_batch(uuid, jsonb) TO service_role;
