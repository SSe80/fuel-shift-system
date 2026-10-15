-- Keep genuine zero-dispensed-fuel shift sales pending for Admin review.
-- Zero sales may be submitted only when the net calculated amount is zero;
-- the admin can confirm the empty record from the usual pending queue.

CREATE OR REPLACE FUNCTION public.record_shift_takeover_sales(p_takeover_id uuid, p_employee_id uuid, p_sales jsonb DEFAULT '[]'::jsonb)
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

  IF abs(v_total - v_expected_net_amount) > 0.01 THEN
    DELETE FROM public.shift_takeover_sales WHERE takeover_id = v_t.id;
    RAISE EXCEPTION 'Entered sales total must match net calculated sales after returned fuel within ETB 0.01. Entered %, net calculated % (gross %, return deduction %)',
      round(v_total,2),v_expected_net_amount,round(coalesce(v_t.total_sales_amount,0),2),round(coalesce(v_t.returned_amount,0),2);
  END IF;

  -- A genuine zero-dispensed-fuel shift must still enter the same admin
  -- confirmation queue as regular sales. Allow zero entries only when the
  -- calculated net sales amount is exactly zero.
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


-- Confirmation must allow a zero-entry record only for a zero-sales shift.
-- Preserve every reviewed takeover-sale entry when admin confirms.

create or replace function public.confirm_shift_takeover_sales(
  p_takeover_id uuid,
  p_admin_id uuid,
  p_checked_sale_ids jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_t public.shift_takeovers%rowtype;
  v_count integer;
  v_checked integer;
  v_inserted integer:=0;
  v_sale public.shift_takeover_sales%rowtype;
  v_type public.sale_types%rowtype;
begin
  select * into v_t from public.shift_takeovers where id=p_takeover_id and sales_status='pending_admin' for update;
  if not found then raise exception 'Pending sale confirmation not found'; end if;
  if not exists(select 1 from public.employees where id=p_admin_id and role='admin' and active=true) then raise exception 'Admin account required'; end if;
  select count(*) into v_count from public.shift_takeover_sales where takeover_id=v_t.id;
  select count(*) into v_checked from public.shift_takeover_sales where takeover_id=v_t.id and id::text in (select jsonb_array_elements_text(coalesce(p_checked_sale_ids,'[]'::jsonb)));
  -- Empty sale lists are valid only for a genuine zero-sales shift.
  if (v_count=0 and greatest(0,round(coalesce(v_t.total_sales_amount,0)-coalesce(v_t.returned_amount,0),2)) > 0)
     or (v_count>0 and v_checked<>v_count) then
    raise exception 'Every sale must be checked before confirmation';
  end if;
  for v_sale in select s.* from public.shift_takeover_sales s where s.takeover_id=v_t.id order by s.created_at,s.id loop
    select * into v_type from public.sale_types where id=v_sale.sale_type_id;
    insert into public.sales(shift_id,employee_id,nozzle_id,product,quantity_liters,unit_price,amount,payment_method,sale_type_id,sale_reason,sale_time)
    values(v_t.shift_id,v_t.from_employee_id,null,coalesce(v_type.name,'Shift takeover sale'),0,v_sale.amount,v_sale.amount,'other',v_sale.sale_type_id,v_sale.reason,coalesce(v_t.sales_submitted_at,now()));
    v_inserted:=v_inserted+1;
  end loop;
  update public.shift_takeovers set sales_status='confirmed',sales_confirmed_at=now(),sales_confirmed_by=p_admin_id where id=v_t.id;
  return jsonb_build_object('confirmed',true,'takeover_id',v_t.id,'shift_id',v_t.shift_id,'sales_inserted',v_inserted,'confirmed_at',now());
end;
$function$;

revoke execute on function public.confirm_shift_takeover_sales(uuid,uuid,jsonb) from public, anon, authenticated;
grant execute on function public.confirm_shift_takeover_sales(uuid,uuid,jsonb) to service_role;
