-- Preserve every reviewed takeover-sale entry when admin confirms.

create or replace function public.confirm_shift_takeover_sales(
  p_takeover_id uuid,
  p_admin_id uuid,
  p_checked_sale_ids jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_t public.shift_takeovers%rowtype;
  v_count integer;
  v_checked integer;
  v_inserted integer:=0;
  v_sale public.shift_takeover_sales%rowtype;
  v_type public.sale_types%rowtype;
begin
  select * into v_t from public.shift_takeovers where id=p_takeover_id and sales_status='pending_admin' for update;
  if not found then raise exception 'Pending sale confirmation not found'; end if;
  if not exists(select 1 from public.employees where id=p_admin_id and role='admin' and active=true) then raise exception 'Admin account required'; end if;
  select count(*) into v_count from public.shift_takeover_sales where takeover_id=v_t.id;
  select count(*) into v_checked from public.shift_takeover_sales where takeover_id=v_t.id and id::text in (select jsonb_array_elements_text(coalesce(p_checked_sale_ids,'[]'::jsonb)));
  if v_count=0 or v_checked<>v_count then raise exception 'Every sale must be checked before confirmation'; end if;
  for v_sale in select s.* from public.shift_takeover_sales s where s.takeover_id=v_t.id order by s.created_at,s.id loop
    select * into v_type from public.sale_types where id=v_sale.sale_type_id;
    insert into public.sales(shift_id,employee_id,nozzle_id,product,quantity_liters,unit_price,amount,payment_method,sale_type_id,sale_reason,sale_time)
    values(v_t.shift_id,v_t.from_employee_id,null,coalesce(v_type.name,'Shift takeover sale'),0,v_sale.amount,v_sale.amount,'other',v_sale.sale_type_id,v_sale.reason,coalesce(v_t.sales_submitted_at,now()));
    v_inserted:=v_inserted+1;
  end loop;
  update public.shift_takeovers set sales_status='confirmed',sales_confirmed_at=now(),sales_confirmed_by=p_admin_id where id=v_t.id;
  return jsonb_build_object('confirmed',true,'takeover_id',v_t.id,'shift_id',v_t.shift_id,'sales_inserted',v_inserted,'confirmed_at',now());
end;
$function$;

revoke execute on function public.confirm_shift_takeover_sales(uuid,uuid,jsonb) from public, anon, authenticated;
grant execute on function public.confirm_shift_takeover_sales(uuid,uuid,jsonb) to service_role;
