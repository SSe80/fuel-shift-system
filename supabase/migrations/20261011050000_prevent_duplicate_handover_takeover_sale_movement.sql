-- Prevent duplicate tank sale movements for a handover/takeover pair.
-- confirm_shift_handover already writes a sale movement referencing the handover.
-- The takeover trigger must not write the same physical dispenser sale a second time.

do $migration$
declare
  v_def text;
  v_old text;
  v_new text;
begin
  v_def := pg_get_functiondef('public.record_shift_takeover_tank_movement()'::regprocedure);

  v_old := $old$  if v_unrecorded_sales>0 and not exists (
    select 1 from public.tank_movements tm
    where tm.reference_id=new.id
      and tm.movement_type='sale'
  ) then$old$;

  v_new := $new$  if v_unrecorded_sales>0
     and not exists (
       select 1 from public.tank_movements tm
       where tm.reference_id=new.id
         and tm.movement_type='sale'
     )
     and not exists (
       select 1 from public.tank_movements tm
       where tm.reference_id=new.handover_id
         and tm.movement_type='sale'
     ) then$new$;

  if position(v_old in v_def)=0 then
    raise exception 'Expected sale movement guard not found; refusing to modify trigger function';
  end if;

  v_def := replace(v_def, v_old, v_new);
  execute v_def;
end
$migration$;
