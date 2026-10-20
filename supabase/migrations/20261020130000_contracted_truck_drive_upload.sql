-- Destination folder for registered contracted-truck calibration archives.
-- The connected administrator's Drive account must have write access to this folder.
ALTER TABLE public.drive_settings
  ADD COLUMN IF NOT EXISTS contracted_trucks_folder_id text;
