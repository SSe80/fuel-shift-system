-- Return movements are positive quantities added back to the assigned tank.
-- Preserve existing quantity validation for all other movement types.

ALTER TABLE public.tank_movements
  DROP CONSTRAINT IF EXISTS tank_movements_quantity_check;

ALTER TABLE public.tank_movements
  ADD CONSTRAINT tank_movements_quantity_check
  CHECK (
    (
      movement_type = ANY (ARRAY[
        'opening'::text,
        'purchase'::text,
        'sale'::text,
        'transfer_in'::text,
        'transfer_out'::text,
        'return'::text
      ])
      AND quantity_liters > 0
    )
    OR (
      movement_type = ANY (ARRAY['adjustment'::text, 'correction'::text])
      AND quantity_liters <> 0
    )
  );
