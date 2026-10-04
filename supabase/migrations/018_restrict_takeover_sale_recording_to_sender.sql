-- Restrict takeover sale recording to the sender attendant and ready state.
create or replace function public.record_shift_takeover_sales(
  p_takeover_id uuid,
  p_employee_id uuid,
  p_sales jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_t public.shift_takeovers%rowtype;
  v_item jsonb;
  v_type public.sale_types%rowtype;
  v_total numeric := 0;
  v_count integer := 0;
  v_amount numeric;
  v_reason text;
begin
  select * into v_t
  from public.shift_takeovers
  where id = p_takeover_id
    and from_employee_id = p_employee_id
  for update;

  if not found then
    raise exception 'Shift takeover not found or not owned by sender';
  end if;

  if v_t.sales_status = 'confirmed' or v_t.sales_recorded_at is not null then
    return jsonb_build_object('recorded',true,'already_recorded',true,'takeover_id',v_t.id,'status','confirmed','recorded_at',v_t.sales_recorded_at);
  end if;

  if v_t.sales_status = 'pending_admin' then
    return jsonb_build_object('recorded',true,'already_recorded',true,'takeover_id',v_t.id,'status','pending_admin','submitted_at',v_t.sales_submitted_at);
  end if;

  if v_t.sales_status is not null and v_t.sales_status <> 'awaiting_attendant' then
    raise exception 'Shift takeover is not ready for attendant sale recording';
  end if;

  if jsonb_typeof(coalesce(p_sales,'[]'::jsonb)) <> 'array' then
    raise exception 'Invalid sales entries';
  end if;

  delete from public.shift_takeover_sales where takeover_id = v_t.id;

  for v_item in select value from jsonb_array_elements(coalesce(p_sales,'[]'::jsonb)) loop
    v_amount := coalesce((v_item->>'amount')::numeric,0);
    if v_amount < 0 then raise exception 'Sale amount cannot be negative'; end if;
    if v_amount = 0 then continue; end if;

    select * into v_type
    from public.sale_types
    where id = (v_item->>'sale_type_id')::uuid
      and active = true;

    if not found then raise exception 'Selected sale type is not active'; end if;

    v_reason := nullif(trim(coalesce(v_item->>'reason','')),'');
    if v_type.reason_required and coalesce(v_reason,'')='' then
      raise exception 'A reason is required for %', v_type.name;
    end if;

    insert into public.shift_takeover_sales(takeover_id,sale_type_id,amount,reason,recorded_by)
    values(v_t.id,v_type.id,v_amount,v_reason,p_employee_id);

    v_total := v_total + v_amount;
    v_count := v_count + 1;
  end loop;

  if abs(v_total - coalesce(v_t.total_sales_amount,0)) > 1 then
    delete from public.shift_takeover_sales where takeover_id = v_t.id;
    raise exception 'Entered sales total must be within 1.00 of the calculated sales amount. Entered %, calculated %',
      round(v_total,2),round(coalesce(v_t.total_sales_amount,0),2);
  end if;

  if v_total <= 0 then
    delete from public.shift_takeover_sales where takeover_id = v_t.id;
    raise exception 'Enter at least one sale amount';
  end if;

  update public.shift_takeovers
  set sales_status = 'pending_admin',
      sales_submitted_at = now(),
      sales_cancelled_at = null,
      sales_confirmed_at = null,
      sales_confirmed_by = null,
      sales_recorded_at = null,
      sales_recorded_by = p_employee_id
  where id = v_t.id;

  return jsonb_build_object(
    'recorded',true,
    'already_recorded',false,
    'takeover_id',v_t.id,
    'status','pending_admin',
    'sales_count',v_count,
    'entered_total',v_total,
    'calculated_amount',v_t.total_sales_amount,
    'submitted_at',now()
  );
end;
$function$;

revoke execute on function public.record_shift_takeover_sales(uuid,uuid,jsonb) from public, anon, authenticated;
grant execute on function public.record_shift_takeover_sales(uuid,uuid,jsonb) to service_role;