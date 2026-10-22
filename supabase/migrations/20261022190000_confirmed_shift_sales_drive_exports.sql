-- Store each confirmed shift-handover sales PDF under Sales/YYYY/Month/DSR.
-- Apply this migration through the normal Supabase migration process.

alter table public.drive_settings
  add column if not exists sales_folder_id text;

-- Extend the persistent PDF export queue to include one export per confirmed
-- shift handover (report_key is YYYY-MM-DD|<shift_takeover_id>).
alter table public.drive_export_queue
  drop constraint if exists drive_export_queue_kind_check;

alter table public.drive_export_queue
  add constraint drive_export_queue_kind_check
  check (kind in ('dsr', 'msr', 'sale'));
