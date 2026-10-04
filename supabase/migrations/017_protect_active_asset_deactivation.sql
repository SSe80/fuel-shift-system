create or replace function public.prevent_active_asset_deactivation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_table_name = 'nozzles' and old.active is true and new.active is false then
    if exists (
      select 1 from public.shifts s
      where s.nozzle_id = old.id and s.status in ('assigned','active')
    ) then
      raise exception 'Cannot deactivate a dispenser with an assigned or active shift'
        using errcode = '23514';
    end if;
  elsif tg_table_name = 'tanks' and old.active is true and new.active is false then
    if exists (
      select 1 from public.nozzles n
      where n.tank_id = old.id and n.active is true
    ) or exists (
      select 1
      from public.shifts s
      join public.nozzles n on n.id = s.nozzle_id
      where n.tank_id = old.id and s.status in ('assigned','active')
    ) then
      raise exception 'Cannot deactivate a tank used by an active dispenser or assigned/active shift'
        using errcode = '23514';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists prevent_active_nozzle_deactivation on public.nozzles;
create trigger prevent_active_nozzle_deactivation
before update of active on public.nozzles
for each row execute function public.prevent_active_asset_deactivation();

drop trigger if exists prevent_active_tank_deactivation on public.tanks;
create trigger prevent_active_tank_deactivation
before update of active on public.tanks
for each row execute function public.prevent_active_asset_deactivation();

revoke all on function public.prevent_active_asset_deactivation() from public, anon, authenticated;
grant execute on function public.prevent_active_asset_deactivation() to service_role;
