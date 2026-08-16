ALTER TABLE public.b4x4_es1_binance_ob_boundary_features
  ADD COLUMN IF NOT EXISTS resync_generation_min integer,
  ADD COLUMN IF NOT EXISTS resync_generation_max integer,
  ADD COLUMN IF NOT EXISTS resync_continuous boolean,
  ADD COLUMN IF NOT EXISTS final_bid_depth_btc_1bps double precision,
  ADD COLUMN IF NOT EXISTS final_ask_depth_btc_1bps double precision,
  ADD COLUMN IF NOT EXISTS final_total_depth_btc_1bps double precision,
  ADD COLUMN IF NOT EXISTS final_bid_depth_btc_2bps double precision,
  ADD COLUMN IF NOT EXISTS final_ask_depth_btc_2bps double precision,
  ADD COLUMN IF NOT EXISTS final_total_depth_btc_2bps double precision,
  ADD COLUMN IF NOT EXISTS final_bid_depth_btc_5bps double precision,
  ADD COLUMN IF NOT EXISTS final_ask_depth_btc_5bps double precision,
  ADD COLUMN IF NOT EXISTS final_total_depth_btc_5bps double precision,
  ADD COLUMN IF NOT EXISTS final_bid_depth_usd_10bps double precision,
  ADD COLUMN IF NOT EXISTS final_ask_depth_usd_10bps double precision;

-- Backfill continuity attribution for existing boundaries from the preserved
-- raw observation rows (observations themselves are never modified).
WITH gen AS (
  SELECT o.target_ts, o.market_kind,
         MIN(o.resync_generation) AS gmin,
         MAX(o.resync_generation) AS gmax
    FROM public.b4x4_es1_binance_ob_observations o
   GROUP BY 1, 2
)
UPDATE public.b4x4_es1_binance_ob_boundary_features f
   SET resync_generation_min = gen.gmin,
       resync_generation_max = gen.gmax,
       resync_continuous = (gen.gmin = gen.gmax)
  FROM gen
 WHERE f.target_ts = gen.target_ts
   AND f.market_kind = gen.market_kind;

-- Genuine mid-window continuity breaks are not valid boundaries: exclude them
-- from readiness (and therefore from the 96-row percentile history).
UPDATE public.b4x4_es1_binance_ob_boundary_features
   SET ready = false,
       ready_reason = 'RESYNC_DISCONTINUITY'
 WHERE resync_continuous IS FALSE
   AND ready IS TRUE;