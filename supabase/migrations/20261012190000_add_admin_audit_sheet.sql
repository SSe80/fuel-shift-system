-- Configure a separate Drive folder for the automatically created Admin Actions Audit Log.
alter table public.drive_settings
  add column if not exists admin_audit_folder_id text,
  add column if not exists admin_audit_sheet_id text;
