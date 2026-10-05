-- Final database audit: cover foreign keys, remove duplicate unique indexes,
-- and make the admin RLS predicate init-plan friendly.

create index if not exists idx_daily_report_confirmations_confirmed_by on public.daily_report_confirmations (confirmed_by);
create index if not exists idx_daily_report_revisions_archived_by on public.daily_report_revisions (archived_by);
create index if not exists idx_nozzles_activated_by on public.nozzles (activated_by);
create index if not exists idx_product_price_history_changed_by on public.product_price_history (changed_by);
create index if not exists idx_shift_nozzle_readings_closing_source_handover on public.shift_nozzle_readings (closing_source_handover_id);
create index if not exists idx_shift_nozzle_readings_opening_source_reading on public.shift_nozzle_readings (opening_source_reading_id);
create index if not exists idx_shift_takeover_sales_recorded_by on public.shift_takeover_sales (recorded_by);
create index if not exists idx_shift_takeover_sales_sale_type_id on public.shift_takeover_sales (sale_type_id);
create index if not exists idx_shift_takeovers_from_employee_id on public.shift_takeovers (from_employee_id);
create index if not exists idx_shift_takeovers_sales_confirmed_by on public.shift_takeovers (sales_confirmed_by);
create index if not exists idx_shift_takeovers_sales_recorded_by on public.shift_takeovers (sales_recorded_by);
create index if not exists idx_shift_takeovers_tank_id on public.shift_takeovers (tank_id);
create index if not exists idx_shift_takeovers_to_employee_id on public.shift_takeovers (to_employee_id);
create index if not exists idx_tanks_product_id on public.tanks (product_id);

drop index if exists public.uq_nozzles_dispenser_code;
drop index if exists public.uq_tanks_tank_code;

drop policy if exists daily_report_confirmations_admin_select on public.daily_report_confirmations;
create policy daily_report_confirmations_admin_select
on public.daily_report_confirmations
for select
to public
using (
  exists (
    select 1
    from public.employees e
    where e.id=(select auth.uid())
      and e.role='admin'
      and e.active=true
  )
);
