-- Tank variance is advisory: never reject an operational handover or discharge
-- solely because a physical reading exceeds the configured tolerance.
drop trigger if exists trg_shift_handover_tank_difference_tolerance on public.shift_takeovers;
drop trigger if exists trg_purchase_discharge_tank_difference_tolerance on public.purchases;

create or replace function public.enforce_shift_handover_tank_difference_tolerance()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  return new;
end;
$$;

create or replace function public.enforce_purchase_discharge_tank_difference_tolerance()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  return new;
end;
$$;
