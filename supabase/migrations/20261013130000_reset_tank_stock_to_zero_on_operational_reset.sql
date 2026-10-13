-- Reset recorded tank stock readings to zero when operational data is reset.
-- Station configuration and calibration remain unchanged.
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
  -- Clear queued Drive export jobs during an operational reset. This does not delete files already uploaded to Google Drive.
  DELETE FROM public.drive_export_queue WHERE true;
  GET DIAGNOSTICS affected = ROW_COUNT;
  deleted_counts := deleted_counts || jsonb_build_object('drive_export_queue', affected);
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
     SET current_liters = 0,
         current_mm = 0,
         opening_stock_liters = NULL,
         updated_at = now()
   WHERE current_liters IS DISTINCT FROM 0
      OR current_mm IS DISTINCT FROM 0
      OR opening_stock_liters IS NOT NULL;
  GET DIAGNOSTICS affected = ROW_COUNT;
  deleted_counts := deleted_counts || jsonb_build_object('tank_stock_reset_to_zero', affected);
  UPDATE public.nozzles
     SET active = false, activated_by = NULL, activated_at = NULL, opening_tank_liters = NULL
   WHERE true;
  GET DIAGNOSTICS affected = ROW_COUNT;
  deleted_counts := deleted_counts || jsonb_build_object('nozzles_deactivated', affected);
  RETURN jsonb_build_object(
    'ok', true,
    'message', 'Operational records cleared. Tank stock readings were reset to 0 L and 0 mm, opening-stock baselines were cleared, and station configuration and calibration were preserved.',
    'counts', deleted_counts
  );
END;
$function$;
