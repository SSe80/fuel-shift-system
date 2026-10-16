-- In-progress DSRs remain visible in the Drive queue but must not start PDF export.
ALTER TABLE public.drive_export_queue
  DROP CONSTRAINT IF EXISTS drive_export_queue_status_check;

ALTER TABLE public.drive_export_queue
  ADD CONSTRAINT drive_export_queue_status_check
  CHECK (status = ANY (ARRAY['pending'::text, 'waiting'::text, 'done'::text, 'failed'::text]));
