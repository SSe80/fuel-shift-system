-- Restore the Google Drive export queue schema used by the Worker.
-- Safe to run repeatedly; preserves existing queue/settings rows.
create table if not exists public.drive_settings (
  id smallint primary key default 1 check (id = 1),
  dsr_folder_id text,
  msr_folder_id text,
  purchase_folder_id text,
  sales_folder_id text,
  admin_audit_folder_id text,
  admin_audit_sheet_id text,
  contracted_trucks_folder_id text,
  updated_at timestamptz not null default now()
);

alter table public.drive_settings
  add column if not exists purchase_folder_id text,
  add column if not exists sales_folder_id text,
  add column if not exists admin_audit_folder_id text,
  add column if not exists admin_audit_sheet_id text,
  add column if not exists contracted_trucks_folder_id text;

insert into public.drive_settings (id) values (1) on conflict (id) do nothing;

create table if not exists public.drive_export_queue (
  id uuid primary key default gen_random_uuid(),
  kind text not null,
  report_key text not null,
  status text not null default 'pending',
  attempts integer not null default 0,
  last_error text,
  drive_file_id text,
  drive_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (kind, report_key)
);

alter table public.drive_export_queue
  add column if not exists drive_file_id text,
  add column if not exists drive_url text,
  add column if not exists attempts integer not null default 0,
  add column if not exists last_error text,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

alter table public.drive_export_queue
  drop constraint if exists drive_export_queue_kind_check;
alter table public.drive_export_queue
  add constraint drive_export_queue_kind_check
  check (kind = any (array['dsr'::text, 'msr'::text, 'sale'::text));

alter table public.drive_export_queue
  drop constraint if exists drive_export_queue_status_check;
alter table public.drive_export_queue
  add constraint drive_export_queue_status_check
  check (status = any (array['pending'::text, 'waiting'::text, 'done'::text, 'failed'::text));

create index if not exists drive_export_queue_status_idx
  on public.drive_export_queue (status, kind, report_key);

alter table public.drive_settings enable row level security;
alter table public.drive_export_queue enable row level security;
