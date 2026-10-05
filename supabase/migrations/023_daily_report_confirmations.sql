-- Daily report second-level confirmation.
-- Once every shift started on a date has ended, the admin receives one
-- combined confirmation card for that date. Sale methods are aggregated
-- across all shift sale records before confirmation.

create table if not exists public.daily_report_confirmations (
  id uuid primary key default gen_random_uuid(),
  report_date date not null unique,
  total_sales_liters numeric not null default 0,
  total_sales_amount numeric not null default 0,
  sales_by_method jsonb not null default '{}'::jsonb,
  shift_count integer not null default 0,
  status text not null default 'pending' check (status = any (array['pending'::text,'confirmed'::text])),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  confirmed_at timestamptz,
  confirmed_by uuid references public.employees(id)
);

create index if not exists daily_report_confirmations_status_idx
  on public.daily_report_confirmations(status, report_date desc);

alter table public.daily_report_confirmations enable row level security;

drop policy if exists "daily_report_confirmations_admin_select" on public.daily_report_confirmations;
create policy "daily_report_confirmations_admin_select"
on public.daily_report_confirmations for select
using (
  exists (
    select 1 from public.employees e
    where e.id = auth.uid() and e.role = 'admin' and e.active = true
  )
);