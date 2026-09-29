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
- V2 Final R1 records via `services/v2-worker` -> signed `/api/public/hooks/v2-record` -> `v2_*` tables, and forwards each candle intent through `v2_forward_outbox` (trigger-enqueued, gated by `v2_forward_settings.enabled`, default off) to the betting app's own V2 receiver only; never to V1.2 receivers/executors. Why: user authorized V2 betting 2026-09-29; V1.2 stays halted.
