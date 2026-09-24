# Capability check result — no action taken

The user asked a read-only capability question. Findings (already delivered in chat):

1. `deploy_edge_functions` deploys by function name only, from `supabase/functions/` in this project. It cannot accept supplied source files or a Git ref. There is no deploy path that leaves the default branch untouched; the r3 adapter change stays undeployed until applied through the user's normal flow. No workaround will be attempted.
2. Signed readiness probes to the three receiver endpoints are already supported by the deployed adapter's `probe` op: deliberately invalid signed payloads, receivers answer 400 ROUTE_POLICY_MISMATCH, zero signal/bet records written, secret never exposed.

## Plan

No code, file, deployment, database, or live-control changes. This plan records the capability answer only.

- Take no action on the V1.2 adapter r3 code.
- Do not modify, commit, or push anything.
- No real-money activation; receivers remain behind their shadow release gate.
- If the user later wants a readiness check, run one signed `probe` (and optionally `context`) against the deployed adapter and report only status-level results.
