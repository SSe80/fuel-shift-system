-- Purchase flow hardening
-- Require the selected purchase tank to be active and match the selected product.
-- The actual discharge may still be split across multiple matching tanks.

CREATE OR REPLACE FUNCTION public.record_pending_fuel_purchase(
  p_product text,
  p_quantity_liters numeric,
  p_tank_id uuid,
  p_invoice_number text,
  p_created_by uuid,
  p_ordered_quantity_liters numeric DEFAULT NULL::numeric,
  p_driver_name text DEFAULT NULL::text,
  p_driver_phone text DEFAULT NULL::text,
  p_plate_number text DEFAULT NULL::text,
  p_truck_compartments integer DEFAULT NULL::integer,
  p_compartment_liters jsonb DEFAULT NULL::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare
  v_tank public.tanks%rowtype;
  v_purchase public.purchases%rowtype;
  v_product_id uuid;
  v_product_name text;
begin
  if p_quantity_liters <= 0 then
    raise exception 'Delivered quantity must be greater than zero';
  end if;

  select * into v_tank
  from public.tanks
  where id=p_tank_id and active=true
  for update;

  if not found then
    raise exception 'Selected tank is not active or does not exist';
  end if;

  v_product_id:=v_tank.product_id;
  if v_product_id is not null then
    select id,name into v_product_id,v_product_name
    from public.products where id=v_product_id and active=true;
    if not found then raise exception 'Tank product is not active or no longer exists'; end if;
  else
    select id,name into v_product_id,v_product_name
    from public.products
    where lower(trim(name))=lower(trim(v_tank.product)) and active=true
    limit 1;
    if not found then raise exception 'Tank product is not linked to an active product'; end if;
  end if;

  if nullif(trim(coalesce(p_product,'')),'') is not null
     and lower(trim(p_product))<>lower(trim(v_product_name)) then
    raise exception 'Product does not match selected tank';
  end if;

  insert into public.purchases(
    product,product_id,quantity_liters,invoice_number,tank_id,created_by,
    status,ordered_quantity_liters,driver_name,driver_phone,plate_number,
    truck_compartments,compartment_liters
  ) values (
    v_product_name,v_product_id,p_quantity_liters,nullif(trim(p_invoice_number),''),
    p_tank_id,p_created_by,'pending_discharge',p_ordered_quantity_liters,
    nullif(trim(p_driver_name),''),nullif(trim(p_driver_phone),''),
    nullif(trim(p_plate_number),''),p_truck_compartments,p_compartment_liters
  ) returning * into v_purchase;

  return jsonb_build_object('purchase',to_jsonb(v_purchase),'status','pending_discharge');
end;
$function$;