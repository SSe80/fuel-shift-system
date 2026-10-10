-- Google Drive export settings and queue for DSR and MSR PDFs.
-- NOT APPLIED: review, then apply with the normal migration process.

-- Single-row settings: the Drive folder IDs for DSR and MSR PDFs.
create table if not exists public.drive_settings (
  id smallint primary key default 1 check (id = 1),
  dsr_folder_id text,
  msr_folder_id text,
  updated_at timestamptz not null default now()
);

insert into public.drive_settings (id) values (1) on conflict (id) do nothing;

-- Queue of PDFs waiting to be generated in an admin browser and uploaded to Drive.
create table if not exists public.drive_export_queue (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('dsr', 'msr')),
  report_key text not null,            -- 'YYYY-MM-DD' for a DSR, 'YYYY-MM' for an MSR
  status text not null default 'pending' check (status in ('pending', 'done', 'failed')),
  attempts integer not null default 0,
  last_error text,
  drive_file_id text,
  drive_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (kind, report_key)
);

create index if not exists drive_export_queue_status_idx
  on public.drive_export_queue (status, kind, report_key);

-- Row-level security on, with no policies: only the Worker (service role) can read or write.
alter table public.drive_settings enable row level security;
alter table public.drive_export_queue enable row level security;
