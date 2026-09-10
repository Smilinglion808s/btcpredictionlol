ALTER TABLE public.c85_outbox
  ADD COLUMN IF NOT EXISTS claim_owner TEXT,
  ADD COLUMN IF NOT EXISTS claimed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS claim_expires_at TIMESTAMPTZ;

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
    RETURN jsonb_build_object('outcome', 'AMBIGUOUS');
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.c85_litea_claim_outbox(TEXT, TEXT, UUID, JSONB, TIMESTAMPTZ) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.c85_litea_claim_outbox(TEXT, TEXT, UUID, JSONB, TIMESTAMPTZ) TO service_role;