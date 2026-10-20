-- Logistics delivery eligibility, frozen charges, audited corrections and immutable payment ledger.
alter table public.logistics_deliveries
  alter column total_fee drop expression;
alter table public.logistics_deliveries
  alter column total_fee set default 0,
  alter column total_fee set not null;
alter table public.logistics_deliveries
  add column if not exists eligible_at timestamptz,
  add column if not exists transport_payment_status text not null default 'unpaid';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'logistics_deliveries_payment_status_check' and conrelid = 'public.logistics_deliveries'::regclass) then
    alter table public.logistics_deliveries add constraint logistics_deliveries_payment_status_check check (transport_payment_status in ('unpaid','paid'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'logistics_deliveries_completion_stock_check' and conrelid = 'public.logistics_deliveries'::regclass) then
    alter table public.logistics_deliveries add constraint logistics_deliveries_completion_stock_check check (
      status <> 'completed' or (
        eligible_at is not null and tank_id is not null
        and tank_opening_liters is not null and tank_closing_liters is not null
        and tank_difference_liters is not null and delivered_liters > 0
      )
    );
  end if;
end $$;

create table if not exists public.logistics_transport_transactions (
  id uuid primary key default gen_random_uuid(),
  transaction_type text not null check (transaction_type in ('payment','reversal')),
  original_transaction_id uuid references public.logistics_transport_transactions(id) on delete restrict,
  amount numeric(14,2) not null check (amount >= 0),
  reference text not null check (btrim(reference) <> ''),
  reason text,
  currency text not null default 'ETB' check (currency = 'ETB'),
  created_by uuid,
  created_at timestamptz not null default now(),
  constraint logistics_transport_transaction_link_check check (
    (transaction_type = 'payment' and original_transaction_id is null and reason is null)
    or (transaction_type = 'reversal' and original_transaction_id is not null and btrim(coalesce(reason,'')) <> '')
  )
);
create unique index if not exists logistics_transport_transactions_reference_idx on public.logistics_transport_transactions (lower(reference));
create index if not exists logistics_transport_transactions_created_idx on public.logistics_transport_transactions (created_at desc);
create index if not exists logistics_transport_transactions_original_idx on public.logistics_transport_transactions (original_transaction_id) where original_transaction_id is not null;

create table if not exists public.logistics_transport_payment_items (
  id uuid primary key default gen_random_uuid(),
  transaction_id uuid not null references public.logistics_transport_transactions(id) on delete restrict,
  delivery_id uuid not null references public.logistics_deliveries(id) on delete restrict,
  charge_snapshot numeric(14,2) not null check (charge_snapshot >= 0),
  created_at timestamptz not null default now(),
  unique (transaction_id, delivery_id)
);
create index if not exists logistics_transport_payment_items_delivery_idx on public.logistics_transport_payment_items (delivery_id, created_at desc);

create table if not exists public.logistics_delivery_audit (
  id uuid primary key default gen_random_uuid(),
  delivery_id uuid not null references public.logistics_deliveries(id) on delete restrict,
  action text not null check (action in ('financial_correction')),
  reason text not null check (btrim(reason) <> ''),
  before_state jsonb not null,
  after_state jsonb not null,
  changed_by uuid,
  created_at timestamptz not null default now()
);
create index if not exists logistics_delivery_audit_delivery_idx on public.logistics_delivery_audit (delivery_id, created_at desc);

do $$
declare tbl text;
begin
  foreach tbl in array array['logistics_transport_transactions','logistics_transport_payment_items','logistics_delivery_audit']
  loop
    execute format('alter table public.%I enable row level security', tbl);
    execute format('revoke all on table public.%I from anon, authenticated', tbl);
    execute format('grant all on table public.%I to service_role', tbl);
  end loop;
end $$;
revoke all on table public.logistics_deliveries from anon, authenticated;
grant all on table public.logistics_deliveries to service_role;

create or replace function public.logistics_reject_immutable_mutation()
returns trigger language plpgsql set search_path = pg_catalog, public as $$
begin
  raise exception 'Rows in % are immutable; create a separate reversal or correction record.', tg_table_name using errcode = '55000';
end;
$$;
revoke all on function public.logistics_reject_immutable_mutation() from public, anon, authenticated;
drop trigger if exists logistics_transport_transactions_immutable on public.logistics_transport_transactions;
create trigger logistics_transport_transactions_immutable before update or delete on public.logistics_transport_transactions for each row execute function public.logistics_reject_immutable_mutation();
drop trigger if exists logistics_transport_payment_items_immutable on public.logistics_transport_payment_items;
create trigger logistics_transport_payment_items_immutable before update or delete on public.logistics_transport_payment_items for each row execute function public.logistics_reject_immutable_mutation();
drop trigger if exists logistics_delivery_audit_immutable on public.logistics_delivery_audit;
create trigger logistics_delivery_audit_immutable before update or delete on public.logistics_delivery_audit for each row execute function public.logistics_reject_immutable_mutation();

create or replace function public.logistics_guard_completed_delivery_financials()
returns trigger language plpgsql set search_path = pg_catalog, public as $$
begin
  if old.status = 'completed' then
    if new.status is distinct from old.status then
      raise exception 'A completed delivery cannot be reopened or cancelled.' using errcode = '55000';
    end if;
    if current_setting('app.logistics_financial_correction', true) is distinct from 'on'
       and (new.ordered_liters is distinct from old.ordered_liters
         or new.delivered_liters is distinct from old.delivered_liters
         or new.fee_per_liter is distinct from old.fee_per_liter
         or new.total_fee is distinct from old.total_fee) then
      raise exception 'Completed delivery quantities and frozen charges require an audited admin correction.' using errcode = '55000';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function public.logistics_guard_completed_delivery_financials() from public, anon, authenticated;
drop trigger if exists logistics_guard_completed_delivery_financials on public.logistics_deliveries;
create trigger logistics_guard_completed_delivery_financials before update on public.logistics_deliveries for each row execute function public.logistics_guard_completed_delivery_financials();

create or replace function public.complete_logistics_delivery(
  p_delivery_id uuid, p_tank_id uuid, p_tank_opening_liters numeric,
  p_tank_closing_liters numeric, p_tank_difference_liters numeric,
  p_delivered_liters numeric, p_notes text, p_actor_id uuid
) returns jsonb language plpgsql set search_path = pg_catalog, public as $$
declare v_delivery public.logistics_deliveries%rowtype; v_rate numeric(14,4);
begin
  if p_delivery_id is null or p_tank_id is null or p_tank_opening_liters is null
     or p_tank_closing_liters is null or p_tank_difference_liters is null or p_delivered_liters is null
     or p_tank_opening_liters < 0 or p_tank_closing_liters < 0 or p_delivered_liters <= 0 then
    raise exception 'Record delivered litres, destination tank and all tank-stock readings before completing the delivery.' using errcode = '22023';
  end if;
  select * into v_delivery from public.logistics_deliveries where id = p_delivery_id for update;
  if not found then raise exception 'Delivery not found.' using errcode = 'P0002'; end if;
  if v_delivery.status = 'completed' then raise exception 'This delivery has already been completed.' using errcode = '55000'; end if;
  if v_delivery.status = 'cancelled' then raise exception 'A cancelled delivery cannot be completed.' using errcode = '55000'; end if;
  if not exists (select 1 from public.tanks t where t.id = p_tank_id) then raise exception 'The selected tank does not exist.' using errcode = '22023'; end if;
  select f.fee_per_liter into v_rate from public.logistics_product_fees f where f.product_id = v_delivery.product_id and f.active = true order by f.updated_at desc limit 1;
  v_rate := coalesce(v_rate, 0);
  update public.logistics_deliveries
  set status = 'completed', tank_id = p_tank_id,
      tank_opening_liters = p_tank_opening_liters, tank_closing_liters = p_tank_closing_liters,
      tank_difference_liters = p_tank_difference_liters, delivered_liters = p_delivered_liters,
      fee_per_liter = v_rate, total_fee = round(p_delivered_liters * v_rate, 2),
      eligible_at = now(), completed_at = now(),
      notes = case when p_notes is null then notes else nullif(btrim(p_notes), '') end, updated_at = now()
  where id = p_delivery_id returning * into v_delivery;
  return to_jsonb(v_delivery);
end;
$$;

create or replace function public.correct_logistics_delivery_financials(
  p_delivery_id uuid, p_ordered_liters numeric, p_total_fee numeric, p_reason text, p_actor_id uuid
) returns jsonb language plpgsql set search_path = pg_catalog, public as $$
declare v_delivery public.logistics_deliveries%rowtype; v_before jsonb; v_after jsonb; v_audit public.logistics_delivery_audit%rowtype;
begin
  if p_delivery_id is null or (p_ordered_liters is null and p_total_fee is null)
    or (p_ordered_liters is not null and p_ordered_liters < 0)
    or (p_total_fee is not null and p_total_fee < 0) or btrim(coalesce(p_reason,'')) = '' then
    raise exception 'Choose a valid quantity or charge correction and provide a reason.' using errcode = '22023';
  end if;
  select * into v_delivery from public.logistics_deliveries where id = p_delivery_id for update;
  if not found then raise exception 'Delivery not found.' using errcode = 'P0002'; end if;
  if v_delivery.status <> 'completed' or v_delivery.eligible_at is null then raise exception 'Only eligible completed deliveries can receive financial corrections.' using errcode = '55000'; end if;
  if v_delivery.transport_payment_status = 'paid' then raise exception 'Reverse the linked payment before correcting a paid delivery.' using errcode = '55000'; end if;
  v_before := jsonb_build_object('ordered_liters',v_delivery.ordered_liters,'delivered_liters',v_delivery.delivered_liters,'fee_per_liter',v_delivery.fee_per_liter,'total_fee',v_delivery.total_fee,'transport_payment_status',v_delivery.transport_payment_status);
  perform set_config('app.logistics_financial_correction','on',true);
  update public.logistics_deliveries set ordered_liters=coalesce(p_ordered_liters,ordered_liters),total_fee=coalesce(p_total_fee,total_fee),updated_at=now() where id=p_delivery_id returning * into v_delivery;
  perform set_config('app.logistics_financial_correction','off',true);
  v_after := jsonb_build_object('ordered_liters',v_delivery.ordered_liters,'delivered_liters',v_delivery.delivered_liters,'fee_per_liter',v_delivery.fee_per_liter,'total_fee',v_delivery.total_fee,'transport_payment_status',v_delivery.transport_payment_status);
  insert into public.logistics_delivery_audit(delivery_id,action,reason,before_state,after_state,changed_by)
  values(v_delivery.id,'financial_correction',btrim(p_reason),v_before,v_after,p_actor_id) returning * into v_audit;
  return jsonb_build_object('delivery',to_jsonb(v_delivery),'audit',to_jsonb(v_audit));
end;
$$;

create or replace function public.record_logistics_transport_payment(
  p_delivery_ids uuid[], p_reference text, p_amount numeric, p_created_by uuid
) returns jsonb language plpgsql set search_path = pg_catalog, public as $$
declare v_requested integer; v_found integer; v_total numeric(14,2); v_transaction public.logistics_transport_transactions%rowtype;
begin
  if p_delivery_ids is null or cardinality(p_delivery_ids)<1 or cardinality(p_delivery_ids)>500
    or btrim(coalesce(p_reference,''))='' or p_amount is null or p_amount<0 then
    raise exception 'Select eligible deliveries and provide a payment reference and exact amount.' using errcode='22023';
  end if;
  v_requested:=cardinality(p_delivery_ids);
  if (select count(distinct x) from unnest(p_delivery_ids) as x)<>v_requested then raise exception 'A delivery may only be included once in a payment.' using errcode='22023'; end if;
  perform d.id from public.logistics_deliveries d where d.id=any(p_delivery_ids) order by d.id for update;
  select count(*),coalesce(round(sum(d.total_fee),2),0) into v_found,v_total from public.logistics_deliveries d
  where d.id=any(p_delivery_ids) and d.status='completed' and d.eligible_at is not null and d.tank_id is not null
    and d.tank_opening_liters is not null and d.tank_closing_liters is not null and d.tank_difference_liters is not null
    and d.delivered_liters>0 and d.transport_payment_status='unpaid';
  if v_found<>v_requested then raise exception 'One or more selected deliveries are no longer eligible or have already been paid.' using errcode='55000'; end if;
  if round(p_amount,2)<>v_total then raise exception 'The payment amount must exactly equal the combined full frozen charges (ETB %).',to_char(v_total,'FM999999999999990.00') using errcode='22023'; end if;
  insert into public.logistics_transport_transactions(transaction_type,amount,reference,currency,created_by)
  values('payment',v_total,btrim(p_reference),'ETB',p_created_by) returning * into v_transaction;
  insert into public.logistics_transport_payment_items(transaction_id,delivery_id,charge_snapshot)
  select v_transaction.id,d.id,d.total_fee from public.logistics_deliveries d where d.id=any(p_delivery_ids);
  update public.logistics_deliveries set transport_payment_status='paid',updated_at=now() where id=any(p_delivery_ids);
  return jsonb_build_object('transaction_id',v_transaction.id,'transaction_type',v_transaction.transaction_type,'amount',v_transaction.amount,'reference',v_transaction.reference,'created_at',v_transaction.created_at,'delivery_count',v_requested);
end;
$$;

create or replace function public.reverse_logistics_transport_payment(
  p_transaction_id uuid, p_reference text, p_reason text, p_created_by uuid
) returns jsonb language plpgsql set search_path = pg_catalog, public as $$
declare v_original public.logistics_transport_transactions%rowtype; v_reversal public.logistics_transport_transactions%rowtype; v_item_count integer;
begin
  if p_transaction_id is null or btrim(coalesce(p_reference,''))='' or btrim(coalesce(p_reason,''))='' then raise exception 'A reversal reference and reason are required.' using errcode='22023'; end if;
  select * into v_original from public.logistics_transport_transactions where id=p_transaction_id for update;
  if not found or v_original.transaction_type<>'payment' then raise exception 'Only an original payment transaction can be reversed.' using errcode='22023'; end if;
  if exists(select 1 from public.logistics_transport_transactions where transaction_type='reversal' and original_transaction_id=v_original.id) then raise exception 'This payment has already been reversed.' using errcode='55000'; end if;
  perform d.id from public.logistics_deliveries d join public.logistics_transport_payment_items i on i.delivery_id=d.id where i.transaction_id=v_original.id order by d.id for update of d;
  select count(*) into v_item_count from public.logistics_transport_payment_items where transaction_id=v_original.id;
  if v_item_count=0 then raise exception 'The original payment has no linked deliveries.' using errcode='55000'; end if;
  insert into public.logistics_transport_transactions(transaction_type,original_transaction_id,amount,reference,reason,currency,created_by)
  values('reversal',v_original.id,v_original.amount,btrim(p_reference),btrim(p_reason),v_original.currency,p_created_by) returning * into v_reversal;
  update public.logistics_deliveries d set transport_payment_status='unpaid',updated_at=now()
  where d.id in(select i.delivery_id from public.logistics_transport_payment_items i where i.transaction_id=v_original.id);
  return jsonb_build_object('transaction_id',v_reversal.id,'transaction_type',v_reversal.transaction_type,'original_transaction_id',v_original.id,'amount',v_reversal.amount,'reference',v_reversal.reference,'reason',v_reversal.reason,'created_at',v_reversal.created_at);
end;
$$;

revoke all on function public.complete_logistics_delivery(uuid,uuid,numeric,numeric,numeric,numeric,text,uuid) from public,anon,authenticated;
revoke all on function public.correct_logistics_delivery_financials(uuid,numeric,numeric,text,uuid) from public,anon,authenticated;
revoke all on function public.record_logistics_transport_payment(uuid[],text,numeric,uuid) from public,anon,authenticated;
revoke all on function public.reverse_logistics_transport_payment(uuid,text,text,uuid) from public,anon,authenticated;
grant execute on function public.complete_logistics_delivery(uuid,uuid,numeric,numeric,numeric,numeric,text,uuid) to service_role;
grant execute on function public.correct_logistics_delivery_financials(uuid,numeric,numeric,text,uuid) to service_role;
grant execute on function public.record_logistics_transport_payment(uuid[],text,numeric,uuid) to service_role;
grant execute on function public.reverse_logistics_transport_payment(uuid,text,text,uuid) to service_role;
