-- New purchases must begin pending discharge.
-- Historical purchase rows are intentionally untouched.
alter table public.purchases
  alter column status set default 'pending_discharge';
