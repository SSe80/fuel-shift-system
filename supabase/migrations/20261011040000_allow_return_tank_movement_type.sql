-- Allow returned fuel to be recorded as a tank movement during shift-sale confirmation.
-- Keep the existing movement types and add the return type used by the confirmation RPC.

ALTER TABLE public.tank_movements
  DROP CONSTRAINT IF EXISTS tank_movements_movement_type_check;

ALTER TABLE public.tank_movements
  ADD CONSTRAINT tank_movements_movement_type_check
  CHECK (movement_type = ANY (ARRAY[
    'opening'::text,
    'purchase'::text,
    'sale'::text,
    'transfer_in'::text,
    'transfer_out'::text,
    'adjustment'::text,
    'correction'::text,
    'return'::text
  ]));
