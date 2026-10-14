-- Keep shift assignment compatible with the app's tank-dip payload.
-- The value is optional metadata; confirmation must not depend on it.
ALTER TABLE public.shifts
  ADD COLUMN IF NOT EXISTS opening_tank_dip_mm numeric;

COMMENT ON COLUMN public.shifts.opening_tank_dip_mm IS
  'Optional tank dip reading in millimeters captured during dispenser assignment.';
