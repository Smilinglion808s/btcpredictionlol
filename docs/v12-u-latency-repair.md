# U delivery timing repair — September 21, 2026

The six recorded U predictions were correct, but no funded bet resulted. The first encountered the previously fixed decimal-confidence storage error; the next five reached the betting receiver 4.744–6.127 seconds after their checkpoints and exhausted the checkpoint +5-second execution deadline.

Changes:
- Warm and reuse interval-bound scoring context around checkpoints (maximum cache age 10 seconds); still revalidate eligibility authoritatively when publishing. No quote history or scoring inputs are fabricated.
- U publishing reads committed V1/T45 eligibility and the prior claim without rereading volatility/feature history. The existing durable interval/leg event claim remains the exactly-once outbound guard; omit the redundant U nonce write.
- Pin the predictor adapter invocation to us-west-2 and betting receiver invocation to its database region us-west-1. No automatic rerouting is performed by Supabase if a pinned region is unavailable.
- Add authenticated, read-only U execution aggregates. Count wins only on positive-contract betting records; keep prediction outcomes and delivery acknowledgments separate.
- The predictor card explicitly labels prediction results and displays received, filled, skipped and unresolved U execution counts, with a checked-at timestamp. Unavailable reads are never rendered as zero.

No model parameters, deadlines, odds floors, stake fractions, live gate, maker wait, taker fallback rules or duplicate-exposure guards change. Never replay old signals or submit synthetic live signals to verify this release.

Validation: 14 Node adapter/receiver/status tests, 20 context parity tests, 8 Python runtime tests, TypeScript check and production build passed. Live fills still require a naturally qualifying future signal.

Deployment: betting v12-u v5 adds the status read while preserving its previously deployed executor bundle byte-for-byte. The adapter bundle and worker source must also be deployed; source revision is v12-edge-adapter-r5-u-latency and worker_revision v12-u-latency-r1. The existing executor revision remains r3 for U because this patch changes the sender path, not order policy.
