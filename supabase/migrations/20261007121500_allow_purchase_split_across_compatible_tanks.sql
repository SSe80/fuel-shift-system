-- Purchase deliveries may be discharged into multiple compatible tanks.
-- Validate product/tank compatibility, but do not require the movement tank
-- to equal the purchase header tank.
create or replace function public.validate_product_tank_nozzle_compatibility()
returns trigger language plpgsql security definer set search_path=public
as $$
declare
  v_tank public.tanks%rowtype;
  v_nozzle public.nozzles%rowtype;
  v_product text;
  v_ref_product text;
  v_ref_tank uuid;
begin
  if tg_table_name='purchases' then
    select * into v_tank from public.tanks where id=new.tank_id;
    if not found then raise exception 'Purchase tank not found'; end if;
    if new.product_id is not null and not exists (
      select 1 from public.products p
      where p.id=new.product_id and p.active=true
        and lower(trim(p.name))=lower(trim(v_tank.product))
    ) then raise exception 'Purchase product does not match tank product'; end if;
    if lower(trim(coalesce(new.product,'')))<>lower(trim(coalesce(v_tank.product,''))) then
      raise exception 'Purchase product does not match tank';
    end if;
  elsif tg_table_name='sales' then
    if coalesce(new.quantity_liters,0)=0 and new.nozzle_id is null then return new; end if;
    if new.quantity_liters>0 then
      if new.nozzle_id is null then raise exception 'Fuel sale requires a nozzle'; end if;
      select * into v_nozzle from public.nozzles where id=new.nozzle_id;
      if not found or not v_nozzle.active then raise exception 'Fuel sale nozzle is not active'; end if;
      if v_nozzle.tank_id is null then raise exception 'Fuel sale nozzle has no tank'; end if;
      select * into v_tank from public.tanks where id=v_nozzle.tank_id;
      if not found or not v_tank.active then raise exception 'Fuel sale tank is not active'; end if;
      if lower(trim(coalesce(new.product,'')))<>lower(trim(coalesce(v_nozzle.product,'')))
         or lower(trim(coalesce(new.product,'')))<>lower(trim(coalesce(v_tank.product,''))) then
        raise exception 'Fuel sale product does not match nozzle and tank';
      end if;
    end if;
  elsif tg_table_name='nozzles' then
    if new.tank_id is not null then
      select * into v_tank from public.tanks where id=new.tank_id;
      if not found then raise exception 'Nozzle tank not found'; end if;
      if lower(trim(coalesce(new.product,'')))<>lower(trim(coalesce(v_tank.product,''))) then
        raise exception 'Nozzle product does not match tank product';
      end if;
    end if;
  elsif tg_table_name='tank_movements' then
    if new.movement_type='purchase' and new.reference_id is not null then
      select p.product into v_ref_product from public.purchases p where p.id=new.reference_id;
      if v_ref_product is not null then
        select t.product into v_product from public.tanks t where t.id=new.tank_id;
        if lower(trim(coalesce(v_ref_product,'')))<>lower(trim(coalesce(v_product,''))) then
          raise exception 'Purchase movement product does not match tank';
        end if;
      end if;
    elsif new.movement_type='sale' and new.reference_id is not null then
      select s.product,n.tank_id into v_ref_product,v_ref_tank
      from public.sales s left join public.nozzles n on n.id=s.nozzle_id
      where s.id=new.reference_id;
      if v_ref_tank is not null then
        if v_ref_tank<>new.tank_id then raise exception 'Sale movement tank does not match sale'; end if;
        select t.product into v_product from public.tanks t where t.id=new.tank_id;
        if lower(trim(coalesce(v_ref_product,'')))<>lower(trim(coalesce(v_product,''))) then
          raise exception 'Sale movement product does not match tank';
        end if;
      end if;
    end if;
  end if;
  return new;
end $$;