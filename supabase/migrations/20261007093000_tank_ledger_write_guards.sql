-- Protect the tank ledger from invalid movement types, invalid quantities,
-- negative stock, and capacity overflow. Existing historical rows are untouched.

alter table public.tank_movements
  drop constraint if exists tank_movements_movement_type_check;

alter table public.tank_movements
  add constraint tank_movements_movement_type_check
  check (movement_type in ('opening','purchase','sale','transfer_in','transfer_out','adjustment','correction'));

alter table public.tank_movements
  drop constraint if exists tank_movements_quantity_check;

alter table public.tank_movements
  add constraint tank_movements_quantity_check
  check (
    (movement_type in ('opening','purchase','sale','transfer_in','transfer_out') and quantity_liters > 0)
    or
    (movement_type in ('adjustment','correction') and quantity_liters <> 0)
  );

create or replace function public.validate_new_tank_movement()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
declare
  v_current numeric;
  v_capacity numeric;
  v_result numeric;
begin
  if NEW.movement_type = 'opening' then
    return NEW;
  end if;

  select current_liters, capacity_liters
    into v_current, v_capacity
  from public.tanks
  where id = NEW.tank_id
  for update;

  if not found then
    raise exception 'Tank does not exist';
  end if;

  v_current := coalesce(v_current,0);

  if NEW.movement_type in ('purchase','transfer_in') then
    v_result := v_current + NEW.quantity_liters;
    if v_result > v_capacity then
      raise exception 'Tank capacity exceeded: resulting stock % L exceeds capacity % L', v_result, v_capacity;
    end if;
  elsif NEW.movement_type in ('sale','transfer_out') then
    v_result := v_current - NEW.quantity_liters;
    if v_result < 0 then
      raise exception 'Insufficient tank stock: sale/transfer would leave % L', v_result;
    end if;
  elsif NEW.movement_type in ('adjustment','correction') then
    v_result := v_current + NEW.quantity_liters;
    if v_result < 0 then
      raise exception 'Adjustment/correction would create negative tank stock: % L', v_result;
    end if;
    if v_result > v_capacity then
      raise exception 'Adjustment/correction would exceed tank capacity: % L > % L', v_result, v_capacity;
    end if;
  end if;

  return NEW;
end;
$$;

drop trigger if exists trg_validate_new_tank_movement on public.tank_movements;
create trigger trg_validate_new_tank_movement
before insert on public.tank_movements
for each row execute function public.validate_new_tank_movement();

revoke all on function public.validate_new_tank_movement() from public, anon, authenticated;
grant execute on function public.validate_new_tank_movement() to service_role;
