-- Secure the custom-auth application boundary.
-- Browser requests go through the Cloudflare Worker, which uses the
-- Supabase service-role key. Do not expose these privileged purchase RPCs
-- directly to anon/authenticated clients.

revoke execute on function public.record_pending_fuel_purchase(
  text, numeric, uuid, text, uuid, numeric, text, text, text, integer, jsonb
) from anon, authenticated;

revoke execute on function public.discharge_fuel_purchase(
  uuid, uuid, uuid, integer[], numeric
) from anon, authenticated;

revoke all on table
  public.dispensers,
  public.dispenser_nozzles,
  public.shift_nozzle_readings,
  public.handover_nozzle_readings
from anon, authenticated;

alter table public.dispensers enable row level security;
alter table public.dispenser_nozzles enable row level security;
alter table public.shift_nozzle_readings enable row level security;
alter table public.handover_nozzle_readings enable row level security;
