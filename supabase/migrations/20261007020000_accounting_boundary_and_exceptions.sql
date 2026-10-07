-- Establish controlled accounting-period and historical exception infrastructure.
-- This migration does not alter existing tank movements, purchases, sales, or tank balances.

create table if not exists public.accounting_periods (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  status text not null default 'OPEN' check (status in ('OPEN','CLOSED')),
  starts_at timestamptz not null,
  ends_at timestamptz,
  opened_by uuid,
  closed_by uuid,
  notes text,
  created_at timestamptz not null default now(),
  closed_at timestamptz
);

create unique index if not exists uq_accounting_period_open
  on public.accounting_periods(status) where status='OPEN';

create table if not exists public.tank_opening_snapshots (
  id uuid primary key default gen_random_uuid(),
  accounting_period_id uuid not null references public.accounting_periods(id),
  tank_id uuid not null references public.tanks(id),
  physical_liters numeric(14,3) not null check (physical_liters >= 0),
  physical_height_mm numeric(14,3) check (physical_height_mm is null or physical_height_mm >= 0),
  measured_at timestamptz not null default now(),
  recorded_by uuid,
  calibration_version text,
  reason text not null default 'CONTROL_PERIOD_OPENING',
  notes text,
  created_at timestamptz not null default now(),
  unique(accounting_period_id,tank_id),
  check (reason='CONTROL_PERIOD_OPENING')
);

create table if not exists public.accounting_exceptions (
  id uuid primary key default gen_random_uuid(),
  accounting_period_id uuid references public.accounting_periods(id),
  tank_id uuid references public.tanks(id),
  purchase_id uuid references public.purchases(id),
  sale_id uuid references public.sales(id),
  movement_id uuid references public.tank_movements(id),
  exception_type text not null check (exception_type in (
    'HISTORICAL_DATA','DELIVERY_VARIANCE','TANK_VARIANCE','SALES_VARIANCE',
    'CONTRADICTORY_STATUS','MISSING_READING','DUPLICATE_MOVEMENT','OTHER'
  )),
  classification text not null default 'HISTORICAL' check (classification in ('VERIFIED','HISTORICAL','EXCEPTION','INVALID')),
  status text not null default 'OPEN' check (status in ('OPEN','UNDER_REVIEW','EXPLANATION','APPROVED','REJECTED','RESOLVED')),
  original_difference_liters numeric(14,3),
  original_difference_amount numeric(14,2),
  reason text,
  explanation text,
  created_by uuid,
  created_at timestamptz not null default now(),
  resolved_by uuid,
  resolved_at timestamptz
);

create table if not exists public.accounting_exception_approvals (
  id uuid primary key default gen_random_uuid(),
  exception_id uuid not null references public.accounting_exceptions(id) on delete cascade,
  decision text not null check (decision in ('APPROVED','REJECTED')),
  approver_id uuid,
  comment text,
  original_difference_liters numeric(14,3),
  original_difference_amount numeric(14,2),
  created_at timestamptz not null default now()
);

create index if not exists idx_tank_opening_snapshots_period on public.tank_opening_snapshots(accounting_period_id);
create index if not exists idx_tank_opening_snapshots_tank on public.tank_opening_snapshots(tank_id);
create index if not exists idx_accounting_exceptions_status on public.accounting_exceptions(status);
create index if not exists idx_accounting_exceptions_period on public.accounting_exceptions(accounting_period_id);
create index if not exists idx_accounting_exceptions_movement_id on public.accounting_exceptions(movement_id);
create index if not exists idx_accounting_exceptions_purchase_id on public.accounting_exceptions(purchase_id);
create index if not exists idx_accounting_exceptions_sale_id on public.accounting_exceptions(sale_id);
create index if not exists idx_accounting_exceptions_tank_id on public.accounting_exceptions(tank_id);
create index if not exists idx_accounting_exception_approvals_exception on public.accounting_exception_approvals(exception_id);

alter table public.accounting_periods enable row level security;
alter table public.tank_opening_snapshots enable row level security;
alter table public.accounting_exceptions enable row level security;
alter table public.accounting_exception_approvals enable row level security;

insert into public.accounting_exceptions
  (tank_id,movement_id,exception_type,classification,status,reason)
select tm.tank_id,tm.id,'HISTORICAL_DATA','HISTORICAL','OPEN',
       'Pre-control-period movement retained for history; not authoritative for the controlled accounting period.'
from public.tank_movements tm
where tm.notes ilike any(array['%Historical%','%Physical tank stock recorded%','%Shift handover physical%'])
and not exists (
  select 1 from public.accounting_exceptions ae where ae.movement_id=tm.id
);

insert into public.accounting_exceptions
  (purchase_id,exception_type,classification,status,reason)
select p.id,'CONTRADICTORY_STATUS','HISTORICAL','OPEN',
       'Historical purchase is marked discharged but has zero discharged quantity and no discharge timestamp; retained unchanged pending review.'
from public.purchases p
where p.status='discharged'
  and coalesce(p.discharged_quantity_liters,0)=0
  and p.discharged_at is null
  and not exists (
    select 1 from public.accounting_exceptions ae
    where ae.purchase_id=p.id and ae.exception_type='CONTRADICTORY_STATUS'
  );