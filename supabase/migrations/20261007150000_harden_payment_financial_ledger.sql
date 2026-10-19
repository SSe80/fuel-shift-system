-- Separate authoritative financial/payment ledger from fuel-volume sales.
-- Compatibility zero-liter rows in public.sales are retained for existing UI/history.

create table if not exists public.payment_transactions (
  id uuid primary key default gen_random_uuid(),
  shift_id uuid not null,
  takeover_id uuid,
  takeover_sale_id uuid not null,
  employee_id uuid,
  sale_type_id uuid,
  amount numeric(14,2) not null check (amount >= 0),
  payment_method text not null default 'other',
  reason text,
  recorded_at timestamptz not null default now(),
  confirmed_at timestamptz not null default now(),
  confirmed_by uuid,
  created_at timestamptz not null default now(),
  constraint payment_transactions_takeover_sale_uq unique (takeover_sale_id)
);

alter table public.payment_transactions enable row level security;

create index if not exists idx_payment_transactions_shift on public.payment_transactions(shift_id);
create index if not exists idx_payment_transactions_takeover on public.payment_transactions(takeover_id);
create index if not exists idx_payment_transactions_recorded_at on public.payment_transactions(recorded_at);

revoke all on public.payment_transactions from public, anon, authenticated;
grant select, insert, update, delete on public.payment_transactions to service_role;

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
  v_inserted integer := 0;
  v_compat_inserted integer := 0;
  v_sale public.shift_takeover_sales%rowtype;
  v_type public.sale_types%rowtype;
begin
  select * into v_t
  from public.shift_takeovers
  where id = p_takeover_id and sales_status = 'pending_admin'
  for update;

  if not found then raise exception 'Pending sale confirmation not found'; end if;

  if not exists(
    select 1 from public.employees
    where id=p_admin_id and role='admin' and active=true
  ) then
    raise exception 'Admin account required';
  end if;

  select count(*) into v_count
  from public.shift_takeover_sales
  where takeover_id=v_t.id;

  select count(*) into v_checked
  from public.shift_takeover_sales
  where takeover_id=v_t.id
    and id::text in (
      select jsonb_array_elements_text(coalesce(p_checked_sale_ids,'[]'::jsonb))
    );

  if v_count=0 or v_checked<>v_count then
    raise exception 'Every sale must be checked before confirmation';
  end if;

  for v_sale in
    select s.*
    from public.shift_takeover_sales s
    where s.takeover_id=v_t.id
    order by s.created_at, s.id
  loop
    select * into v_type from public.sale_types where id=v_sale.sale_type_id;

    insert into public.payment_transactions(
      shift_id, takeover_id, takeover_sale_id, employee_id, sale_type_id,
      amount, payment_method, reason, recorded_at, confirmed_at, confirmed_by
    )
    values(
      v_t.shift_id, v_t.id, v_sale.id, v_t.from_employee_id, v_sale.sale_type_id,
      v_sale.amount, 'other', v_sale.reason,
      coalesce(v_t.sales_submitted_at, now()), now(), p_admin_id
    )
    on conflict (takeover_sale_id) do nothing;

    if found then
      v_inserted := v_inserted + 1;
    end if;

    -- Compatibility record for the existing UI/history. This remains zero-liter
    -- and must never be treated as fuel volume or a tank movement.
    insert into public.sales(
      shift_id, employee_id, nozzle_id, product, quantity_liters,
      unit_price, amount, payment_method, sale_type_id, sale_reason, sale_time
    )
    values(
      v_t.shift_id,
      v_t.from_employee_id,
      null,
      coalesce(v_type.name,'Shift takeover sale'),
      0,
      v_sale.amount,
      v_sale.amount,
      'other',
      v_sale.sale_type_id,
      v_sale.reason,
      coalesce(v_t.sales_submitted_at,now())
    );

    v_compat_inserted := v_compat_inserted + 1;
  end loop;

  update public.shift_takeovers
  set sales_status='confirmed',
      sales_confirmed_at=now(),
      sales_confirmed_by=p_admin_id
  where id=v_t.id;

  return jsonb_build_object(
    'confirmed',true,
    'takeover_id',v_t.id,
    'shift_id',v_t.shift_id,
    'payments_inserted',v_inserted,
    'compatibility_sales_inserted',v_compat_inserted,
    'confirmed_at',now()
  );
end;
$function$;

revoke all on function public.confirm_shift_takeover_sales(uuid,uuid,jsonb) from public, anon, authenticated;
grant execute on function public.confirm_shift_takeover_sales(uuid,uuid,jsonb) to service_role;

-- Backfill only already-confirmed takeover financial entries.
-- Original shift_takeover_sales and sales rows are preserved unchanged.
insert into public.payment_transactions(
  shift_id,takeover_id,takeover_sale_id,employee_id,sale_type_id,amount,
  payment_method,reason,recorded_at,confirmed_at,confirmed_by
)
select
  t.shift_id,t.id,s.id,t.from_employee_id,s.sale_type_id,s.amount,
  'other',s.reason,coalesce(t.sales_submitted_at,s.created_at),
  coalesce(t.sales_confirmed_at,now()),t.sales_confirmed_by
from public.shift_takeovers t
join public.shift_takeover_sales s on s.takeover_id=t.id
where t.sales_status='confirmed'
on conflict (takeover_sale_id) do nothing;
