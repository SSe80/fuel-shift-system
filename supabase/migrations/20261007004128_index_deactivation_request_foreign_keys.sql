create index if not exists idx_dispenser_deactivation_requests_nozzle_id
  on public.dispenser_deactivation_requests(nozzle_id);

create index if not exists idx_dispenser_deactivation_requests_confirmed_by
  on public.dispenser_deactivation_requests(confirmed_by);

create index if not exists idx_dispenser_deactivation_requests_requested_by
  on public.dispenser_deactivation_requests(requested_by);
