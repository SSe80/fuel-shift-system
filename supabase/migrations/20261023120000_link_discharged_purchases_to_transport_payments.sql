-- Link completed purchase records to transport-payment deliveries and
-- remove tank-stock readings from payment eligibility.
alter table public.logistics_deliveries
  add column if not exists purchase_id uuid references public.purchases(id) on delete restrict;

create unique index if not exists logistics_deliveries_purchase_id_unique
  on public.logistics_deliveries (purchase_id)
  where purchase_id is not null;

alter table public.logistics_deliveries
  drop constraint if exists logistics_deliveries_completion_stock_check;

alter table public.logistics_deliveries
  add constraint logistics_deliveries_completion_stock_check check (
    status <> 'completed' or (eligible_at is not null and delivered_liters > 0)
  );

create or replace function public.record_logistics_transport_payment(
  p_delivery_ids uuid[], p_reference text, p_amount numeric, p_created_by uuid
) returns jsonb language plpgsql set search_path = pg_catalog, public as $$
declare
  v_requested integer;
  v_found integer;
  v_total numeric(14,2);
  v_transaction public.logistics_transport_transactions%rowtype;
begin
  if p_delivery_ids is null or cardinality(p_delivery_ids)<1 or cardinality(p_delivery_ids)>500
    or btrim(coalesce(p_reference,''))='' or p_amount is null or p_amount<0 then
    raise exception 'Select eligible deliveries and provide a payment reference and exact amount.' using errcode='22023';
  end if;
  v_requested:=cardinality(p_delivery_ids);
  if (select count(distinct x) from unnest(p_delivery_ids) as x)<>v_requested then
    raise exception 'A delivery may only be included once in a payment.' using errcode='22023';
  end if;
  perform d.id from public.logistics_deliveries d where d.id=any(p_delivery_ids) order by d.id for update;
  select count(*),coalesce(round(sum(d.total_fee),2),0) into v_found,v_total
  from public.logistics_deliveries d
  where d.id=any(p_delivery_ids)
    and d.status='completed' and d.eligible_at is not null
    and d.delivered_liters>0 and d.transport_payment_status='unpaid';
  if v_found<>v_requested then
    raise exception 'One or more selected deliveries are no longer eligible or have already been paid.' using errcode='55000';
  end if;
  if round(p_amount,2)<>v_total then
    raise exception 'The payment amount must exactly equal the combined full frozen charges (ETB %).',
      to_char(v_total,'FM999999999999990.00') using errcode='22023';
  end if;
  insert into public.logistics_transport_transactions(transaction_type,amount,reference,currency,created_by)
  values('payment',v_total,btrim(p_reference),'ETB',p_created_by) returning * into v_transaction;
  insert into public.logistics_transport_payment_items(transaction_id,delivery_id,charge_snapshot)
  select v_transaction.id,d.id,d.total_fee from public.logistics_deliveries d where d.id=any(p_delivery_ids);
  update public.logistics_deliveries set transport_payment_status='paid',updated_at=now() where id=any(p_delivery_ids);
  return jsonb_build_object('transaction_id',v_transaction.id,'transaction_type',v_transaction.transaction_type,
    'amount',v_transaction.amount,'reference',v_transaction.reference,'created_at',v_transaction.created_at,
    'delivery_count',v_requested);
end;
$$;

revoke all on function public.record_logistics_transport_payment(uuid[],text,numeric,uuid) from public,anon,authenticated;
grant execute on function public.record_logistics_transport_payment(uuid[],text,numeric,uuid) to service_role;
