UPDATE public.v11_heads
   SET cutoff_ts = COALESCE(cutoff_ts, (fit_date::timestamptz)),
       feature_order_hash = COALESCE(feature_order_hash, '9469d7f50612900b'),
       config_fingerprint = COALESCE(config_fingerprint, 'ab18eb2f7ba4a452');

UPDATE public.v11_heads
   SET quarantined = true,
       quarantine_reason = 'FUTURE_CUTOFF'
 WHERE fit_date > (now() AT TIME ZONE 'utc')::date;