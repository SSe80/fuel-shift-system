-- Persist purchase-level remarks so they remain available in history and PDF exports.
ALTER TABLE public.purchases
  ADD COLUMN IF NOT EXISTS purchase_remark text;
