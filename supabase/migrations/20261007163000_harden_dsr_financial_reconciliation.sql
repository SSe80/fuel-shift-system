-- Preserve DSR history while separating calculated fuel sales from entered payments.
alter table public.daily_reports
  add column if not exists calculated_sales_amount numeric(14,2),
  add column if not exists entered_payment_amount numeric(14,2),
  add column if not exists financial_difference numeric(14,2);

update public.daily_reports
set calculated_sales_amount = coalesce(calculated_sales_amount, total_sales_amount),
    entered_payment_amount = coalesce(entered_payment_amount, total_sales_amount),
    financial_difference = coalesce(financial_difference, 0);

-- Newly generated DSRs retain total_sales_amount as the calculated fuel-sales amount
-- for backward compatibility, while storing the authoritative payment total and
-- explicit financial difference separately.
do $$
declare d text;
begin
  select pg_get_functiondef('public.generate_daily_report(date,uuid,text)'::regprocedure) into d;
  d := replace(d,
    'v_sales_l numeric:=0; v_sales_a numeric:=0; v_purchase_l numeric:=0;',
    'v_sales_l numeric:=0; v_sales_a numeric:=0; v_payment_a numeric:=0; v_purchase_l numeric:=0;');
  d := replace(d,
    'select * into v_old from public.daily_reports where report_date=p_report_date for update;',
    'select coalesce(sum(pt.amount),0) into v_payment_a from public.payment_transactions pt join public.shifts s on s.id=pt.shift_id where (s.start_time at time zone ''Africa/Addis_Ababa'')::date=p_report_date; select * into v_old from public.daily_reports where report_date=p_report_date for update;');
  d := replace(d,
    'insert into public.daily_reports(report_date,total_sales_liters,total_sales_amount,total_purchases_liters,generated_by) values(p_report_date,v_sales_l,v_sales_a,v_purchase_l,p_generated_by)',
    'insert into public.daily_reports(report_date,total_sales_liters,total_sales_amount,total_purchases_liters,calculated_sales_amount,entered_payment_amount,financial_difference,generated_by) values(p_report_date,v_sales_l,v_sales_a,v_purchase_l,v_sales_a,v_payment_a,v_payment_a-v_sales_a,p_generated_by)');
  d := replace(d,
    'total_sales_liters=excluded.total_sales_liters,total_sales_amount=excluded.total_sales_amount,total_purchases_liters=excluded.total_purchases_liters,generated_by=excluded.generated_by,updated_at=now()',
    'total_sales_liters=excluded.total_sales_liters,total_sales_amount=excluded.total_sales_amount,total_purchases_liters=excluded.total_purchases_liters,calculated_sales_amount=excluded.calculated_sales_amount,entered_payment_amount=excluded.entered_payment_amount,financial_difference=excluded.financial_difference,generated_by=excluded.generated_by,updated_at=now()');
  execute d;
end $$;
