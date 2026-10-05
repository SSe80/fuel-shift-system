-- Single daily confirmation is the only admin approval point for takeover sales.
-- Confirming a daily report also confirms every pending shift takeover sale
-- belonging to shifts that started on that local Addis Ababa date.

create or replace function public.confirm_daily_report_sales(
  p_report_date date,
  p_admin_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path=public
as $function$
declare
  v_shift_count integer;
  v_completed_count integer;
  v_takeover record;
  v_checked jsonb;
  v_confirmed_count integer := 0;
  v_report jsonb;
begin
  if not exists (
    select 1 from public.employees
    where id=p_admin_id and role='admin' and active=true
  ) then
    raise exception 'Admin account required';
  end if;

  select count(*), count(*) filter (where s.end_time is not null)
    into v_shift_count, v_completed_count
  from public.shifts s
  where (s.start_time at time zone 'Africa/Addis_Ababa')::date=p_report_date;

  if v_shift_count = 0 then
    raise exception 'No shifts started on this date';
  end if;

  if v_completed_count <> v_shift_count then
    raise exception 'Daily report is not ready: all shifts that started on this date must be completed first'
      using errcode='55000';
  end if;

  for v_takeover in
    select t.id
    from public.shift_takeovers t
    join public.shifts s on s.id=t.shift_id
    where (s.start_time at time zone 'Africa/Addis_Ababa')::date=p_report_date
      and coalesce(t.sales_status,'') <> 'confirmed'
    order by s.start_time, t.id
    for update of t
  loop
    select coalesce(jsonb_agg(st.id::text order by st.created_at, st.id), '[]'::jsonb)
      into v_checked
    from public.shift_takeover_sales st
    where st.takeover_id=v_takeover.id;

    if jsonb_array_length(v_checked)=0 then
      raise exception 'A shift has no recorded sales and cannot be confirmed';
    end if;

    perform public.confirm_shift_takeover_sales(
      v_takeover.id,
      p_admin_id,
      v_checked
    );

    v_confirmed_count := v_confirmed_count + 1;
  end loop;

  v_report := public.generate_daily_report(p_report_date, p_admin_id);

  return jsonb_build_object(
    'confirmed', true,
    'report_date', p_report_date,
    'shift_count', v_shift_count,
    'takeovers_confirmed', v_confirmed_count,
    'report', v_report
  );
end;
$function$;

revoke execute on function public.confirm_daily_report_sales(date,uuid) from public, anon, authenticated;
grant execute on function public.confirm_daily_report_sales(date,uuid) to service_role;
