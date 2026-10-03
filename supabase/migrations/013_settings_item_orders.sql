alter table if exists public.station_settings
  add column if not exists item_orders jsonb not null default '{}'::jsonb;

update public.station_settings
set item_orders = coalesce(item_orders, '{}'::jsonb),
    updated_at = now()
where id = true;

grant select, update on table public.station_settings to service_role;
