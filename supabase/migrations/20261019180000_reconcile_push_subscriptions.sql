-- Keep the live push subscription schema reproducible for fresh environments.
create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  user_agent text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists push_subscriptions_employee_id_idx
  on public.push_subscriptions(employee_id);

alter table public.push_subscriptions enable row level security;

-- Subscriptions contain device endpoints and authentication material.
-- Only the trusted server-side service role may access them.
revoke all on table public.push_subscriptions from anon, authenticated;
grant select, insert, update, delete on table public.push_subscriptions to service_role;
