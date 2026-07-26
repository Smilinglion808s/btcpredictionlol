DO $$
DECLARE
  sql text;
BEGIN
  -- Placeholder — real content injected below via query_patch would be too large;
  -- use direct psql via read_query is not writable, so we submit the full SQL.
  RAISE NOTICE 'noop';
END $$;