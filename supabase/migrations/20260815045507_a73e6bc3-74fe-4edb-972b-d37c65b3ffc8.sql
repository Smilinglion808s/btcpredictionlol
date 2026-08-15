DROP POLICY IF EXISTS "read archive" ON public.predictions_archive;
CREATE POLICY "read archive authenticated" ON public.predictions_archive FOR SELECT TO authenticated USING (true);
REVOKE SELECT ON public.predictions_archive FROM anon;
GRANT SELECT ON public.predictions_archive TO authenticated;
GRANT ALL ON public.predictions_archive TO service_role;