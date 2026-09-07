REVOKE EXECUTE ON FUNCTION public.c85_acquire_lease(text, text, integer) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.c85_append_checkpoint(jsonb) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.c85_commit_decision(jsonb, jsonb, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.c85_consume_settlements(text, uuid[], jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.c85_acquire_lease(text, text, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.c85_append_checkpoint(jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.c85_commit_decision(jsonb, jsonb, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.c85_consume_settlements(text, uuid[], jsonb) TO service_role;