-- Preserve the original tank movement rows and append explicit reversal
-- entries for movements created by cancelled/overlapping MGR tank handovers.
-- These pairs duplicated a legitimate stock change and must not be deleted.
WITH invalid_movements(id, expected_type, expected_quantity, expected_reference_id, reason) AS (
  VALUES
    ('e5f2d2af-52c3-477b-af33-b76ba5253a30'::uuid, 'sale'::text, 6082380.670::numeric, '3999ace8-ecae-4f93-9bcb-25a8b9b2012b'::uuid, 'cancelled handover sale'),
    ('158c35b5-914e-4983-be3c-4fcde2a36806'::uuid, 'adjustment'::text, 6080193.170::numeric, '22eb35ce-47e4-4bc8-8c34-d0ded2b7e3c3'::uuid, 'paired impossible adjustment'),
    ('46229a62-54b6-4268-8b01-dc4e90a6695f'::uuid, 'adjustment'::text, 45501.270::numeric, '79a358ec-87ca-4983-af5a-a687582af207'::uuid, 'overlapping-shift adjustment'),
    ('56fdd01e-013e-4643-b468-e3c0bc0498e9'::uuid, 'adjustment'::text, 43467.000::numeric, 'f21b652d-c6af-4316-83af-8d2a7b845f00'::uuid, 'overlapping-shift adjustment')
),
verified AS (
  SELECT m.*, i.reason
  FROM public.tank_movements m
  JOIN invalid_movements i
    ON i.id = m.id
   AND i.expected_type = m.movement_type
   AND i.expected_quantity = m.quantity_liters
   AND i.expected_reference_id = m.reference_id
  WHERE m.tank_id = '77d6fff7-5028-4e44-b904-959c06800476'::uuid
)
INSERT INTO public.tank_movements(
  tank_id, movement_type, quantity_liters, reference_id, notes, created_by, created_at
)
SELECT
  v.tank_id,
  'adjustment',
  CASE WHEN v.movement_type = 'sale' THEN abs(v.quantity_liters) ELSE -v.quantity_liters END,
  v.id,
  'Reversal of tank movement: ' || v.id::text || ' (' || v.reason || '). Original movement retained for audit.',
  NULL,
  v.created_at + interval '1 millisecond'
FROM verified v
WHERE NOT EXISTS (
  SELECT 1 FROM public.tank_movements r
  WHERE r.reference_id = v.id
    AND r.notes LIKE 'Reversal of tank movement:%'
);

-- Backdated reversals must not replace the newest physical tank snapshot as
-- the live balance. Re-anchor the cache only when no later movement supersedes it.
WITH latest_closing AS (
  SELECT st.tank_id, st.tank_closing_liters, st.shift_ended_at
  FROM public.shift_takeovers st
  WHERE st.tank_id = '77d6fff7-5028-4e44-b904-959c06800476'::uuid
    AND st.tank_closing_liters IS NOT NULL
    AND st.shift_ended_at IS NOT NULL
  ORDER BY st.shift_ended_at DESC, st.created_at DESC
  LIMIT 1
)
UPDATE public.tanks t
SET current_liters = lc.tank_closing_liters,
    updated_at = now()
FROM latest_closing lc
WHERE t.id = lc.tank_id
  AND lc.tank_closing_liters >= 0
  AND lc.tank_closing_liters <= t.capacity_liters
  AND NOT EXISTS (
    SELECT 1 FROM public.tank_movements tm
    WHERE tm.tank_id = t.id
      AND tm.created_at > lc.shift_ended_at
  )
  AND t.current_liters IS DISTINCT FROM lc.tank_closing_liters;
