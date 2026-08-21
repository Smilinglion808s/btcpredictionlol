UPDATE public.t45_pf_activation
SET mode = 'ACTIVE',
    webhooks_enabled = true,
    activation_target_ts = date_trunc('hour', now()) + (floor(extract(minute from now())/15)+1) * interval '15 minutes',
    approved_at = now(),
    approval_note = 'Owner approved go-live 2026-08-21: T45 PriceFlow is the sole outbound webhook source.',
    updated_at = now()
WHERE singleton_key = 'T45_PRICE_FLOW';

UPDATE public.webhook_endpoints SET is_active = true;