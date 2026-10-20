-- Track fuel-shortage settlement independently of transport payments.
alter table public.purchases
  add column if not exists shortage_payment_status text not null default 'unpaid',
  add column if not exists shortage_payment_updated_at timestamptz,
  add column if not exists shortage_payment_updated_by uuid references public.employees(id) on delete set null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'purchases_shortage_payment_status_check'
      and conrelid = 'public.purchases'::regclass
  ) then
    alter table public.purchases
      add constraint purchases_shortage_payment_status_check
      check (shortage_payment_status in ('paid','unpaid'));
  end if;
end $$;
