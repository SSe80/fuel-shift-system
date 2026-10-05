-- Keep the persisted daily report purchase total aligned with the DSR's physical discharge ledger.
-- Purchase document quantity and purchase date are not used as the stock contribution.
create or replace function public.generate_daily_report(p_report_date date, p_generated_by uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_sales_l numeric;
  v_sales_a numeric;
  v_purchases_l numeric;
  v_shift_count integer;
  v_completed_count integer;
  v_unconfirmed_count integer;
  v_row public.daily_reports%rowtype;
begin
  select count(*), count(*) filter (where s.end_time is not null)
    into v_shift_count, v_completed_count
  from public.shifts s
  where (s.start_time at time zone 'Africa/Addis_Ababa')::date=p_report_date;

  if v_shift_count > 0 and v_completed_count <> v_shift_count then
    raise exception 'Daily report is not ready: all shifts that started on % must be completed first', p_report_date
      using errcode='55000';
  end if;

  select count(*) into v_unconfirmed_count
  from public.shift_takeovers t
  join public.shifts s on s.id=t.shift_id
  where (s.start_time at time zone 'Africa/Addis_Ababa')::date=p_report_date
    and coalesce(t.sales_status,'') <> 'confirmed';

  if v_unconfirmed_count > 0 then
    raise exception 'Daily report is not ready: sales confirmation is pending for one or more shifts'
      using errcode='55000';
  end if;

  select coalesce(sum(s.quantity_liters),0) into v_sales_l
  from public.sales s join public.shifts sh on sh.id=s.shift_id
  where (sh.start_time at time zone 'Africa/Addis_Ababa')::date=p_report_date
    and s.quantity_liters > 0
    and not exists (select 1 from public.shift_takeovers t where t.shift_id=s.shift_id);

  select v_sales_l + coalesce(sum(t.total_sales_liters),0) into v_sales_l
  from public.shift_takeovers t join public.shifts sh on sh.id=t.shift_id
  where (sh.start_time at time zone 'Africa/Addis_Ababa')::date=p_report_date
    and t.sales_status='confirmed';

  select coalesce(sum(s.amount),0) into v_sales_a
  from public.sales s join public.shifts sh on sh.id=s.shift_id
  where (sh.start_time at time zone 'Africa/Addis_Ababa')::date=p_report_date;

  -- Sum distinct physical discharge operations attributed to shifts belonging
  -- to this DSR. A single purchase may therefore contribute over several
  -- operations without ever counting the same operation twice.
  select coalesce(sum(x.discharged_liters),0) into v_purchases_l
  from (
    select distinct on (
      p.id,
      coalesce(nullif(op->>'operation_id',''),
        p.id::text || '|' || coalesce(op->>'discharge_datetime','') || '|' ||
        coalesce(op->>'tank_id','') || '|' || coalesce(op->>'discharged_quantity_liters',''))
    )
      coalesce(
        nullif(op->>'discharged_quantity_liters','')::numeric,
        (select coalesce(sum((v)::numeric),0)
         from jsonb_array_elements_text(coalesce(op->'compartment_liters','[]'::jsonb)) v)
      ) as discharged_liters
    from public.purchases p
    cross join lateral jsonb_array_elements(coalesce(p.discharge_history,'[]'::jsonb)) op
    where op->>'discharge_datetime' is not null
      and exists (
        select 1 from public.shifts sh
        where (sh.start_time at time zone 'Africa/Addis_Ababa')::date=p_report_date
          and sh.start_time <= (op->>'discharge_datetime')::timestamptz
          and (sh.end_time is null or (op->>'discharge_datetime')::timestamptz < sh.end_time)
      )
    order by
      p.id,
      coalesce(nullif(op->>'operation_id',''),
        p.id::text || '|' || coalesce(op->>'discharge_datetime','') || '|' ||
        coalesce(op->>'tank_id','') || '|' || coalesce(op->>'discharged_quantity_liters','')),
      (op->>'discharge_datetime')::timestamptz desc
  ) x;

  -- Legacy fallback only for purchases that have no discharge history.
  if v_purchases_l=0 then
    select coalesce(sum(p.discharged_quantity_liters),0) into v_purchases_l
    from public.purchases p
    where coalesce(jsonb_array_length(p.discharge_history),0)=0
      and p.discharged_at is not null
      and coalesce(p.discharged_quantity_liters,0)>0
      and exists (
        select 1 from public.shifts sh
        where (sh.start_time at time zone 'Africa/Addis_Ababa')::date=p_report_date
          and sh.start_time <= p.discharged_at
          and (sh.end_time is null or p.discharged_at < sh.end_time)
      );
  end if;

  insert into public.daily_reports(report_date,total_sales_liters,total_sales_amount,total_purchases_liters,generated_by)
  values(p_report_date,v_sales_l,v_sales_a,v_purchases_l,p_generated_by)
  on conflict (report_date) do update set
    total_sales_liters=excluded.total_sales_liters,
    total_sales_amount=excluded.total_sales_amount,
    total_purchases_liters=excluded.total_purchases_liters,
    generated_by=excluded.generated_by,
    updated_at=now()
  returning * into v_row;

  return to_jsonb(v_row);
end;
$function$;