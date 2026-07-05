UPDATE public.model_settings
SET confidence_threshold = 45,
    prompt_template = replace(
      prompt_template,
      '"require_score_margin_for_fallback":true,"minimum_score_margin":10',
      '"require_score_margin_for_fallback":true,"minimum_score_margin":5'
    ),
    updated_at = now()
WHERE is_active = true AND model_version = 'BTC 15m Model 2.4.1 — Draft VWAP ATR + Fallback Lockout';