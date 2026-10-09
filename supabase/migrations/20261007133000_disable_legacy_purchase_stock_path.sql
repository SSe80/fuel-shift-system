-- Legacy purchase recorder could increase tank stock immediately.
-- New purchases must use record_pending_fuel_purchase and discharge actual fuel separately.
revoke all on function public.record_fuel_purchase(text,numeric,uuid,text,text,uuid) from public, anon, authenticated;
revoke all on function public.record_fuel_purchase(text,numeric,uuid,text,text,uuid,uuid) from public, anon, authenticated;
grant execute on function public.record_fuel_purchase(text,numeric,uuid,text,text,uuid) to service_role;
grant execute on function public.record_fuel_purchase(text,numeric,uuid,text,text,uuid,uuid) to service_role;
