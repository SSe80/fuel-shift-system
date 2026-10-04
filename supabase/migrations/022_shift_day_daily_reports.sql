-- Daily sales reports are based on the local calendar day on which shifts START.
-- A report cannot be generated until every shift started that day is complete
-- and any associated shift-takeover sales have been confirmed.

create or replace function public.generate_daily_report(p_report_date date, p_generated_by uuid)
returns jsonb
language plpgsql
security definer
set search_path=public
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
  from public.sales s
  join public.shifts sh on sh.id=s.shift_id
  where (sh.start_time at time zone 'Africa/Addis_Ababa')::date=p_report_date
    and s.quantity_liters > 0
    and not exists (select 1 from public.shift_takeovers t where t.shift_id=s.shift_id);

  select v_sales_l + coalesce(sum(t.total_sales_liters),0) into v_sales_l
  from public.shift_takeovers t
  join public.shifts sh on sh.id=t.shift_id
  where (sh.start_time at time zone 'Africa/Addis_Ababa')::date=p_report_date
    and t.sales_status='confirmed';

  select coalesce(sum(s.amount),0) into v_sales_a
  from public.sales s
  join public.shifts sh on sh.id=s.shift_id
  where (sh.start_time at time zone 'Africa/Addis_Ababa')::date=p_report_date;

  select coalesce(sum(quantity_liters),0) into v_purchases_l
  from public.purchases
  where (purchase_date at time zone 'Africa/Addis_Ababa')::date=p_report_date;

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