-- Rename equipment labels and extend the existing nozzles table to represent fuel dispensers.
alter table public.nozzles
  add column if not exists nozzle_count integer not null default 1;

alter table public.nozzles
  drop constraint if exists nozzles_nozzle_count_check;

alter table public.nozzles
  add constraint nozzles_nozzle_count_check check (nozzle_count between 1 and 4);

-- Rename existing tanks to CODE•TANK N.
with ranked as (
  select t.id, p.code_name,
         row_number() over (partition by lower(t.product) order by t.created_at, t.id) as rn
  from public.tanks t
  join public.products p on lower(p.name)=lower(t.product)
)
update public.tanks t
set tank_code = ranked.code_name || '•TANK ' || ranked.rn
from ranked
where t.id=ranked.id;

-- Rename existing dispensers/nozzles to CODE•DISPENSER N.
with ranked as (
  select n.id, p.code_name,
         row_number() over (partition by lower(n.product) order by n.created_at, n.id) as rn
  from public.nozzles n
  join public.products p on lower(p.name)=lower(n.product)
)
update public.nozzles n
set nozzle_code = ranked.code_name || '•DISPENSER ' || ranked.rn
from ranked
where n.id=ranked.id;

create unique index if not exists uq_nozzles_dispenser_code on public.nozzles(nozzle_code);
