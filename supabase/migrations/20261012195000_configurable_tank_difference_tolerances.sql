alter table public.station_settings
  add column if not exists shift_handover_tank_difference_tolerance numeric(12,2) not null default 10.00,
  add column if not exists purchase_discharge_tank_difference_tolerance numeric(12,2) not null default 10.00;

update public.station_settings
set shift_handover_tank_difference_tolerance = coalesce(shift_handover_tank_difference_tolerance, 10.00),
    purchase_discharge_tank_difference_tolerance = coalesce(purchase_discharge_tank_difference_tolerance, 10.00);

create or replace function public.enforce_shift_handover_tank_difference_tolerance()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tolerance numeric;
begin
  select coalesce(s.shift_handover_tank_difference_tolerance, 10.00)
    into v_tolerance
  from public.station_settings s
  where s.id = true;
  v_tolerance := coalesce(v_tolerance, 10.00);

  if abs(coalesce(new.tank_variance_liters, 0)) > v_tolerance then
    raise exception 'Shift handover tank difference is % L, exceeding the allowed tolerance of % L. Check the physical dip and tank ledger before retrying.',
      round(abs(new.tank_variance_liters), 2), round(v_tolerance, 2);
  end if;
  return new;
end;
$$;

drop trigger if exists trg_shift_handover_tank_difference_tolerance on public.shift_takeovers;
create trigger trg_shift_handover_tank_difference_tolerance
before insert or update of tank_variance_liters on public.shift_takeovers
for each row execute function public.enforce_shift_handover_tank_difference_tolerance();

create or replace function public.enforce_purchase_discharge_tank_difference_tolerance()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tolerance numeric;
  v_difference numeric;
begin
  if new.discharge_history is not distinct from old.discharge_history
     or jsonb_typeof(new.discharge_history) <> 'array'
     or jsonb_array_length(new.discharge_history) = 0 then
    return new;
  end if;

  select coalesce(s.purchase_discharge_tank_difference_tolerance, 10.00)
    into v_tolerance
  from public.station_settings s
  where s.id = true;
  v_tolerance := coalesce(v_tolerance, 10.00);

  v_difference := nullif(new.discharge_history -> (jsonb_array_length(new.discharge_history) - 1) ->> 'physical_vs_system_difference_liters', '')::numeric;
  if v_difference is not null and abs(v_difference) > v_tolerance then
    raise exception 'Purchase discharge tank difference is % L, exceeding the allowed tolerance of % L. Verify the physical dip and accounting stock before retrying.',
      round(abs(v_difference), 2), round(v_tolerance, 2);
  end if;
  return new;
end;
$$;

drop trigger if exists trg_purchase_discharge_tank_difference_tolerance on public.purchases;
create trigger trg_purchase_discharge_tank_difference_tolerance
before update of discharge_history on public.purchases
for each row execute function public.enforce_purchase_discharge_tank_difference_tolerance();
