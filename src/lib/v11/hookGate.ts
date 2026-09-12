// Version 1.1 boundary-hook admission gate (pure).
//
// The signed collector trigger is the ONLY caller allowed to create the V11
// observation for a target inside the 60-second publication ceiling. Unsigned
// callers (cron watchdog / manual `mode=recover`) arriving inside that window
// must not run the observer at all: the observation row is immutable, so an
// early unsigned RECOVERY write would permanently mislabel a healthy on-time
// interval and block the later signed LIVE_SHADOW trigger.
//
// After the ceiling, unsigned callers may truthfully recover still-unobserved
// targets as RECOVERY. Already-recorded rows are never promoted.

import { V11_PUBLICATION_CEILING_MS } from "./config";

export type V11HookGate =
  | { run: true; reason: "SIGNED_COLLECTOR" | "AFTER_CEILING_RECOVERY" }
  | { run: false; reason: "RESERVED_FOR_SIGNED_COLLECTOR" };

export function v11ObservationGate(args: {
  signed: boolean;
  targetMs: number;
  nowMs: number;
  ceilingMs?: number;
}): V11HookGate {
  const ceiling = args.ceilingMs ?? V11_PUBLICATION_CEILING_MS;
  if (args.signed) return { run: true, reason: "SIGNED_COLLECTOR" };
  const elapsed = args.nowMs - args.targetMs;
  if (elapsed < ceiling) return { run: false, reason: "RESERVED_FOR_SIGNED_COLLECTOR" };
  return { run: true, reason: "AFTER_CEILING_RECOVERY" };
}
