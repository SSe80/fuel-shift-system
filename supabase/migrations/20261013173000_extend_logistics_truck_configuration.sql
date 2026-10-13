alter table public.logistics_trucks
  add column if not exists trailer_plate text,
  add column if not exists compartment_count integer not null default 0 check (compartment_count >= 0);
create unique index if not exists logistics_trucks_legacy_local_id_uidx
  on public.logistics_trucks(legacy_local_id) where legacy_local_id is not null;
