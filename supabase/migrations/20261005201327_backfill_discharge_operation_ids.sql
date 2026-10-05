-- Backfill stable operation IDs for legacy JSON discharge-history entries.
-- Idempotent: existing operation_id values are preserved.
with rebuilt as (
  select
    p.id,
    jsonb_agg(
      case
        when nullif(e.op->>'operation_id','') is not null then e.op
        else jsonb_set(
          e.op,
          '{operation_id}',
          to_jsonb(
            lower(
              substr(h,1,8)||'-'||substr(h,9,4)||'-'||substr(h,13,4)||'-'||substr(h,17,4)||'-'||substr(h,21,12)
            )::uuid
          ),
          true
        )
      end
      order by e.ord
    ) as new_history
  from public.purchases p
  cross join lateral jsonb_array_elements(coalesce(p.discharge_history,'[]'::jsonb)) with ordinality e(op,ord)
  cross join lateral (
    select md5(
      p.id::text || ':discharge-operation:' || e.ord::text || ':' ||
      coalesce(e.op->>'discharge_datetime','') || ':' ||
      coalesce(e.op->>'tank_id','') || ':' ||
      coalesce(e.op->>'discharged_quantity_liters','') || ':' ||
      coalesce(e.op->>'compartment_indexes','')
    ) as h
  ) hashed
  group by p.id
),
updated as (
  update public.purchases p
  set discharge_history = r.new_history
  from rebuilt r
  where p.id = r.id
    and p.discharge_history is distinct from r.new_history
  returning p.id
)
select count(*) as purchases_updated from updated;