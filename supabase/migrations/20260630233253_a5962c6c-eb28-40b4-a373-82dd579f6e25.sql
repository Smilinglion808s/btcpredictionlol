
UPDATE public.predictions SET status='loss', actual_next_candle_open=58509.56, actual_next_candle_high=58547.71, actual_next_candle_low=58439.71, actual_next_candle_close=58511.57, resolved_at=now() WHERE id='34b9a34e-f4cb-4a2c-af71-18cc40ea1994';
UPDATE public.predictions SET status='loss', actual_next_candle_open=58511.57, actual_next_candle_high=58558.58, actual_next_candle_low=58465.25, actual_next_candle_close=58512.53, resolved_at=now() WHERE id='975e1486-5956-4782-9080-2dce424dd8e3';
INSERT INTO public.candles (symbol, timeframe, candle_ts, open, high, low, close, volume, confirm) VALUES
 ('BTC-USDT','15m','2026-06-30 22:45:00+00',58508.97,58535,58446.08,58509.56,33.89,true),
 ('BTC-USDT','15m','2026-06-30 23:00:00+00',58509.56,58547.71,58439.71,58511.57,45.86,true),
 ('BTC-USDT','15m','2026-06-30 23:15:00+00',58511.57,58558.58,58465.25,58512.53,50.19,true)
ON CONFLICT DO NOTHING;
