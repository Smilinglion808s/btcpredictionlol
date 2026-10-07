# DOT BTC paper worker: isolated observer / execution laboratory

Status: local build and tests complete; NOT deployed; no live feed contacted during build. Kraken observer disabled by default. Paper entry activation is deliberately blocked in every FORWARD ledger, even if a start request is authorized. The frozen Binance spot research candidate failed profitability checks and has not been validated on Kraken BTC/USD. No order endpoint, exchange key, private exchange API, real-money mode, betting receiver, legacy webhook or database dependency exists here.

## Exact deployment target, after approval

Existing connected repository verified read-only from Railway: `Smilinglion808s/btcpredictionlol`. Existing services include sources on `main` and default-branch sources. Existing production environment: `7ad75c03-b76a-4506-978b-4baddde54884`, project `5f99de1c-2821-4e3e-b218-745f0385fbee`. Reuse the existing authorized repository connection after verifying `main` is the intended current branch. No new GitHub connection or credential export is needed or authorized by this package.

Add ONLY this subtree as `services/dot-paper-worker/` in that repository. Do not edit old service roots, V1/V2/V3 packages, receivers, webhooks, betting tables or volumes. Local package upload / repository publication / Lovable external-agent edit / deployment each still needs the parent's authorization flow. No remote write has been performed.

- New dedicated service: `dot-paper-observer`.
- Source root: `/services/dot-paper-worker`; Dockerfile path `Dockerfile` relative to root; start `python -I /app/worker/bootstrap.py` from `/app`.
- One region, one replica. Proposed `us-west2` must be accepted by Railway for this new service; do not change other regions/services.
- Dedicated 1 GB volume at `/data/dot-paper`. The runtime mount is root-owned. The reviewed fixed-identity bootstrap creates only its `ledger/` child owned by UID/GID10001, then permanently drops privileges before application import. `DOT_PAPER_DATA_DIR=/data/dot-paper/ledger`; do not chown the volume root or any existing files.
- `DOT_PAPER_BIND=0.0.0.0`; Railway provides `PORT`.
- Default `DOT_PAPER_FEED_ENABLED=false`, `DOT_PAPER_FEED_RIGHTS_APPROVED=false`, `DOT_PAPER_CONTROLS_ENABLED=false`.
- Set only the two feed flags to `true` after approval for a PRIVATE Kraken keyless BTC/USD observer. No paper trades then become possible: execution is blocked in code for FORWARD.
- First canary: `DOT_PAPER_OBSERVER_SECONDS=3600`, `restartPolicyType=NEVER`, service-only `limits={memoryGB:0.5,vCPUs:0.5}`, `regions={us-west2:{numReplicas:1}}`, `overlapSeconds=0`, `drainingSeconds=10`, `sleepApplication=false`. Fractional limits are exposed as numeric fields in the connected API but not mutation-tested; if rejected, stop and reprice, never silently increase.
- Health `/health`, timeout 30 s. Health is process liveness, not profitable strategy/readiness. Verify `/api/v1/snapshot` has `provenance=FORWARD`, correct run UUID, empty trade/call/equity arrays, feed disabled, unknown marked equity before enabling observation.
- Initial Docker image is `python:3.12-slim`. No Docker daemon was available in this workspace; container build and mount permissions remain untested. Record the resolved base image digest and resulting image digest during the approved build. Dependencies are exact-version pinned to the tested environment, but the current lock does not include wheel hashes.

## Run locally (no network feed)

From this subtree:

    python -m pip install -r requirements-test.lock
    python -m unittest discover -s worker/tests -t . -v
    DOT_PAPER_DATA_DIR=/tmp/dot-paper-empty DOT_PAPER_FEED_ENABLED=false python -m worker.main

Tests use generated `TEST` ledgers in temporary directories; they are never promoted, copied into `/data`, or served by the production API. `requirements-test.lock` adds only HTTP test transport. No broker simulation fixture is bundled into a fresh live ledger.

## Public and owner surfaces

Public GET only: `/health`, `/api/v1/snapshot`, `/api/v1/status`, `/api/v1/config`, `/api/v1/positions`, `/api/v1/trades`, `/api/v1/calls`, `/api/v1/equity`. `limit` is clamped 1–200; `before` is an exclusive numeric row cursor. Standalone pages return `run_id` and `provenance` so UI must discard cross-run pages. Snapshot nested pages inherit snapshot run identity. Raw feed observations, internal audit, lease owner, storage paths and exception text are not public. Raw bid/ask/depth/spread are suppressed because private source-observation permission does not grant public redistribution. Public results are synthetic PAPER only, never account balances.

UI integration: same-origin GET-only TanStack proxy with server-only `DOT_PAPER_SERVICE_URL`. Never expose credentials. The current app is public, so this observer page does not invent an owner/login requirement or change existing app access.

`POST /api/v1/control` accepts only `start`, `pause`, `reset_circuit_breaker`, UUID idempotency key. It is disabled by default and does not have a UI control. Future owner enablement requires a verified existing issuer and exact owner subject, both currently UNKNOWN. Auth uses pinned HTTPS public JWKS, RS256/ES256 allowlist, issuer/audience/expiry/iat/nbf, non-anonymous authenticated role, exact subject. No HMAC shared JWT secret or admin key is needed. JWT revocation is bounded by token expiry/cached public keys; this design does not perform session-database revocation checks. Even a valid control cannot activate unvalidated FORWARD entries in this build.

## Observation and source identity

Only `wss://ws.kraken.com/v2`, channels `ticker` with `event_trigger=bbo`, and `trade`, BTC/USD, are implemented. There is no Binance live route or alternate host. Decimal JSON is parsed as Decimal before integer conversion. Quote time is provider ticker timestamp; ticker has no native sequence, so its sequence is explicitly LOCAL_RECEIPT and monotonically resumes from durable high-water state. Heartbeats never refresh quote freshness. Trade IDs are provider per-book sequences; duplicates are idempotent, conflicts/out-of-order data fail closed, gaps are audited and not silently reconstructed. Trade snapshots are not treated as complete history.

Current Kraken BBO ticker does not promise size-only updates. It is observational, not sufficient certification of executable depth. A future paper-fill release needs an approved depth/checksum adapter, eligible-source history, signal aggregation/completeness audit and separately reviewed source/cost/config identity. Historical Binance BTC/USDT strategy hashes remain research identities; they are not Kraken validation. Kraken scenario fee is 80 bps taker/side, actual user tier unknown. No claims of institutional HFT or guaranteed fills.

Private observations are bounded: first of a persisted 1–86400-second deadline, 250,000 observed trades,500,000 quote observations, or approximately 512 MiB ledger-related files stops capture. Deadline survives restart; restart never extends the window. The process exits after reaching that limit when launched through `main.py`; `NEVER` restart policy is required for the first canary. Quotes and trades are privately captured with source and receipt times. Quote history includes monotonic receipt, per-connection UUID, durable local receipt sequence, freshness/rejection status and session/event-hash idempotence. Only the current quote is used by the simulator. No observer trade becomes a paper-ledger trade or strategy call. Completed-source 1s→15s aggregation helper requires all 15 real source rows and rejects gaps; it is not activated from reconstructed Kraken raw trades.

## Persistence and recovery

SQLite WAL, `synchronous=FULL`, one local volume and one writer process. Exclusive OS file lock plus transactional owner/epoch lease fencing; one replica only, no network-filesystem WAL. Lease is renewed by a one-second maintenance task. Expired/fenced writers stop mutations. On restart: retain committed open position and totals, cancel pending entries, require new quotes, pause requested execution. Pending exits remain and use first eligible fresh quote, never a guessed historical exit. New run UUID is generated only for a new ledger. Config, strategy and artifact hash mismatches refuse to open an existing ledger; never erase/relabel history to get past that guard. Config upgrades need a separately reviewed migration or separate new ledger. Operator backup uses SQLite backup API or clean shutdown and copies all required WAL files; never copy only the live `.sqlite3` file.

Transactional aggregates make account marking O(1), independent of trade count; all trade rows and aggregates commit in the same transaction. Unique call IDs, unique position/trade IDs and atomic closes prevent duplicate trades. Planned risk, planned stop distance risk, entry notional, model version, symbol and all fill timestamps remain attached to closed trades. Public equity points are actual fresh paper-ledger marks, empty at initialization; stale data makes current equity unknown and cannot generate entries or substitute flat profits.

## Execution-laboratory assumptions (TEST only in this release)

LONG-only cash spot, no borrowing/leverage, at most one position. Initial synthetic capital 10,000 units, max notional 10% equity, risk budget 8 bps equity. Risk sizing includes stop distance plus fee/slippage allowance; stop risk is a PLAN, not a guaranteed loss cap. Entries require a new fresh quote after a 1-second delay; ordinary signal exits 1 second; protective exits 250 ms. Freshness ≤2 seconds, max entry spread 10 bps, entry timeout 5 seconds, max 10% of displayed top quantity. Entry buys ask plus adverse 1.5 bps; exit sells bid minus adverse 1.5 bps. Fees are charged on BOTH legs, no assumed maker/zero-fee fills. Exact integer micros/satoshis and conservative rounding determine win/loss/flat from entry-to-exit NET P&L.

Daily 1% marked-equity loss is a latched ENTRY halt until the next UTC day; it does not liquidate by itself. Total 5% peak drawdown escalates even when a daily halt already exists, forces a protective exit, and cannot be reset by daily controls. Existing STOP/TARGET/MAX_HOLD exits continue during pause/staleness once actual fresh quotes arrive. An ordinary max-hold decision occurs at the first closed 15-second boundary at/after 300 seconds, filled at least 1 second later. Independent missing-bar emergency intent at 316 seconds uses a further 250 ms quote delay; that safeguard and real quote depth are not certified by the 1s historical proxy replay. Outages can cause gaps, worse exits and losses above planned stop risk.

## Canary cost / stop plan

Current verified Railway container rates (2026-10-07): RAM $10/GB/month, CPU $20/vCPU/month, volume $0.15/GB/month, egress $0.05/GB. Source: https://docs.railway.com/pricing/plans . Service-level limits: https://docs.railway.com/pricing/cost-control . At proposed full 0.5 GB/0.5 vCPU limits plus 1 GB volume: about $15.15/month, $0.51/day, $0.021/hour BEFORE egress; plan credits may reduce incremental billing. Idle local smoke process used ~44.5 MiB RSS; actual deployed CPU/RAM/storage/network must be measured. Expected small observer process is roughly 50–150 MiB and 0.01–0.1 average vCPU, an unverified planning estimate, not an invoice promise.

First request: authorize an isolated ONE-HOUR private observer canary, code/source publication, new service+1GB volume and public sanitized read-only URL, with quoted resource limits. No payment method creation/credential transfer/plan change is included. There is no hard dollar cap: public GET traffic/egress and retained volume can continue to cost money. Do not set a workspace-wide hard spend limit because it could stop legacy live services. Check service-only metrics 5 minutes after start and at 1 hour; if memory/CPU throttling or unexpected bandwidth appears, stop this dedicated service only. The observer's persistent expiry exits this process; verify deployment stopped and restart policy NEVER. If health/deployment behavior restarts it unexpectedly, remove/stop only the dedicated deployment. Keep its volume for audit unless separate deletion is approved. Retained 1GB volume can still cost ~$0.15/month.

## Verification boundaries

68 unit/integration/process/security tests passed, with additional hardening tests tracked in `verification/backend-tests.txt`. Tests cover paper-only enforcement, exact costs/cash reconciliation, stale/out-of-order/future data, latency/depth gates, restart recovery, two-writer/fencing, duplicate closes, circuit escalation, owner JWT boundary, run isolation, empty default process and observer parsing. The 10k-row fixture benchmark measured ~0.05–0.08 ms per quote transaction on this local filesystem, excluding network, exchange delays, container overhead and production contention. No live Kraken connection, remote Docker build, mounted-volume permission test, deploy, production traffic load test, auth with the actual owner, or profitable forward result has been claimed.

## Approved-canary sequencing and legacy-trigger review

The owner approved the separate one-hour observer canary with up to $1 incremental usage, no hard per-service dollar cap, and retained ~ $0.15/month volume. Parent coordination still owns commit publication and deployment. No additional credentials, account subscriptions, trading or legacy service changes are authorized.

Use `create_service` with NO image/source to create an empty new service, then set its exact root/build/start/health, single-region replica, limits, NEVER restart, no overlap, feed=false and dedicated volume. Confirm all settings and the disabled first-boot configuration before connecting any source. `connect_service_source` builds immediately; use an exact reviewed commit pin once source publication is approved. Do NOT use `create_deployment` as the first call, because it triggers a repository-root build before the dedicated root and limits are configured. First disabled boot must produce an empty forward ledger and no market connection. Only then set the two observer feed flags to true and restart that service, keeping the one-hour persisted observer limit and NEVER restart. No feed is enabled before these protections are verified.

Existing service auto-trigger settings, inspected read-only 2026-10-07:
- V2: `/services/v2-worker/**` watch pattern.
- V12: `/services/v12-worker/**` watch pattern; current source also has a commit pin.
- V3: `/services/v3-worker/**` watch pattern.
- c85-worker: no watchPatterns returned.
- binance-ob-collector-oz7E: no watchPatterns returned.
- btcpredictionlol root service: no watchPatterns returned.

Therefore a `main` commit may restart the latter three services even if their files are unchanged. Publishing only isolated files is not proof of deployment isolation. Do not change their settings without specific approval, and do not claim their deployments are untouched unless verified after publishing. A separate branch or separately authorized safe publication route is preferable; actual source/branch route must be available and verified, not assumed.

Observer access denials (subscription rejection or HTTP401/403/451 during handshake) stop the process without alternate-provider/host retries. Transient disconnects use bounded exponential reconnect intervals while the persisted canary deadline remains active. A provider status other than `online` prevents subsequent quote messages from being marked fresh until online status is observed again.


## Reviewed startup privilege boundary

Railway officially documents runtime volumes as root-owned and unavailable during build/pre-deploy: https://docs.railway.com/volumes#permissions . Image-time chown cannot prepare the mounted filesystem. This package uses a narrowly scoped root bootstrap rather than running the application as root or setting a broad runtime security override.

`Dockerfile` starts `python -I /app/worker/bootstrap.py` as root. It imports ONLY Python standard-library modules. Source files and `/app` remain root-owned/non-writable to the application. Bootstrap pins the exact project/environment/service ID, volume name `dot-paper-data` and mount `/data/dot-paper`; verifies a writable real mount and refuses symlinks, wrong owners/modes, unexpected root contents, foreign/unmarked nonempty data, unsafe existing files and marker mismatch. It only creates/chowns the new EMPTY child `ledger/` to10001:10001 with mode0700 and writes a root-owned0600 volume identity marker. It does not traverse filesystem recovery data or recursively change ownership. Existing ledger files must already have the expected owner, single link, private permissions and recognized names.

Before any feed/API dependency is imported, bootstrap enables Linux no_new_privs, clears supplementary groups, sets GID/UID10001, verifies real/effective/saved IDs, then execs `python -B -E -m worker.main` from root-owned `/app`. The main module rejects root or wrong Railway UID/GID before third-party imports. No remote security setting was changed. Runtime verifies the successful log line `DOT_PAPER_BOOTSTRAP_UID=10001 GID=10001`, ability to create/reopen the empty ledger, and absence of privileged app operation. Actual root/container privilege transition remains untested here because local execution UID is1000 and Docker is unavailable; unit tests mock privilege calls and validate their order/failure behavior, while filesystem refusal cases run on real temporary directories.

Capture expiry is checked before consuming each message, before individual batched rows and again at quote transaction boundary. Reads, subscription sends, connect and retry waits are bounded by remaining time. A monotonic deadline prevents wall-clock regression extending this process's time; durable time high-water also advances while disconnected/quiet and survives restart. Regression stops capture. All WebSocket redirects are refused before following them, including same-host redirects; HTTP401/403/451 and subscription denial terminate without retry. Observer exceptions also terminate the dedicated process instead of leaving an idle failed canary running.
