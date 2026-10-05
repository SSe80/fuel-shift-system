-- Daily report generation: shift readiness, confirmed sales, and uniquely counted
-- purchase discharge operations attributed to the shift containing the discharge time.

create or replace function public.generate_daily_report(p_report_date date, p_generated_by uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_sales_l numeric := 0;
  v_sales_a numeric := 0;
  v_purchase_l numeric := 0;
  v_shift_count integer := 0;
  v_completed_count integer := 0;
  v_handover_count integer := 0;
  v_confirmed_count integer := 0;
  v_row public.daily_reports%rowtype;
begin
  select count(*), count(*) filter (where end_time is not null)
    into v_shift_count,v_completed_count
  from public.shifts
  where (start_time at time zone 'Africa/Addis_Ababa')::date=p_report_date;

  if v_completed_count <> v_shift_count then
    raise exception 'Daily report is not ready: all shifts that started on % must be completed first',p_report_date using errcode='55000';
  end if;

  select count(*),count(*) filter (where sales_status='confirmed')
    into v_handover_count,v_confirmed_count
  from public.shift_takeovers t
  join public.shifts s on s.id=t.shift_id
  where (s.start_time at time zone 'Africa/Addis_Ababa')::date=p_report_date;

  if v_handover_count <> v_shift_count then
    raise exception 'Daily report is not ready: every completed shift must have a handover' using errcode='55000';
  end if;
  if v_confirmed_count <> v_shift_count then
    raise exception 'Daily report is not ready: every shift sale must be confirmed' using errcode='55000';
  end if;

  select coalesce(sum(total_sales_liters),0),coalesce(sum(total_sales_amount),0)
    into v_sales_l,v_sales_a
  from public.shift_takeovers t
  join public.shifts s on s.id=t.shift_id
  where (s.start_time at time zone 'Africa/Addis_Ababa')::date=p_report_date
    and t.sales_status='confirmed';

  with raw_ops as (
    select p.id purchase_id,
           op,
           coalesce(nullif(op->>'operation_id',''),
                    p.id::text||'|'||
                    coalesce(op->>'discharge_datetime','')||'|'||
                    coalesce(op->>'tank_id','')||'|'||
                    coalesce(op->>'discharged_quantity_liters','')) op_key,
           coalesce(
             nullif(op->>'discharged_quantity_liters','')::numeric,
             (select coalesce(sum(value::numeric),0)
              from jsonb_array_elements_text(coalesce(op->'compartment_liters','[]'::jsonb)))
           ) qty
    from public.purchases p
    cross join lateral jsonb_array_elements(coalesce(p.discharge_history,'[]'::jsonb)) op
  ),
  distinct_ops as (
    select distinct on (op_key) op_key,qty,op
    from raw_ops
    where nullif(op->>'discharge_datetime','') is not null
    order by op_key,(op->>'discharge_datetime')::timestamptz desc
  ),
  matched as (
    select d.qty
    from distinct_ops d
    where exists (
      select 1
      from public.shifts s
      where s.start_time <= (d.op->>'discharge_datetime')::timestamptz
        and (s.end_time is null or (d.op->>'discharge_datetime')::timestamptz < s.end_time)
        and (s.start_time at time zone 'Africa/Addis_Ababa')::date=p_report_date
    )
  )
  select coalesce(sum(qty),0) into v_purchase_l from matched;

  insert into public.daily_reports(report_date,total_sales_liters,total_sales_amount,total_purchases_liters,generated_by)
  values(p_report_date,v_sales_l,v_sales_a,v_purchase_l,p_generated_by)
  on conflict(report_date) do update set
    total_sales_liters=excluded.total_sales_liters,
    total_sales_amount=excluded.total_sales_amount,
    total_purchases_liters=excluded.total_purchases_liters,
    generated_by=excluded.generated_by,
    updated_at=now()
  returning * into v_row;

  return to_jsonb(v_row);
end;
$function$;

grant execute on function public.generate_daily_report(date, uuid) to service_role;
