ALTER TABLE public.model_settings ADD COLUMN IF NOT EXISTS api_model_id text;
ALTER TABLE public.predictions ADD COLUMN IF NOT EXISTS api_model_id text;

UPDATE public.model_settings
SET model_version = 'Model 2',
    api_model_id = 'gpt-5.5',
    updated_at = now()
WHERE is_active = true;

UPDATE public.predictions
SET api_model_id = 'gpt-5.5'
WHERE api_model_id IS NULL;