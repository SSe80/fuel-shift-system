-- Persistent logistics configuration and delivery history.
-- All access is routed through the authenticated application worker/service role.
create table if not exists public.logistics_trucks (
  id uuid primary key default gen_random_uuid(),
  truck_code text not null unique,
  registration_number text,
  driver_name text not null,
  driver_phone text,
  active boolean not null default true,
  notes text,
  legacy_local_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.logistics_truck_compartments (
  id uuid primary key default gen_random_uuid(),
  truck_id uuid not null references public.logistics_trucks(id) on delete cascade,
  compartment_number integer not null check (compartment_number > 0),
  capacity_liters numeric(14,3) not null check (capacity_liters > 0),
  calibration_points jsonb not null default '[]'::jsonb,
  calibration_verified boolean not null default false,
  calibration_verified_at timestamptz,
  calibration_verified_by text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (truck_id, compartment_number)
);

create table if not exists public.logistics_product_fees (
  id uuid primary key default gen_random_uuid(),
  product_id uuid references public.products(id) on delete set null,
  product_name text not null unique,
  fee_per_liter numeric(14,4) not null default 0 check (fee_per_liter >= 0),
  currency text not null default 'ETB',
  active boolean not null default true,
  updated_at timestamptz not null default now()
);

create table if not exists public.logistics_deliveries (
  id uuid primary key default gen_random_uuid(),
  delivery_reference text unique,
  delivery_date timestamptz not null default now(),
  truck_id uuid references public.logistics_trucks(id) on delete set null,
  truck_code_snapshot text,
  registration_snapshot text,
  driver_name_snapshot text,
  supplier_name text,
  product_id uuid references public.products(id) on delete set null,
  product_name text not null,
  ordered_liters numeric(14,3) check (ordered_liters is null or ordered_liters >= 0),
  delivered_liters numeric(14,3) not null default 0 check (delivered_liters >= 0),
  fee_per_liter numeric(14,4) not null default 0 check (fee_per_liter >= 0),
  total_fee numeric(14,2) generated always as (round(delivered_liters * fee_per_liter, 2)) stored,
  status text not null default 'draft' check (status in ('draft','in_progress','completed','cancelled')),
  tank_id uuid references public.tanks(id) on delete set null,
  tank_opening_liters numeric(14,3) check (tank_opening_liters is null or tank_opening_liters >= 0),
  tank_closing_liters numeric(14,3) check (tank_closing_liters is null or tank_closing_liters >= 0),
  tank_difference_liters numeric(14,3),
  notes text,
  created_by uuid references public.employees(id) on delete set null,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.logistics_delivery_compartments (
  id uuid primary key default gen_random_uuid(),
  delivery_id uuid not null references public.logistics_deliveries(id) on delete cascade,
  truck_compartment_id uuid references public.logistics_truck_compartments(id) on delete set null,
  compartment_number integer not null check (compartment_number > 0),
  capacity_liters numeric(14,3) check (capacity_liters is null or capacity_liters > 0),
  delivered_liters numeric(14,3) not null default 0 check (delivered_liters >= 0),
  dip_before_mm numeric(14,3),
  dip_after_mm numeric(14,3),
  calculated_liters numeric(14,3),
  notes text,
  created_at timestamptz not null default now(),
  unique (delivery_id, compartment_number)
);

create index if not exists logistics_truck_compartments_truck_idx
  on public.logistics_truck_compartments(truck_id);
create index if not exists logistics_deliveries_date_idx
  on public.logistics_deliveries(delivery_date desc);
create index if not exists logistics_deliveries_status_idx
  on public.logistics_deliveries(status);
create index if not exists logistics_deliveries_truck_idx
  on public.logistics_deliveries(truck_id);
create index if not exists logistics_delivery_compartments_delivery_idx
  on public.logistics_delivery_compartments(delivery_id);
create index if not exists logistics_product_fees_product_idx
  on public.logistics_product_fees(product_id);

do $$
declare
  tbl text;
begin
  foreach tbl in array array[
    'logistics_trucks',
    'logistics_truck_compartments',
    'logistics_product_fees',
    'logistics_deliveries',
    'logistics_delivery_compartments'
  ]
  loop
    execute format('alter table public.%I enable row level security', tbl);
    execute format('revoke all on table public.%I from anon, authenticated', tbl);
    execute format('grant all on table public.%I to service_role', tbl);
  end loop;
end $$;
