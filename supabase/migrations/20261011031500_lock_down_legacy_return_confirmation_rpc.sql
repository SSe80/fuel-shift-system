-- Keep the legacy return-confirmation RPC private to the trusted worker.
-- The app now uses confirm_shift_takeover_sales_with_return_v2.
REVOKE EXECUTE ON FUNCTION public.confirm_shift_takeover_sales_with_return(uuid, uuid, jsonb, numeric) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.confirm_shift_takeover_sales_with_return(uuid, uuid, jsonb, numeric) TO service_role;
