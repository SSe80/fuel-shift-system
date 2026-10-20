-- A physical reconciliation can legitimately calculate a zero-liter adjustment.
-- Zero is a no-op and must not be inserted because tank_movements_quantity_check
-- intentionally requires adjustment/correction quantities to be non-zero.
-- Keep the strict constraint; skip only zero-quantity adjustment/correction rows.

CREATE OR REPLACE FUNCTION public.skip_zero_tank_reconciliation_movement()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $function$
BEGIN
  IF NEW.movement_type IN ('adjustment', 'correction')
     AND NEW.quantity_liters = 0 THEN
    RETURN NULL;
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_skip_zero_tank_reconciliation_movement
  ON public.tank_movements;

CREATE TRIGGER trg_skip_zero_tank_reconciliation_movement
BEFORE INSERT ON public.tank_movements
FOR EACH ROW
EXECUTE FUNCTION public.skip_zero_tank_reconciliation_movement();

REVOKE ALL ON FUNCTION public.skip_zero_tank_reconciliation_movement()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.skip_zero_tank_reconciliation_movement()
  TO service_role;
