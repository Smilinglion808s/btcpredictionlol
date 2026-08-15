REVOKE ALL ON public.b4x4_ob_capture_auth FROM anon, authenticated;
GRANT ALL ON public.b4x4_ob_capture_auth TO service_role;
REVOKE ALL ON public.webhook_endpoints FROM anon, authenticated;
GRANT ALL ON public.webhook_endpoints TO service_role;