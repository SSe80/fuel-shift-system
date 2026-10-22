-- Keep contracted and uncontracted truck deliveries clearly classified without mixing their records.
alter table public.logistics_deliveries
  add column if not exists truck_category text not null default 'contracted';

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'logistics_deliveries_truck_category_check'
      and conrelid = 'public.logistics_deliveries'::regclass
  ) then
    alter table public.logistics_deliveries
      add constraint logistics_deliveries_truck_category_check
      check (truck_category in ('contracted', 'uncontracted'));
  end if;
end $$;

create index if not exists logistics_deliveries_category_date_idx
  on public.logistics_deliveries (truck_category, delivery_date desc);

comment on column public.logistics_deliveries.truck_category is
  'Separates registered contracted-truck deliveries from ad-hoc uncontracted-truck deliveries.';
