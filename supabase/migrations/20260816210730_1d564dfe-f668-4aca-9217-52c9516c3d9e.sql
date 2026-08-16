DO $$
DECLARE c record;
BEGIN
  FOR c IN SELECT column_name FROM information_schema.columns
           WHERE table_schema='public' AND table_name='model7_td1_rc_shadow' AND column_name LIKE 'td3\_%'
  LOOP
    EXECUTE format('ALTER TABLE public.model7_td1_rc_shadow DROP COLUMN IF EXISTS %I', c.column_name);
  END LOOP;
END $$;