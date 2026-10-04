-- Keep submitted/confirmed takeover sales visible even if their sale type is later deactivated or removed.
-- Pending records must remain reviewable by admins after configuration changes.

create or replace function public.list_pending_shift_takeover_sales()
returns jsonb
language sql
security definer
set search_path = public
as $function$
select coalesce(jsonb_agg(
  jsonb_build_object(
    'takeover',to_jsonb(t),
    'sales',coalesce((
      select jsonb_agg(jsonb_build_object(
        'id',sts.id,
        'sale_type_id',sts.sale_type_id,
        'sale_type_name',coalesce(st.name,'Removed sale type'),
        'sale_type_description',st.description,
        'reason',sts.reason,
        'amount',sts.amount,
        'recorded_by',sts.recorded_by,
        'created_at',sts.created_at
      ) order by sts.created_at)
      from public.shift_takeover_sales sts
      left join public.sale_types st on st.id=sts.sale_type_id
      where sts.takeover_id=t.id
    ),'[]'::jsonb),
    'from_employee',jsonb_build_object('id',fe.id,'name',fe.name),
    'to_employee',jsonb_build_object('id',te.id,'name',te.name),
    'shift',jsonb_build_object('id',s.id,'name',concat(fe.name,' → ',te.name),'started_at',t.shift_started_at,'ended_at',t.shift_ended_at),
    'dispenser',jsonb_build_object('id',n.id,'name',n.nozzle_code),
    'tank',jsonb_build_object('id',tk.id,'name',tk.tank_code)
  ) order by t.sales_submitted_at desc
),'[]'::jsonb)
from public.shift_takeovers t
left join public.employees fe on fe.id=t.from_employee_id
left join public.employees te on te.id=t.to_employee_id
left join public.shifts s on s.id=t.shift_id
left join public.nozzles n on n.id=s.nozzle_id
left join public.tanks tk on tk.id=t.tank_id
where t.sales_status='pending_admin';
$function$;

create or replace function public.list_confirmed_shift_takeover_sales()
returns jsonb
language sql
security definer
set search_path = public
as $function$
select coalesce(jsonb_agg(
  jsonb_build_object(
    'takeover',to_jsonb(t),
    'sales',coalesce((
      select jsonb_agg(jsonb_build_object(
        'id',sts.id,'sale_type_id',sts.sale_type_id,'sale_type_name',coalesce(st.name,'Removed sale type'),
        'sale_type_description',st.description,'reason',sts.reason,'amount',sts.amount,
        'recorded_by',sts.recorded_by,'created_at',sts.created_at
      ) order by sts.created_at)
      from public.shift_takeover_sales sts
      left join public.sale_types st on st.id=sts.sale_type_id
      where sts.takeover_id=t.id
    ),'[]'::jsonb),
    'from_employee',jsonb_build_object('id',fe.id,'name',fe.name),
    'to_employee',jsonb_build_object('id',te.id,'name',te.name),
    'shift',jsonb_build_object('id',s.id,'name',concat(fe.name,' → ',te.name),'started_at',t.shift_started_at,'ended_at',t.shift_ended_at),
    'dispenser',jsonb_build_object('id',n.id,'name',n.nozzle_code),
    'tank',jsonb_build_object('id',tk.id,'name',tk.tank_code)
  ) order by t.sales_confirmed_at desc
),'[]'::jsonb)
from public.shift_takeovers t
left join public.employees fe on fe.id=t.from_employee_id
left join public.employees te on te.id=t.to_employee_id
left join public.shifts s on s.id=t.shift_id
left join public.nozzles n on n.id=s.nozzle_id
left join public.tanks tk on tk.id=t.tank_id
where t.sales_status='confirmed';
$function$;
