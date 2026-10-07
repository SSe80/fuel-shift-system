create or replace function public.close_control_period(
 p_accounting_period_id uuid,
 p_closed_by uuid default null,
 p_notes text default null
) returns jsonb language plpgsql security definer set search_path=public as $$
declare v_period public.accounting_periods%rowtype; v_active int; v_openings int; v_closings int; v_open_exceptions int;
begin
 select * into v_period from public.accounting_periods where id=p_accounting_period_id for update;
 if not found then raise exception 'Accounting period not found'; end if;
 if v_period.status <> 'OPEN' then raise exception 'Accounting period is not open'; end if;
 select count(*) into v_active from public.tanks where active=true;
 select count(*) into v_openings from public.tank_opening_snapshots where accounting_period_id=p_accounting_period_id;
 select count(*) into v_closings from public.tank_closing_snapshots where accounting_period_id=p_accounting_period_id;
 if v_openings <> v_active then raise exception 'Cannot close period: verified opening is missing for one or more active tanks'; end if;
 if v_closings <> v_active then raise exception 'Cannot close period: verified physical closing is missing for one or more active tanks'; end if;
 select count(*) into v_open_exceptions from public.accounting_exceptions where accounting_period_id=p_accounting_period_id and status not in ('RESOLVED','REJECTED');
 if v_open_exceptions > 0 then raise exception 'Cannot close period: % accounting exception(s) remain unresolved',v_open_exceptions; end if;
 update public.accounting_periods set status='CLOSED',ends_at=coalesce(ends_at,now()),closed_by=p_closed_by,closed_at=now(),notes=coalesce(p_notes,notes) where id=p_accounting_period_id;
 return jsonb_build_object('period_id',p_accounting_period_id,'status','CLOSED','closed_at',now(),'active_tanks',v_active);
end; $$;
revoke all on function public.close_control_period(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.close_control_period(uuid,uuid,text) to service_role;