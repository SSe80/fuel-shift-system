create or replace function public.request_dispenser_deactivation(p_nozzle_id uuid,p_admin_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_shift public.shifts%rowtype;
  v_req public.dispenser_deactivation_requests%rowtype;
begin
  if not exists(select 1 from employees where id=p_admin_id and role='admin' and active=true) then
    raise exception 'Active admin not found';
  end if;

  select * into v_shift
  from shifts
  where nozzle_id=p_nozzle_id and status='active'
  order by start_time desc
  limit 1
  for update;

  if not found then
    raise exception 'Active shift not found for this dispenser';
  end if;

  select * into v_req
  from dispenser_deactivation_requests
  where shift_id=v_shift.id
  limit 1
  for update;

  if found then
    if v_req.status='pending' then
      raise exception 'A deactivation request is already pending for this shift';
    end if;

    update dispenser_deactivation_requests
    set nozzle_id=p_nozzle_id,
        requested_by=p_admin_id,
        attendant_id=v_shift.employee_id,
        status='pending',
        requested_at=now(),
        confirmed_at=null,
        confirmed_by=null
    where id=v_req.id
    returning * into v_req;
  else
    insert into dispenser_deactivation_requests(nozzle_id,shift_id,requested_by,attendant_id)
    values(p_nozzle_id,v_shift.id,p_admin_id,v_shift.employee_id)
    returning * into v_req;
  end if;

  return jsonb_build_object('request',to_jsonb(v_req),'shift',to_jsonb(v_shift));
end; $$;

revoke all on function public.request_dispenser_deactivation(uuid,uuid) from public,anon,authenticated;
grant execute on function public.request_dispenser_deactivation(uuid,uuid) to service_role;
