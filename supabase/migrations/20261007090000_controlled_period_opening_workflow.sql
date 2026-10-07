-- Controlled accounting period opening workflow.
-- Requires a verified physical opening for every active tank and a calibration version.
-- Does not modify tank current_liters or historical transactions.

create or replace function public.open_control_period(
  p_name text,
  p_starts_at timestamptz,
  p_openings jsonb,
  p_opened_by uuid default null,
  p_notes text default null
) returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  v_period public.accounting_periods%rowtype;
  v_tank record;
  v_item jsonb;
  v_count integer := 0;
  v_expected integer;
  v_tank_id uuid;
  v_liters numeric;
  v_height numeric;
  v_calibration text;
begin
  if nullif(trim(p_name),'') is null then raise exception 'Accounting period name is required'; end if;
  if p_starts_at is null then raise exception 'Accounting period start time is required'; end if;
  if p_openings is null or jsonb_typeof(p_openings) <> 'array' then
    raise exception 'Opening measurement for every active tank is required';
  end if;
  if exists(select 1 from public.accounting_periods where status='OPEN') then
    raise exception 'An accounting period is already open';
  end if;

  select count(*) into v_expected from public.tanks where active=true;
  if jsonb_array_length(p_openings) <> v_expected then
    raise exception 'Opening measurements must be provided for every active tank';
  end if;

  for v_item in select value from jsonb_array_elements(p_openings)
  loop
    begin
      v_tank_id := (v_item->>'tank_id')::uuid;
      v_liters := (v_item->>'physical_liters')::numeric;
      v_height := case when nullif(v_item->>'physical_height_mm','') is null then null else (v_item->>'physical_height_mm')::numeric end;
      v_calibration := nullif(trim(v_item->>'calibration_version'),'');
    exception when others then raise exception 'Invalid opening measurement payload'; end;
    if v_liters is null or v_liters < 0 then raise exception 'Opening liters must be zero or greater'; end if;
    if v_height is not null and v_height < 0 then raise exception 'Opening height cannot be negative'; end if;
    if v_calibration is null then raise exception 'Calibration version is required for every tank'; end if;
    select * into v_tank from public.tanks where id=v_tank_id and active=true;
    if not found then raise exception 'Opening references an inactive or unknown tank'; end if;
    if v_liters > v_tank.capacity_liters then raise exception 'Opening stock exceeds tank capacity for %',v_tank.tank_code; end if;
    v_count := v_count + 1;
  end loop;

  if v_count <> v_expected then raise exception 'Every active tank requires an opening measurement'; end if;

  insert into public.accounting_periods(name,status,starts_at,opened_by,notes)
  values(trim(p_name),'OPEN',p_starts_at,p_opened_by,p_notes)
  returning * into v_period;

  for v_item in select value from jsonb_array_elements(p_openings)
  loop
    insert into public.tank_opening_snapshots(
      accounting_period_id,tank_id,physical_liters,physical_height_mm,measured_at,
      recorded_by,calibration_version,reason,notes
    )
    values(
      v_period.id,(v_item->>'tank_id')::uuid,(v_item->>'physical_liters')::numeric,
      case when nullif(v_item->>'physical_height_mm','') is null then null else (v_item->>'physical_height_mm')::numeric end,
      coalesce(nullif(v_item->>'measured_at','')::timestamptz,now()),
      p_opened_by,nullif(trim(v_item->>'calibration_version'),''),
      'CONTROL_PERIOD_OPENING',nullif(v_item->>'notes','')
    );
  end loop;

  return jsonb_build_object('period',to_jsonb(v_period),'opening_count',v_count,'status','OPEN');
end;
$$;

revoke all on function public.open_control_period(text,timestamptz,jsonb,uuid,text) from public,anon,authenticated;
grant execute on function public.open_control_period(text,timestamptz,jsonb,uuid,text) to service_role;