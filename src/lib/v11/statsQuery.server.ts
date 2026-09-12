// Version 1.1 dashboard figures.
//
// Read-only. Live evidence and research/recovery evidence are counted
// SEPARATELY and never merged: only rows the observer earned the LIVE_SHADOW
// label for can appear as live. Grading uses the official settled label only;
// an unsettled interval stays pending rather than being scored.

import { createClient } from "@supabase/supabase-js";
import {
  V11_CANDIDATE_VERSION,
  V11_MODEL_VERSION,
  V11_POLICY_VERSION,
  V11_PUBLICATION_MODE,
  V11_RUN_MODES,
  V11_STAKE_FRACTION_OF_BOISE_OPEN,
} from "./config";
import { v1DeliveryDisabled, v11ServerExecutionEnabled } from "./dispatch.server";
import { countActiveEndpointsForEvent } from "@/lib/webhooks.server";
import { liteaDedupeKey } from "@/lib/litea/webhook.server";



export interface V11LegRecord {
  calls: number;
  wins: number;
  losses: number;
  pending: number;
  winRate: number | null;
  netWins: number;
}

export interface V11Stats {
  modelVersion: string;
  candidateVersion: string;
  policyVersion: string;
  publicationMode: string;
  stakeFractionOfBoiseOpen: number;
  sizingOwner: string;
  /** True only when V11_SERVER_EXECUTION_ENABLED=true AND V1 delivery is off. */
  dispatchEnabled: boolean;
  /**
   * Truthful, read-only operator view of the delivery configuration. This
   * describes what THIS project would do, never what the external betting bot
   * does with a message it receives.
   */
  control: {
    /** V11_SERVER_EXECUTION_ENABLED=true */
    v11FlagSet: boolean;
    /** The original Version 1 sender is off (required for the combined route). */
    v1DeliveryOff: boolean;
    /** Both server conditions hold. */
    armed: boolean;
    /** Active destinations subscribed to prediction.created. Never any URL. */
    activeEndpoints: number;
    /** Armed AND exactly one destination: a message would actually be sent. */
    wouldSend: boolean;
    status:
      | "PAUSED_NO_FLAG"
      | "BLOCKED_V1_SENDER_ON"
      | "ARMED_NO_DESTINATION"
      | "ARMED_MULTIPLE_DESTINATIONS"
      | "ARMED_DELIVERY_CONFIGURED";
  };


  phase: "PREPARING" | "RECORDING_ONLY" | "LIVE_SHADOW";
  headDate: string | null;
  headQuarantined: boolean;
  latest: {
    targetTs: string | null;
    runMode: string | null;
    leg: string | null;
    side: number;
    reason: string | null;
    rank: number | null;
    probability: number | null;
  } | null;
  live: {
    opportunities: number;
    scored: number;
    coverage: number | null;
    combined: V11LegRecord;
    v1Leg: V11LegRecord;
    fallbackLeg: V11LegRecord;
    today: V11LegRecord;
  };
  research: {
    opportunities: number;
    combined: V11LegRecord;
    v1Leg: V11LegRecord;
    fallbackLeg: V11LegRecord;
  };
  aggregation: {
    decisionsCounted: number;
    maxWindow: number;
    truncated: boolean;
    oldestTargetTs: string | null;
    newestTargetTs: string | null;
    timezone: "America/Boise";
  };
  history: {
    targetTs: string;
    runMode: string;
    leg: string | null;
    side: number;
    reason: string;
    rank: number | null;
    label: number | null;
    outcome: "WIN" | "LOSS" | "PENDING" | "NO_CALL";
    /** True only when a webhook delivery for this interval returned HTTP 2xx. */
    sent: boolean;
  }[];
}

/** Rows per page, and the honest ceiling of the aggregation window. */
const V11_STATS_PAGE = 1000;
const V11_STATS_MAX_PAGES = 12;
/** Keep timestamp filters below the runtime's HTTP header ceiling. */
const V11_LABEL_BATCH_SIZE = 100;

/** Trading day is Boise, matching the daily floor the strategy is defined on. */
const boiseFmt = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Boise",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});
const boiseDate = (d: Date): string => boiseFmt.format(d);

const emptyRecord = (): V11LegRecord => ({
  calls: 0,
  wins: 0,
  losses: 0,
  pending: 0,
  winRate: null,
  netWins: 0,
});

function finish(r: V11LegRecord): V11LegRecord {
  const settled = r.wins + r.losses;
  return {
    ...r,
    winRate: settled > 0 ? r.wins / settled : null,
    netWins: r.wins - r.losses,
  };
}

/** A ±1 call is graded ONLY against a matching official label. */
function grade(
  r: V11LegRecord,
  side: number,
  label: number | null | undefined,
): void {
  if (side !== 1 && side !== -1) return;
  r.calls++;
  if (label !== 1 && label !== -1) {
    r.pending++;
    return;
  }
  if (label === side) r.wins++;
  else r.losses++;
}

export async function buildV11Stats(): Promise<V11Stats> {
  const sb = createClient(
    process.env["SUPABASE_URL"]!,
    process.env["SUPABASE_SERVICE_ROLE_KEY"]!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );

  // Aggregation window, paged. Every decision counted here is also LABELLED
  // here: a row whose label was never fetched must not be reported as pending.
  const decisions: Record<string, unknown>[] = [];
  for (let page = 0; page < V11_STATS_MAX_PAGES; page++) {
    const from = page * V11_STATS_PAGE;
    const { data: rows, error } = await sb
      .from("v11_decisions")
      .select("target_ts, run_mode, leg, side, reason, rank, probability, ticker")
      .order("target_ts", { ascending: false })
      .range(from, from + V11_STATS_PAGE - 1);
    if (error) throw error;
    const batch = (rows ?? []) as Record<string, unknown>[];
    decisions.push(...batch);
    if (batch.length < V11_STATS_PAGE) break;
  }

  const tsList = decisions.map((d) => new Date(d.target_ts as string).toISOString());
  const labels = new Map<string, number | null>();
  for (let i = 0; i < tsList.length; i += V11_LABEL_BATCH_SIZE) {
    const { data: ctx, error: cErr } = await sb
      .from("v11_context_rows")
      .select("target_ts, label")
      .in("target_ts", tsList.slice(i, i + V11_LABEL_BATCH_SIZE));
    if (cErr) throw cErr;
    for (const row of (ctx ?? []) as Record<string, unknown>[]) {
      labels.set(
        new Date(row.target_ts as string).toISOString(),
        row.label === null || row.label === undefined ? null : Number(row.label),
      );
    }
  }

  const { data: headRows, error: hErr } = await sb
    .from("v11_heads")
    .select("fit_date, quarantined")
    .order("fit_date", { ascending: false })
    .limit(1);
  if (hErr) throw hErr;
  const head = (headRows ?? [])[0] as Record<string, unknown> | undefined;

  const live = {
    opportunities: 0,
    scored: 0,
    combined: emptyRecord(),
    v1Leg: emptyRecord(),
    fallbackLeg: emptyRecord(),
    today: emptyRecord(),
  };
  const research = {
    opportunities: 0,
    combined: emptyRecord(),
    v1Leg: emptyRecord(),
    fallbackLeg: emptyRecord(),
  };

  const todayBoise = boiseDate(new Date());
  const history: V11Stats["history"] = [];

  // Successful transmissions, matched to intervals by the shared dedupe key.
  // A row is "sent" ONLY on a real HTTP 2xx response recorded in the delivery
  // ledger — never inferred from flags, claims, or configuration.
  const sentKeys = new Set<string>();
  {
    const { data: deliveries, error: dErr } = await sb
      .from("webhook_deliveries")
      .select("payload, status_code")
      .eq("event", "prediction.created")
      .gte("status_code", 200)
      .lt("status_code", 300)
      .order("delivered_at", { ascending: false })
      .limit(500);
    if (dErr) throw dErr;
    for (const row of (deliveries ?? []) as Record<string, unknown>[]) {
      const key = (row.payload as Record<string, unknown> | null)?.["dedupe_key"];
      if (typeof key === "string" && key) sentKeys.add(key);
    }
  }

  for (const d of decisions) {
    const ts = new Date(d.target_ts as string).toISOString();
    const runMode = (d.run_mode as string) ?? V11_RUN_MODES.RESEARCH;
    const side = Number(d.side ?? 0);
    const leg = (d.leg as string | null) ?? null;
    const label = labels.get(ts) ?? null;
    const isLive = runMode === V11_RUN_MODES.LIVE;

    if (isLive) {
      live.opportunities++;
      if (d.probability !== null && d.probability !== undefined) live.scored++;
      grade(live.combined, side, label);
      if (leg === "V1") grade(live.v1Leg, side, label);
      if (leg === "T45R2") grade(live.fallbackLeg, side, label);
      if (boiseDate(new Date(ts)) === todayBoise) grade(live.today, side, label);
    } else {
      research.opportunities++;
      grade(research.combined, side, label);
      if (leg === "V1") grade(research.v1Leg, side, label);
      if (leg === "T45R2") grade(research.fallbackLeg, side, label);
    }

    if (history.length < 40) {
      const ticker = String(d.ticker ?? "");
      history.push({
        targetTs: ts,
        runMode,
        leg,
        side,
        sent:
          (side === 1 || side === -1) &&
          ticker !== "" &&
          sentKeys.has(liteaDedupeKey(ticker, ts)),
        reason: (d.reason as string) ?? "",
        rank: d.rank === null || d.rank === undefined ? null : Number(d.rank),
        label,
        outcome:
          side !== 1 && side !== -1
            ? "NO_CALL"
            : label !== 1 && label !== -1
              ? "PENDING"
              : label === side
                ? "WIN"
                : "LOSS",
      });
    }
  }

  const latest = decisions[0];
  const phase: V11Stats["phase"] =
    live.opportunities > 0 && live.scored > 0
      ? "LIVE_SHADOW"
      : decisions.length > 0
        ? "RECORDING_ONLY"
        : "PREPARING";

  // Delivery configuration, read only. Counting destinations never exposes a
  // URL, a secret or an endpoint id, and nothing here activates anything.
  const v11FlagSet = v11ServerExecutionEnabled();
  const v1DeliveryOff = v1DeliveryDisabled();
  const armed = v11FlagSet && v1DeliveryOff;
  const activeEndpoints = await countActiveEndpointsForEvent(
    sb as never,
    "prediction.created",
  ).catch(() => 0);


  return {
    modelVersion: V11_MODEL_VERSION,
    candidateVersion: V11_CANDIDATE_VERSION,
    policyVersion: V11_POLICY_VERSION,
    publicationMode: V11_PUBLICATION_MODE,
    stakeFractionOfBoiseOpen: V11_STAKE_FRACTION_OF_BOISE_OPEN,
    sizingOwner: "external-betting-bot",
    dispatchEnabled: armed,
    control: {
      v11FlagSet,
      v1DeliveryOff,
      armed,
      activeEndpoints,
      wouldSend: armed && activeEndpoints === 1,
      status: !v11FlagSet
        ? "PAUSED_NO_FLAG"
        : !v1DeliveryOff
          ? "BLOCKED_V1_SENDER_ON"
          : activeEndpoints === 0
            ? "ARMED_NO_DESTINATION"
            : activeEndpoints > 1
              ? "ARMED_MULTIPLE_DESTINATIONS"
              : "ARMED_DELIVERY_CONFIGURED",
    },

    phase,
    headDate: (head?.fit_date as string | null) ?? null,
    headQuarantined: head?.quarantined === true,
    latest: latest
      ? {
          targetTs: new Date(latest.target_ts as string).toISOString(),
          runMode: (latest.run_mode as string) ?? null,
          leg: (latest.leg as string | null) ?? null,
          side: Number(latest.side ?? 0),
          reason: (latest.reason as string) ?? null,
          rank: latest.rank === null || latest.rank === undefined ? null : Number(latest.rank),
          probability:
            latest.probability === null || latest.probability === undefined
              ? null
              : Number(latest.probability),
        }
      : null,
    live: {
      opportunities: live.opportunities,
      scored: live.scored,
      coverage:
        live.opportunities > 0 ? live.combined.calls / live.opportunities : null,
      combined: finish(live.combined),
      v1Leg: finish(live.v1Leg),
      fallbackLeg: finish(live.fallbackLeg),
      today: finish(live.today),
    },
    research: {
      opportunities: research.opportunities,
      combined: finish(research.combined),
      v1Leg: finish(research.v1Leg),
      fallbackLeg: finish(research.fallbackLeg),
    },
    aggregation: {
      decisionsCounted: decisions.length,
      maxWindow: V11_STATS_PAGE * V11_STATS_MAX_PAGES,
      truncated: decisions.length >= V11_STATS_PAGE * V11_STATS_MAX_PAGES,
      oldestTargetTs: tsList.length > 0 ? tsList[tsList.length - 1]! : null,
      newestTargetTs: tsList.length > 0 ? tsList[0]! : null,
      timezone: "America/Boise",
    },
    history,
  };
}
