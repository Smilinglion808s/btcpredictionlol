ALTER TABLE public.model7_shadow DROP CONSTRAINT IF EXISTS model7_shadow_variant_check;
ALTER TABLE public.model7_shadow ADD CONSTRAINT model7_shadow_variant_check
  CHECK (variant = ANY (ARRAY['A'::text, 'B'::text, 'B2'::text, 'B4_2'::text]));