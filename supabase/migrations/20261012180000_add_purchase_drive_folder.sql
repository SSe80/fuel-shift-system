-- Add a separate Google Drive destination for purchase record PDFs.
alter table public.drive_settings
  add column if not exists purchase_folder_id text;
