-- Clear the opening-stock baseline when operational data is reset.
-- Preserve current_liters: it represents the tank's live stock and is not reset here.
CREATE OR REPLACE FUNCTION public.reset_operational_data()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  deleted_counts jsonb := '{}'::jsonb;
  affected integer := 0;
BEGIN
  DELETE FROM public.accounting_exception_approvals WHERE true;
  GET DIAGNOSTICS affected = ROW_COUNT;
  deleted_counts := deleted_counts || jsonb_build_object('accounting_exception_approvals', affected);
  DELETE FROM public.accounting_exceptions WHERE true;
  GET DIAGNOSTICS affected = ROW_COUNT;
  deleted_counts := deleted_counts || jsonb_build_object('accounting_exceptions', affected);
  DELETE FROM public.tank_closing_snapshots WHERE true;
  GET DIAGNOSTICS affected = ROW_COUNT;
  deleted_counts := deleted_counts || jsonb_build_object('tank_closing_snapshots', affected);
  DELETE FROM public.tank_opening_snapshots WHERE true;
  GET DIAGNOSTICS affected = ROW_COUNT;
  deleted_counts := deleted_counts || jsonb_build_object('tank_opening_snapshots', affected);
  DELETE FROM public.accounting_periods WHERE true;
  GET DIAGNOSTICS affected = ROW_COUNT;
  deleted_counts := deleted_counts || jsonb_build_object('accounting_periods', affected);
  DELETE FROM public.daily_report_revisions WHERE true;
  GET DIAGNOSTICS affected = ROW_COUNT;
  deleted_counts := deleted_counts || jsonb_build_object('daily_report_revisions', affected);
  DELETE FROM public.daily_report_confirmations WHERE true;
  GET DIAGNOSTICS affected = ROW_COUNT;
  deleted_counts := deleted_counts || jsonb_build_object('daily_report_confirmations', affected);
  DELETE FROM public.daily_reports WHERE true;
  GET DIAGNOSTICS affected = ROW_COUNT;
  deleted_counts := deleted_counts || jsonb_build_object('daily_reports', affected);
  DELETE FROM public.station_inbox_notification_states WHERE true;
  GET DIAGNOSTICS affected = ROW_COUNT;
  deleted_counts := deleted_counts || jsonb_build_object('station_inbox_notification_states', affected);
  DELETE FROM public.station_inbox_notifications WHERE true;
  GET DIAGNOSTICS affected = ROW_COUNT;
  deleted_counts := deleted_counts || jsonb_build_object('station_inbox_notifications', affected);
  DELETE FROM public.payment_transactions WHERE true;
  GET DIAGNOSTICS affected = ROW_COUNT;
  deleted_counts := deleted_counts || jsonb_build_object('payment_transactions', affected);
  DELETE FROM public.shift_takeover_sales WHERE true;
  GET DIAGNOSTICS affected = ROW_COUNT;
  deleted_counts := deleted_counts || jsonb_build_object('shift_takeover_sales', affected);
  DELETE FROM public.shift_nozzle_readings WHERE true;
  GET DIAGNOSTICS affected = ROW_COUNT;
  deleted_counts := deleted_counts || jsonb_build_object('shift_nozzle_readings', affected);
  DELETE FROM public.handover_nozzle_readings WHERE true;
  GET DIAGNOSTICS affected = ROW_COUNT;
  deleted_counts := deleted_counts || jsonb_build_object('handover_nozzle_readings', affected);
  DELETE FROM public.shift_takeovers WHERE true;
  GET DIAGNOSTICS affected = ROW_COUNT;
  deleted_counts := deleted_counts || jsonb_build_object('shift_takeovers', affected);
  DELETE FROM public.handovers WHERE true;
  GET DIAGNOSTICS affected = ROW_COUNT;
  deleted_counts := deleted_counts || jsonb_build_object('handovers', affected);
  DELETE FROM public.dispenser_deactivation_requests WHERE true;
  GET DIAGNOSTICS affected = ROW_COUNT;
  deleted_counts := deleted_counts || jsonb_build_object('dispenser_deactivation_requests', affected);
  DELETE FROM public.sales WHERE true;
  GET DIAGNOSTICS affected = ROW_COUNT;
  deleted_counts := deleted_counts || jsonb_build_object('sales', affected);
  DELETE FROM public.purchases WHERE true;
  GET DIAGNOSTICS affected = ROW_COUNT;
  deleted_counts := deleted_counts || jsonb_build_object('purchases', affected);
  DELETE FROM public.tank_movements WHERE true;
  GET DIAGNOSTICS affected = ROW_COUNT;
  deleted_counts := deleted_counts || jsonb_build_object('tank_movements', affected);
  DELETE FROM public.shifts WHERE true;
  GET DIAGNOSTICS affected = ROW_COUNT;
  deleted_counts := deleted_counts || jsonb_build_object('shifts', affected);
  UPDATE public.tanks
     SET opening_stock_liters = NULL
   WHERE opening_stock_liters IS NOT NULL;
  GET DIAGNOSTICS affected = ROW_COUNT;
  deleted_counts := deleted_counts || jsonb_build_object('tank_opening_stock_cleared', affected);
  UPDATE public.nozzles
     SET active = false, activated_by = NULL, activated_at = NULL, opening_tank_liters = NULL
   WHERE true;
  GET DIAGNOSTICS affected = ROW_COUNT;
  deleted_counts := deleted_counts || jsonb_build_object('nozzles_deactivated', affected);
  RETURN jsonb_build_object(
    'ok', true,
    'message', 'Operational records cleared. Tank opening-stock baselines were cleared; current tank stock and station configuration were preserved.',
    'counts', deleted_counts
  );
END;
$function$;
