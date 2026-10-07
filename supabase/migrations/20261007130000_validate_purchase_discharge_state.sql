-- Prevent contradictory future purchase discharge states.
-- Historical rows are not modified.
create or replace function public.validate_purchase_discharge_state()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
declare
  v_expected numeric := 0;
  v_movement numeric := 0;
  v_idx integer;
  v_indexes integer[];
  v_compartments jsonb;
begin
  if new.status = 'discharged' and (tg_op = 'INSERT' or old.status is distinct from new.status) then
    if coalesce(new.discharged_quantity_liters,0) <= 0 then
      raise exception 'A purchase cannot be marked discharged without a positive discharged quantity';
    end if;

    v_compartments := coalesce(new.compartment_liters,'[]'::jsonb);
    v_indexes := coalesce(new.discharged_compartment_indexes,'{}'::integer[]);

    if jsonb_typeof(v_compartments) = 'array' and jsonb_array_length(v_compartments) > 0 then
      if cardinality(v_indexes) <> jsonb_array_length(v_compartments) then
        raise exception 'A fully discharged purchase must record every compartment';
      end if;
      foreach v_idx in array v_indexes loop
        if v_idx < 1 or v_idx > jsonb_array_length(v_compartments) then
          raise exception 'Discharged compartment index is invalid';
        end if;
        v_expected := v_expected + (v_compartments -> (v_idx-1))::text::numeric;
      end loop;
      if abs(v_expected - new.discharged_quantity_liters) > 0.001 then
        raise exception 'Discharged quantity does not match discharged compartments';
      end if;
    end if;

    select coalesce(sum(quantity_liters),0)
      into v_movement
      from public.tank_movements
     where reference_id = new.id
       and movement_type = 'purchase';

    if abs(v_movement - new.discharged_quantity_liters) > 0.001 then
      raise exception 'Purchase discharge quantity does not match tank ledger movements';
    end if;

    if new.discharged_at is null or new.discharged_by is null then
      raise exception 'A fully discharged purchase requires discharge timestamp and user';
    end if;
  end if;

  if tg_op = 'UPDATE' and old.status = 'discharged' and new.status is distinct from old.status then
    raise exception 'A discharged purchase is locked and cannot be reopened or changed to another status';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_validate_purchase_discharge_state on public.purchases;
create constraint trigger trg_validate_purchase_discharge_state
after insert or update of status, discharged_quantity_liters, discharged_compartment_indexes, discharged_at, discharged_by, compartment_liters
on public.purchases
deferrable initially deferred
for each row
execute function public.validate_purchase_discharge_state();

revoke all on function public.validate_purchase_discharge_state() from public, anon, authenticated;
grant execute on function public.validate_purchase_discharge_state() to service_role;
