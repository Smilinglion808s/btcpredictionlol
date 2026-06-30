UPDATE public.model_settings
SET model_version = 'gpt-5.5',
    prompt_template = 'You are running BTCUSDT 15m Model 2 — reduced filter. Use only the supplied closed candles. Make a Run Next prediction for the next 15m candle. Return JSON only with fields: prediction (YES or NO), confidence (0-100), setup_type, market_condition, reasoning_summary, indicators (object of short strings).',
    is_active = true,
    updated_at = now()
WHERE is_active = true;