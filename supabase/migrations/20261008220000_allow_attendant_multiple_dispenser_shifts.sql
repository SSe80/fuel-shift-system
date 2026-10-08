-- An attendant may operate more than one dispenser shift at the same time.
-- Dispenser exclusivity remains enforced by ux_shifts_one_active_per_nozzle.
drop index if exists public.ux_shifts_one_active_assigned_per_employee;
