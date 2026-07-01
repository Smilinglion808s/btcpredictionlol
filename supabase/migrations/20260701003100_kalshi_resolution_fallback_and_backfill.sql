-- Backfill the Kalshi-finalized outcomes that were left pending before the
-- resolver switched to the direct markets endpoint fallback.
UPDATE public.predictions
SET status = 'loss',
    actual_next_candle_close = 1,
    resolved_at = coalesce(resolved_at, now())
WHERE candle_ts = '2026-07-01 00:00:00+00'::timestamptz
  AND prediction = 'NO'
  AND status = 'pending';

UPDATE public.predictions
SET status = 'win',
    actual_next_candle_close = 0,
    resolved_at = coalesce(resolved_at, now())
WHERE candle_ts = '2026-07-01 00:15:00+00'::timestamptz
  AND prediction = 'NO'
  AND status = 'pending';
