
CREATE TABLE IF NOT EXISTS public.a96_fit_state (
    fit_episode_id UUID PRIMARY KEY,
    artifact_fit_id TEXT NOT NULL,
    activated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    comparable_resolved_count INTEGER NOT NULL DEFAULT 0 CHECK (comparable_resolved_count >= 0),
    layer_a_wins INTEGER NOT NULL DEFAULT 0 CHECK (layer_a_wins >= 0),
    layer_a_losses INTEGER NOT NULL DEFAULT 0 CHECK (layer_a_losses >= 0),
    layer_a_net INTEGER NOT NULL DEFAULT 0,
    layer_b_wins INTEGER NOT NULL DEFAULT 0 CHECK (layer_b_wins >= 0),
    layer_b_losses INTEGER NOT NULL DEFAULT 0 CHECK (layer_b_losses >= 0),
    layer_b_net INTEGER NOT NULL DEFAULT 0,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (layer_a_net = layer_a_wins - layer_a_losses),
    CHECK (layer_b_net = layer_b_wins - layer_b_losses)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_a96_fit_state_one_active
    ON public.a96_fit_state (is_active) WHERE is_active;

GRANT SELECT ON public.a96_fit_state TO authenticated;
GRANT ALL ON public.a96_fit_state TO service_role;
ALTER TABLE public.a96_fit_state ENABLE ROW LEVEL SECURITY;
CREATE POLICY "a96_fit_state read" ON public.a96_fit_state FOR SELECT TO authenticated USING (true);

CREATE TABLE IF NOT EXISTS public.a96_predictions (
    prediction_id UUID PRIMARY KEY,
    source_prediction_id UUID,
    model_name TEXT NOT NULL DEFAULT 'a96' CHECK (model_name = 'a96'),
    model_version TEXT NOT NULL DEFAULT 'a96-r1',
    fit_episode_id UUID NOT NULL REFERENCES public.a96_fit_state(fit_episode_id),
    artifact_fit_id TEXT NOT NULL,
    target_candle_ts TIMESTAMPTZ NOT NULL,
    prediction_created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    layer_a_direction TEXT NOT NULL CHECK (layer_a_direction IN ('GREEN','RED')),
    layer_b_direction TEXT NOT NULL CHECK (layer_b_direction IN ('GREEN','RED')),
    base_selected_layer TEXT NOT NULL CHECK (base_selected_layer IN ('A','B')),
    selected_layer TEXT NOT NULL CHECK (selected_layer IN ('A','B','NONE')),
    final_prediction TEXT NOT NULL CHECK (final_prediction IN ('GREEN','RED','ABSTAIN')),
    decision_reason TEXT NOT NULL,

    fit_selector_override_fired BOOLEAN NOT NULL DEFAULT FALSE,
    agreement_veto_fired BOOLEAN NOT NULL DEFAULT FALSE,
    distance_from_4_candle_low_bps DOUBLE PRECISION,
    mean_2_candle_body_to_range DOUBLE PRECISION,
    distance_veto_condition BOOLEAN NOT NULL DEFAULT FALSE,
    body_ratio_veto_condition BOOLEAN NOT NULL DEFAULT FALSE,
    target_open DOUBLE PRECISION,

    fit_resolved_count_at_prediction INTEGER NOT NULL,
    layer_a_net_at_prediction INTEGER NOT NULL,
    layer_b_net_at_prediction INTEGER NOT NULL,

    actual_open DOUBLE PRECISION,
    actual_close DOUBLE PRECISION,
    actual_direction TEXT CHECK (actual_direction IN ('GREEN','RED','PUSH')),
    result_score SMALLINT CHECK (result_score IN (-1,0,1)),
    resolved_at TIMESTAMPTZ,

    UNIQUE (fit_episode_id, target_candle_ts),
    CHECK (
        (resolved_at IS NULL AND actual_direction IS NULL AND result_score IS NULL)
        OR
        (resolved_at IS NOT NULL AND actual_direction IS NOT NULL AND result_score IS NOT NULL)
    )
);

CREATE INDEX IF NOT EXISTS idx_a96_predictions_target_ts
    ON public.a96_predictions (target_candle_ts DESC);
CREATE INDEX IF NOT EXISTS idx_a96_predictions_fit_episode
    ON public.a96_predictions (fit_episode_id, target_candle_ts);
CREATE INDEX IF NOT EXISTS idx_a96_predictions_unresolved
    ON public.a96_predictions (target_candle_ts) WHERE resolved_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_a96_predictions_source
    ON public.a96_predictions (source_prediction_id);

GRANT SELECT ON public.a96_predictions TO authenticated;
GRANT ALL ON public.a96_predictions TO service_role;
ALTER TABLE public.a96_predictions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "a96_predictions read" ON public.a96_predictions FOR SELECT TO authenticated USING (true);

CREATE OR REPLACE FUNCTION public.resolve_a96_prediction(
    p_prediction_id UUID,
    p_actual_open DOUBLE PRECISION,
    p_actual_close DOUBLE PRECISION,
    p_resolved_at TIMESTAMPTZ DEFAULT NOW()
)
RETURNS public.a96_predictions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_prediction public.a96_predictions%ROWTYPE;
    v_actual_direction TEXT;
    v_result_score SMALLINT;
    v_a_score INTEGER;
    v_b_score INTEGER;
BEGIN
    IF p_actual_open IS NULL OR p_actual_close IS NULL THEN
        RAISE EXCEPTION 'actual_open and actual_close are required';
    END IF;

    SELECT * INTO v_prediction FROM public.a96_predictions
     WHERE prediction_id = p_prediction_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Unknown a96 prediction_id: %', p_prediction_id;
    END IF;
    IF v_prediction.resolved_at IS NOT NULL THEN
        RETURN v_prediction;
    END IF;

    v_actual_direction := CASE
        WHEN p_actual_close > p_actual_open THEN 'GREEN'
        WHEN p_actual_close < p_actual_open THEN 'RED'
        ELSE 'PUSH' END;

    v_result_score := CASE
        WHEN v_prediction.final_prediction = 'ABSTAIN' THEN 0
        WHEN v_actual_direction = 'PUSH' THEN 0
        WHEN v_prediction.final_prediction = v_actual_direction THEN 1
        ELSE -1 END;

    IF v_actual_direction <> 'PUSH' THEN
        v_a_score := CASE WHEN v_prediction.layer_a_direction = v_actual_direction THEN 1 ELSE -1 END;
        v_b_score := CASE WHEN v_prediction.layer_b_direction = v_actual_direction THEN 1 ELSE -1 END;
        UPDATE public.a96_fit_state
           SET comparable_resolved_count = comparable_resolved_count + 1,
               layer_a_wins = layer_a_wins + CASE WHEN v_a_score = 1 THEN 1 ELSE 0 END,
               layer_a_losses = layer_a_losses + CASE WHEN v_a_score = -1 THEN 1 ELSE 0 END,
               layer_a_net = layer_a_net + v_a_score,
               layer_b_wins = layer_b_wins + CASE WHEN v_b_score = 1 THEN 1 ELSE 0 END,
               layer_b_losses = layer_b_losses + CASE WHEN v_b_score = -1 THEN 1 ELSE 0 END,
               layer_b_net = layer_b_net + v_b_score,
               updated_at = NOW()
         WHERE fit_episode_id = v_prediction.fit_episode_id;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'Missing a96 fit state: %', v_prediction.fit_episode_id;
        END IF;
    END IF;

    UPDATE public.a96_predictions
       SET actual_open = p_actual_open,
           actual_close = p_actual_close,
           actual_direction = v_actual_direction,
           result_score = v_result_score,
           resolved_at = p_resolved_at
     WHERE prediction_id = p_prediction_id
     RETURNING * INTO v_prediction;
    RETURN v_prediction;
END; $$;

CREATE OR REPLACE FUNCTION public.get_or_mint_a96_fit_episode(p_artifact_fit_id TEXT)
RETURNS public.a96_fit_state
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_state public.a96_fit_state%ROWTYPE;
    v_new_id UUID;
BEGIN
    SELECT * INTO v_state FROM public.a96_fit_state
      WHERE is_active AND artifact_fit_id = p_artifact_fit_id
      LIMIT 1;
    IF FOUND THEN RETURN v_state; END IF;

    UPDATE public.a96_fit_state SET is_active = FALSE, updated_at = NOW()
      WHERE is_active;

    v_new_id := gen_random_uuid();
    INSERT INTO public.a96_fit_state (fit_episode_id, artifact_fit_id, is_active)
    VALUES (v_new_id, p_artifact_fit_id, TRUE)
    RETURNING * INTO v_state;
    RETURN v_state;
END; $$;

CREATE OR REPLACE VIEW public.a96_fit_performance AS
SELECT fit_episode_id, artifact_fit_id,
    MIN(target_candle_ts) AS first_target_candle_ts,
    MAX(target_candle_ts) AS last_target_candle_ts,
    COUNT(*) FILTER (WHERE resolved_at IS NOT NULL) AS resolved_predictions,
    COUNT(*) FILTER (WHERE result_score = 1) AS wins,
    COUNT(*) FILTER (WHERE result_score = -1) AS losses,
    COUNT(*) FILTER (WHERE result_score = 0 AND final_prediction = 'ABSTAIN') AS abstains,
    COALESCE(SUM(result_score),0) AS net_score,
    COUNT(*) FILTER (WHERE fit_selector_override_fired) AS selector_overrides,
    COUNT(*) FILTER (WHERE agreement_veto_fired) AS agreement_vetoes
FROM public.a96_predictions GROUP BY fit_episode_id, artifact_fit_id;

CREATE OR REPLACE VIEW public.a96_daily_performance AS
SELECT (target_candle_ts AT TIME ZONE 'UTC')::date AS utc_date,
    COUNT(*) FILTER (WHERE resolved_at IS NOT NULL) AS resolved_predictions,
    COUNT(*) FILTER (WHERE result_score = 1) AS wins,
    COUNT(*) FILTER (WHERE result_score = -1) AS losses,
    COUNT(*) FILTER (WHERE result_score = 0 AND final_prediction = 'ABSTAIN') AS abstains,
    COALESCE(SUM(result_score),0) AS net_score
FROM public.a96_predictions GROUP BY (target_candle_ts AT TIME ZONE 'UTC')::date;

GRANT SELECT ON public.a96_fit_performance TO authenticated;
GRANT SELECT ON public.a96_daily_performance TO authenticated;

ALTER PUBLICATION supabase_realtime ADD TABLE public.a96_predictions;
ALTER PUBLICATION supabase_realtime ADD TABLE public.a96_fit_state;
