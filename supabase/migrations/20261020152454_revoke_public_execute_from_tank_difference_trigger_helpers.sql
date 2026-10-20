-- These are trigger-only helpers. Callers do not need EXECUTE privileges
-- to fire their triggers, and they should not be exposed as RPC functions.
REVOKE EXECUTE ON FUNCTION public.enforce_purchase_discharge_tank_difference_tolerance() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.enforce_shift_handover_tank_difference_tolerance() FROM PUBLIC, anon, authenticated;

-- Keep the explicit server-side role grant used by trusted maintenance paths.
GRANT EXECUTE ON FUNCTION public.enforce_purchase_discharge_tank_difference_tolerance() TO service_role;
GRANT EXECUTE ON FUNCTION public.enforce_shift_handover_tank_difference_tolerance() TO service_role;
