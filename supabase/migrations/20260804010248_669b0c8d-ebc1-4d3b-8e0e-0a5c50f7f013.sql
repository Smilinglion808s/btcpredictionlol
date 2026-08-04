-- 1) Restrict anon exposure on internal model tables
DROP POLICY IF EXISTS "Public can read aas96 fits" ON public.model7_aas96_fits;
CREATE POLICY "aas96_fits_read_auth" ON public.model7_aas96_fits FOR SELECT TO authenticated USING (true);
REVOKE ALL ON public.model7_aas96_fits FROM anon;

DROP POLICY IF EXISTS "aas96_layer_b_episodes_read_public" ON public.model7_aas96_layer_b_history_episodes;
CREATE POLICY "aas96_layer_b_episodes_read_auth" ON public.model7_aas96_layer_b_history_episodes FOR SELECT TO authenticated USING (true);
REVOKE ALL ON public.model7_aas96_layer_b_history_episodes FROM anon;

DROP POLICY IF EXISTS "Public can read aas96 shadow" ON public.model7_aas96_shadow;
CREATE POLICY "aas96_shadow_read_auth" ON public.model7_aas96_shadow FOR SELECT TO authenticated USING (true);
REVOKE ALL ON public.model7_aas96_shadow FROM anon;

DROP POLICY IF EXISTS "Public can read aas96 state" ON public.model7_aas96_state;
CREATE POLICY "aas96_state_read_auth" ON public.model7_aas96_state FOR SELECT TO authenticated USING (true);
REVOKE ALL ON public.model7_aas96_state FROM anon;

DROP POLICY IF EXISTS "Anyone can read model archives" ON public.model_archives;
CREATE POLICY "model_archives_read_auth" ON public.model_archives FOR SELECT TO authenticated USING (true);
REVOKE ALL ON public.model_archives FROM anon;

GRANT SELECT ON public.model7_aas96_fits TO authenticated;
GRANT SELECT ON public.model7_aas96_layer_b_history_episodes TO authenticated;
GRANT SELECT ON public.model7_aas96_shadow TO authenticated;
GRANT SELECT ON public.model7_aas96_state TO authenticated;
GRANT SELECT ON public.model_archives TO authenticated;
GRANT ALL ON public.model7_aas96_fits TO service_role;
GRANT ALL ON public.model7_aas96_layer_b_history_episodes TO service_role;
GRANT ALL ON public.model7_aas96_shadow TO service_role;
GRANT ALL ON public.model7_aas96_state TO service_role;
GRANT ALL ON public.model_archives TO service_role;

-- 2) Remove always-true INSERT/UPDATE policies (backend uses service_role)
DROP POLICY IF EXISTS "auth update reviews" ON public.model8_v3_fit_reviews;
DROP POLICY IF EXISTS "auth write reviews" ON public.model8_v3_fit_reviews;
REVOKE INSERT, UPDATE, DELETE ON public.model8_v3_fit_reviews FROM authenticated, anon;
GRANT ALL ON public.model8_v3_fit_reviews TO service_role;

-- 3) Views must enforce the querying user's permissions
ALTER VIEW public.a96_daily_performance SET (security_invoker = on);
ALTER VIEW public.a96_fit_performance SET (security_invoker = on);

-- 4) SECURITY DEFINER functions: only the backend (service_role) may execute
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.prosecdef
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', r.sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', r.sig);
  END LOOP;
END $$;