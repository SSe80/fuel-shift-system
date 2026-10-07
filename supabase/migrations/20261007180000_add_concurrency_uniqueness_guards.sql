-- Concurrency guards for active/assigned shifts and pending workflows.
-- These indexes prevent race-condition duplicates even when two requests
-- pass application-level existence checks at the same time.

create unique index if not exists ux_shifts_one_active_assigned_per_employee
  on public.shifts(employee_id)
  where status in ('active','assigned');

create unique index if not exists ux_shifts_one_active_per_nozzle
  on public.shifts(nozzle_id)
  where status='active';

create unique index if not exists ux_handovers_one_pending_per_shift
  on public.handovers(shift_id)
  where status='pending';

create unique index if not exists ux_deactivation_one_pending_per_shift
  on public.dispenser_deactivation_requests(shift_id)
  where status='pending';

create unique index if not exists ux_deactivation_one_pending_per_nozzle
  on public.dispenser_deactivation_requests(nozzle_id)
  where status='pending';
