create table if not exists public.station_inbox_notifications (
  id uuid primary key default gen_random_uuid(),
  notification_key text not null unique,
  level text not null check (level in ('critical','warning','info')),
  title text not null,
  detail text not null,
  href text not null,
  meta text,
  source_date timestamptz not null default now(),
  is_active boolean not null default true,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists station_inbox_notifications_active_date_idx
  on public.station_inbox_notifications (is_active, source_date desc);
create index if not exists station_inbox_notifications_level_idx
  on public.station_inbox_notifications (level, is_active);

create table if not exists public.station_inbox_notification_states (
  id uuid primary key default gen_random_uuid(),
  notification_id uuid not null references public.station_inbox_notifications(id) on delete cascade,
  employee_id uuid not null references public.employees(id) on delete cascade,
  read_at timestamptz,
  favorited_at timestamptz,
  updated_at timestamptz not null default now(),
  unique (notification_id, employee_id)
);

create index if not exists station_inbox_states_employee_idx
  on public.station_inbox_notification_states (employee_id, updated_at desc);

alter table public.station_inbox_notifications enable row level security;
alter table public.station_inbox_notification_states enable row level security;

revoke all on public.station_inbox_notifications from anon, authenticated;
revoke all on public.station_inbox_notification_states from anon, authenticated;
grant all on public.station_inbox_notifications to service_role;
grant all on public.station_inbox_notification_states to service_role;
