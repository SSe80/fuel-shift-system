create table public.tank_closing_snapshots (
  id uuid primary key default gen_random_uuid(),
  accounting_period_id uuid not null references public.accounting_periods(id) on delete restrict,
  tank_id uuid not null references public.tanks(id) on delete restrict,
  physical_liters numeric not null check (physical_liters >= 0),
  physical_height_mm numeric check (physical_height_mm is null or physical_height_mm >= 0),
  measured_at timestamptz not null,
  recorded_by uuid,
  calibration_version text not null check (length(trim(calibration_version)) > 0),
  reason text not null default 'CONTROL_PERIOD_CLOSING' check (reason = 'CONTROL_PERIOD_CLOSING'),
  notes text,
  expected_closing_liters numeric not null,
  difference_liters numeric not null,
  variance_percent numeric,
  variance_status text not null check (variance_status in ('NORMAL','WARNING','CRITICAL')),
  created_at timestamptz not null default now(),
  unique (accounting_period_id,tank_id)
);

alter table public.tank_closing_snapshots enable row level security;
create index idx_tank_closing_snapshots_period on public.tank_closing_snapshots(accounting_period_id);
create index idx_tank_closing_snapshots_tank on public.tank_closing_snapshots(tank_id);
create index idx_tank_closing_snapshots_status on public.tank_closing_snapshots(variance_status);

create or replace function public.record_control_period_closing(
  p_accounting_period_id uuid,
  p_tank_id uuid,
  p_physical_liters numeric,
  p_physical_height_mm numeric default null,
  p_measured_at timestamptz default now(),
  p_recorded_by uuid default null,
  p_calibration_version text default null,
  p_notes text default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_period public.accounting_periods%rowtype;
  v_tank public.tanks%rowtype;
  v_opening numeric;
  v_expected numeric;
  v_difference numeric;
  v_variance numeric;
  v_status text;
  v_closing_id uuid;
  v_existing uuid;
  v_purchase numeric := 0;
  v_sale numeric := 0;
  v_transfer_in numeric := 0;
  v_transfer_out numeric := 0;
  v_adjustment numeric := 0;
  v_correction numeric := 0;
begin
  if p_accounting_period_id is null or p_tank_id is null then raise exception 'Accounting period and tank are required'; end if;
  if p_physical_liters is null or p_physical_liters < 0 then raise exception 'Physical closing liters must be zero or greater'; end if;
  if p_calibration_version is null or length(trim(p_calibration_version)) = 0 then raise exception 'Calibration version is required'; end if;

  select * into v_period from public.accounting_periods where id = p_accounting_period_id for update;
  if not found then raise exception 'Accounting period not found'; end if;
  if v_period.status <> 'OPEN' then raise exception 'Accounting period is not open'; end if;

  select * into v_tank from public.tanks where id = p_tank_id and active = true;
  if not found then raise exception 'Active tank not found'; end if;
  if p_physical_liters > v_tank.capacity_liters then raise exception 'Physical closing exceeds tank capacity'; end if;

  select id into v_existing from public.tank_closing_snapshots
  where accounting_period_id = p_accounting_period_id and tank_id = p_tank_id;
  if v_existing is not null then raise exception 'A verified physical closing already exists for this tank in this period'; end if;

  select physical_liters into v_opening from public.tank_opening_snapshots
  where accounting_period_id = p_accounting_period_id and tank_id = p_tank_id;
  if v_opening is null then raise exception 'Control-period opening snapshot is missing for this tank'; end if;

  select
    coalesce(sum(case when lower(movement_type) = 'purchase' then quantity_liters else 0 end),0),
    coalesce(sum(case when lower(movement_type) = 'sale' then quantity_liters else 0 end),0),
    coalesce(sum(case when lower(movement_type) = 'transfer_in' then quantity_liters else 0 end),0),
    coalesce(sum(case when lower(movement_type) = 'transfer_out' then quantity_liters else 0 end),0),
    coalesce(sum(case when lower(movement_type) = 'adjustment' then quantity_liters else 0 end),0),
    coalesce(sum(case when lower(movement_type) = 'correction' then quantity_liters else 0 end),0)
  into v_purchase,v_sale,v_transfer_in,v_transfer_out,v_adjustment,v_correction
  from public.tank_movements
  where tank_id = p_tank_id and created_at >= v_period.starts_at and created_at <= coalesce(v_period.ends_at, now());

  v_expected := v_opening + v_purchase - v_sale + v_transfer_in - v_transfer_out + v_adjustment + v_correction;
  if v_expected < 0 then raise exception 'Expected closing stock cannot be negative'; end if;

  v_difference := p_physical_liters - v_expected;
  if v_expected = 0 then
    v_variance := null;
    v_status := case when abs(v_difference) = 0 then 'NORMAL' else 'CRITICAL' end;
  else
    v_variance := abs(v_difference) / abs(v_expected) * 100;
    v_status := case when v_variance <= 0.20 then 'NORMAL' when v_variance <= 0.50 then 'WARNING' else 'CRITICAL' end;
  end if;

  insert into public.tank_closing_snapshots (
    accounting_period_id,tank_id,physical_liters,physical_height_mm,measured_at,
    recorded_by,calibration_version,notes,expected_closing_liters,difference_liters,
    variance_percent,variance_status
  ) values (
    p_accounting_period_id,p_tank_id,p_physical_liters,p_physical_height_mm,p_measured_at,
    p_recorded_by,trim(p_calibration_version),p_notes,v_expected,v_difference,v_variance,v_status
  ) returning id into v_closing_id;

  if v_status = 'CRITICAL' then
    insert into public.accounting_exceptions (
      accounting_period_id,tank_id,exception_type,classification,status,
      original_difference_liters,reason,created_by
    ) values (
      p_accounting_period_id,p_tank_id,'TANK_VARIANCE','EXCEPTION','OPEN',
      v_difference,'Critical controlled-period tank closing variance',p_recorded_by
    );
  end if;

  return jsonb_build_object(
    'closing_id',v_closing_id,'period_id',p_accounting_period_id,'tank_id',p_tank_id,
    'physical_closing_liters',p_physical_liters,'expected_closing_liters',v_expected,
    'difference_liters',v_difference,'variance_percent',v_variance,'variance_status',v_status
  );
end;
$$;

revoke all on function public.record_control_period_closing(uuid,uuid,numeric,numeric,timestamptz,uuid,text,text) from public, anon, authenticated;
grant execute on function public.record_control_period_closing(uuid,uuid,numeric,numeric,timestamptz,uuid,text,text) to service_role;