-- PREPARED, NOT APPLIED. Version 1 (lite-a-floor4-top10-r1) duplicate-send
-- protection. Adds an exclusive, atomic, durable claim on one event identity
-- so two concurrent commits can never both deliver. Nothing here enables
-- execution: both human controls (LITEA_EXECUTION_ENABLED,
-- LITEA_SERVER_EXECUTION_ENABLED) remain absent/false and this path stays
-- unreachable until a human sets them.
--
-- Apply with the migration tool when the reviewer is ready. Until then the
-- claim RPC is missing, `claim()` returns UNAVAILABLE and the dispatch path
-- delivers nothing at all.

ALTER TABLE public.c85_outbox
  ADD COLUMN IF NOT EXISTS claim_owner TEXT,
  ADD COLUMN IF NOT EXISTS claimed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS claim_expires_at TIMESTAMPTZ;

-- One atomic statement decides ownership for a dedupe key.
--   CLAIMED       caller owns the only live attempt
--   HELD_BY_OTHER another owner holds an unexpired claim
--   ALREADY_SENT  terminal SENT entry
--   TERMINAL      terminal FAILED/EXPIRED/SUPPRESSED entry
--   AMBIGUOUS     a previous claim lapsed after an attempt had begun; the bot
--                 may already have the signal, so no new attempt is granted
CREATE OR REPLACE FUNCTION public.c85_litea_claim_outbox(
  p_dedupe_key TEXT,
  p_owner TEXT,
  p_target_id UUID,
  p_payload JSONB,
  p_expires_at TIMESTAMPTZ
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.c85_outbox%ROWTYPE;
BEGIN
  INSERT INTO public.c85_outbox (
    dedupe_key, target_id, payload, state, attempts,
    expires_at, claim_owner, claimed_at, claim_expires_at
  )
  VALUES (
    p_dedupe_key, p_target_id, p_payload, 'PENDING', 1,
    p_expires_at, p_owner, now(), p_expires_at
  )
  ON CONFLICT (dedupe_key) DO NOTHING
  RETURNING * INTO v_row;

  IF FOUND THEN
    RETURN jsonb_build_object('outcome', 'CLAIMED');
  END IF;

  SELECT * INTO v_row FROM public.c85_outbox WHERE dedupe_key = p_dedupe_key FOR UPDATE;

  IF v_row.state = 'SENT' THEN
    RETURN jsonb_build_object('outcome', 'ALREADY_SENT');
  ELSIF v_row.state <> 'PENDING' THEN
    RETURN jsonb_build_object('outcome', 'TERMINAL');
  ELSIF v_row.claim_owner = p_owner
        AND v_row.claim_expires_at IS NOT NULL
        AND v_row.claim_expires_at > now() THEN
    RETURN jsonb_build_object('outcome', 'CLAIMED');
  ELSIF v_row.claim_expires_at IS NOT NULL AND v_row.claim_expires_at > now() THEN
    RETURN jsonb_build_object('outcome', 'HELD_BY_OTHER');
  ELSE
    -- Lapsed claim on a row that already had an attempt: unresolvable here.
    RETURN jsonb_build_object('outcome', 'AMBIGUOUS');
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.c85_litea_claim_outbox(TEXT, TEXT, UUID, JSONB, TIMESTAMPTZ) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.c85_litea_claim_outbox(TEXT, TEXT, UUID, JSONB, TIMESTAMPTZ) TO service_role;
