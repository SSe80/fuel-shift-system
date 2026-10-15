-- Allow a shift whose entire dispensed quantity was returned to submit zero net sales.
-- The prior guard treated any positive gross liters as requiring a positive payment,
-- even when the calculated net amount was zero after returned-fuel deductions.
CREATE OR REPLACE FUNCTION public.record_shift_takeover_sales(
  p_takeover_id uuid,
  p_employee_id uuid,
  p_sales jsonb DEFAULT '[]'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_t public.shift_takeovers%rowtype;
  v_item jsonb;
  v_type public.sale_types%rowtype;
  v_total numeric := 0;
  v_count integer := 0;
  v_amount numeric;
  v_reason text;
  v_expected_net_amount numeric;
  v_allowed_difference numeric := 0;
BEGIN
  SELECT * INTO v_t
  FROM public.shift_takeovers
  WHERE id = p_takeover_id
    AND from_employee_id = p_employee_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Shift takeover not found or not owned by sender';
  END IF;

  IF v_t.sales_status = 'confirmed' OR v_t.sales_recorded_at IS NOT NULL THEN
    RETURN jsonb_build_object('recorded',true,'already_recorded',true,'takeover_id',v_t.id,'status','confirmed','recorded_at',v_t.sales_recorded_at);
  END IF;

  IF v_t.sales_status = 'pending_admin' THEN
    RETURN jsonb_build_object('recorded',true,'already_recorded',true,'takeover_id',v_t.id,'status','pending_admin','submitted_at',v_t.sales_submitted_at);
  END IF;

  IF v_t.sales_status IS NOT NULL AND v_t.sales_status <> 'awaiting_attendant' THEN
    RAISE EXCEPTION 'Shift takeover is not ready for attendant sale recording';
  END IF;

  IF jsonb_typeof(coalesce(p_sales,'[]'::jsonb)) <> 'array' THEN
    RAISE EXCEPTION 'Invalid sales entries';
  END IF;

  IF coalesce(v_t.returned_liters,0) < 0
     OR coalesce(v_t.returned_liters,0) > coalesce(v_t.total_sales_liters,0) THEN
    RAISE EXCEPTION 'Saved returned liters are outside the allowed shift liters range';
  END IF;

  v_expected_net_amount := greatest(0, round(
    coalesce(v_t.total_sales_amount,0) - coalesce(v_t.returned_amount,0), 2
  ));

  SELECT greatest(0, coalesce(sales_difference_tolerance,0)) INTO v_allowed_difference
  FROM public.station_settings WHERE id = true;
  v_allowed_difference := coalesce(v_allowed_difference,0);

  DELETE FROM public.shift_takeover_sales WHERE takeover_id = v_t.id;

  FOR v_item IN SELECT value FROM jsonb_array_elements(coalesce(p_sales,'[]'::jsonb)) LOOP
    v_amount := coalesce((v_item->>'amount')::numeric,0);
    IF v_amount < 0 THEN RAISE EXCEPTION 'Sale amount cannot be negative'; END IF;
    IF v_amount = 0 THEN CONTINUE; END IF;

    SELECT * INTO v_type
    FROM public.sale_types
    WHERE id = (v_item->>'sale_type_id')::uuid
      AND active = true;

    IF NOT FOUND THEN RAISE EXCEPTION 'Selected sale type is not active'; END IF;

    v_reason := nullif(trim(coalesce(v_item->>'reason','')),'');
    IF v_type.reason_required AND coalesce(v_reason,'')='' THEN
      RAISE EXCEPTION 'A reason is required for %', v_type.name;
    END IF;

    INSERT INTO public.shift_takeover_sales(takeover_id,sale_type_id,amount,reason,recorded_by)
    VALUES(v_t.id,v_type.id,v_amount,v_reason,p_employee_id);

    v_total := v_total + v_amount;
    v_count := v_count + 1;
  END LOOP;

  IF abs(v_total - v_expected_net_amount) > v_allowed_difference THEN
    DELETE FROM public.shift_takeover_sales WHERE takeover_id = v_t.id;
    RAISE EXCEPTION 'Entered sales total is outside the configured sales difference tolerance of ETB %. Entered %, net calculated % (gross %, return deduction %)',
      v_allowed_difference,round(v_total,2),v_expected_net_amount,round(coalesce(v_t.total_sales_amount,0),2),round(coalesce(v_t.returned_amount,0),2);
  END IF;

  -- Zero payment entries are valid when returned-fuel deductions leave no net
  -- sales value, even if fuel was dispensed earlier in the shift.
  IF v_total <= 0 AND v_expected_net_amount > 0 THEN
    DELETE FROM public.shift_takeover_sales WHERE takeover_id = v_t.id;
    RAISE EXCEPTION 'Enter at least one sale amount';
  END IF;

  UPDATE public.shift_takeovers
  SET sales_status = 'pending_admin',
      sales_submitted_at = now(),
      sales_cancelled_at = null,
      sales_confirmed_at = null,
      sales_confirmed_by = null,
      sales_recorded_at = null,
      sales_recorded_by = p_employee_id
  WHERE id = v_t.id;

  RETURN jsonb_build_object(
    'recorded',true,
    'already_recorded',false,
    'takeover_id',v_t.id,
    'status','pending_admin',
    'sales_count',v_count,
    'entered_total',v_total,
    'gross_calculated_amount',v_t.total_sales_amount,
    'returned_amount_deducted',coalesce(v_t.returned_amount,0),
    'calculated_amount',v_expected_net_amount,
    'submitted_at',now()
  );
END;
$function$;

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

    -- Do not report a mixed batch as successful if any selected shift was
    -- already submitted by a prior request. Raising here rolls back any
    -- earlier shifts written by this RPC, preserving all-or-nothing behavior.
    IF coalesce((v_result->>'already_recorded')::boolean, false) THEN
      RAISE EXCEPTION 'Shift % has already been submitted; refresh the dashboard and review the selected shifts', v_takeover_id;
    END IF;

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
