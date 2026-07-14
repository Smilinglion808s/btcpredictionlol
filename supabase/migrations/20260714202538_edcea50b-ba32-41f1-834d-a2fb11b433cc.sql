
ALTER TABLE public.model7_shadow DROP CONSTRAINT IF EXISTS model7_shadow_variant_check;
ALTER TABLE public.model7_shadow ADD CONSTRAINT model7_shadow_variant_check
  CHECK (variant = ANY (ARRAY['A'::text, 'B'::text, 'B2'::text, 'B4_2'::text,
                              'A2_Conflict'::text, 'A2_MidBand'::text, 'A2_Combined'::text]));

ALTER TABLE public.model7_shadow
  ADD COLUMN IF NOT EXISTS a2_filter_fired boolean,
  ADD COLUMN IF NOT EXISTS a2_filter_reason text,
  ADD COLUMN IF NOT EXISTS a2_probability_bucket text,
  ADD COLUMN IF NOT EXISTS a2_variant_a_base_decision text,
  ADD COLUMN IF NOT EXISTS a2_variant_a_override_applied boolean,
  ADD COLUMN IF NOT EXISTS a2_variant_a_applied_override_reason text,
  ADD COLUMN IF NOT EXISTS a2_variant_a_final_decision text,
  ADD COLUMN IF NOT EXISTS a2_counterfactual_result text;
