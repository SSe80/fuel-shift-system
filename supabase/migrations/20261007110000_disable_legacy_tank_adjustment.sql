-- Disable the legacy direct tank inventory adjustment path.
-- Historical adjustment movements are untouched.
create or replace function public.adjust_tank_inventory(p_tank_id uuid,p_new_liters numeric,p_new_mm numeric,p_created_by uuid,p_notes text)
returns jsonb language plpgsql security definer set search_path=public as $$
begin
  raise exception 'Direct tank inventory adjustment is disabled. Use an approved accounting exception/correction workflow.';
end; $$;

revoke all on function public.adjust_tank_inventory(uuid,numeric,numeric,uuid,text) from public, anon, authenticated;
grant execute on function public.adjust_tank_inventory(uuid,numeric,numeric,uuid,text) to service_role;