-- Disable obsolete takeover-sale function overloads.
-- The application uses record_shift_takeover_sales(uuid, uuid, jsonb).
revoke execute on function public.record_shift_takeover_sales(uuid,uuid,text) from public, anon, authenticated, service_role;
revoke execute on function public.record_shift_takeover_sales(uuid,uuid,text,uuid,text) from public, anon, authenticated, service_role;
