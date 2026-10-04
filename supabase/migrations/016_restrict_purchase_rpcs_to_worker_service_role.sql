revoke execute on function public.record_pending_fuel_purchase(
  text, numeric, uuid, text, uuid, numeric, text, text, text, integer, jsonb
) from public, anon, authenticated;
grant execute on function public.record_pending_fuel_purchase(
  text, numeric, uuid, text, uuid, numeric, text, text, text, integer, jsonb
) to service_role;

revoke execute on function public.discharge_fuel_purchase(
  uuid, uuid, uuid, integer[], numeric
) from public, anon, authenticated;
grant execute on function public.discharge_fuel_purchase(
  uuid, uuid, uuid, integer[], numeric
) to service_role;
