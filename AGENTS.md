<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->

## Architecture rules
- V2 Final R1 records via `services/v2-worker` -> signed `/api/public/hooks/v2-record` -> `v2_*` tables, and forwards each candle intent through `v2_forward_outbox` (trigger-enqueued, gated by `v2_forward_settings.enabled`) to the betting app's own V2 receiver only; never to V1.2 receivers/executors. V1.2 sending (v12-shadow-adapter + site route) is restored and V2 forwarding is switched off. Why: user switched live betting back from V2 to V1.2 on 2026-10-05.
- V3 PF-E008 runs as isolated `services/v3-worker` (frozen `package/`, SQLite on `/data/v3`), posting one raw-body-HMAC webhook per candle to `V3_WEBHOOK_URL` (`V3_DELIVERY_POLICY`: default `t48-r1` sends at T48 as `v3-signal/1`; opt-in `asap-r1` sends right after the T15/T30 selection as `v3-signal/2` with entry_at=decision_at; both expire at T49) only when `V3_DELIVERY_ENABLED=true`; separately and optionally it reports status/decisions to the signed dashboard-only `/api/public/hooks/v3-record` (`v3_*` tables, V3 tile) when `V3_RECORD_URL` is set; V1.2/V2 receiver URLs refused. Why: simplest V3 hookup reusing the bettor's controls, plus a dashboard tile (2026-10-05).
