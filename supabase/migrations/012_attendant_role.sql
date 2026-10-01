-- Rename the non-admin staff role from employee to attendant.
update public.employees
set role = 'attendant'
where role = 'employee';

-- Keep the employees table name for database compatibility,
-- but only allow the two application roles.
alter table public.employees
  drop constraint if exists employees_role_check;

alter table public.employees
  add constraint employees_role_check
  check (role in ('admin','attendant'));
