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
- Stats shows only the V3 tile; its totals poll on the dashboard-refresh cadence and are server-cached 60s. Why: cut network cost.
- Solana wallet headline PnL is derived purely from one accepted paper trader aggregate per wallet; duplicate aggregates are unavailable and cross-run totals stay unavailable until a complete canonical cross-run read contract exists. Why: prevent replay accumulation, open-estimate substitution and paper/live mixing.
- Solana dashboard formatting and pure session-bound historical check attribution are isolated in `solana-paper-display`; history refresh is browser-only and independent of health/control polling, with unchanged parsers and server cadence. Why: keep report outcomes, accepted session identity and historical cutoffs distinct from scanner transport without changing execution.
- Only V3 and Solana Paper remain; all other models (V1.1, V1.2, V2, C85, Lite-A, T45, ES1, DOT) and their pages, hooks, workers and schedules were removed on 2026-10-20. Their database tables are kept untouched as history.
- V3 PF-E008 runs as isolated `services/v3-worker` (frozen `package/`, SQLite on `/data/v3`), posting one raw-body-HMAC webhook per candle to `V3_WEBHOOK_URL` (`V3_DELIVERY_POLICY`: default `t48-r1` uses `v3-signal/1`, enters at T48, and dispatches immediately after all enforced T45 gates pass when reversal enforcement is active, otherwise at T48; opt-in `asap-r1` sends right after the T15/T30 selection as `v3-signal/2` with entry_at=decision_at; both expire at T49) only when `V3_DELIVERY_ENABLED=true`; separately and optionally it reports status/decisions to the signed dashboard-only `/api/public/hooks/v3-record` (`v3_*` tables, V3 tile) when `V3_RECORD_URL` is set; V1.2/V2 receiver URLs refused. Why: V3 hookup reuses bettor controls; T45 dispatch separates preparation from T48 order entry (2026-10-07).
