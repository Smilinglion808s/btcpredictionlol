type Props = { data: any; error: boolean };

const GATE = 0.7;
const side = (d: number | null) => (d === 1 ? "UP" : d === -1 ? "DOWN" : "—");
const pct = (v: number | null | undefined, digits = 1) => (v == null ? "—" : `${(v * 100).toFixed(digits)}%`);
const signed = (n: number) => `${n > 0 ? "+" : ""}${n}`;
const ago = (iso: string | undefined, now: number) => {
  if (!iso) return "never";
  const s = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  return s < 90 ? `${s}s ago` : s < 5400 ? `${Math.round(s / 60)}m ago` : `${Math.round(s / 3600)}h ago`;
};
const STATUS_TEXT: Record<string, string> = {
  SELECTED: "Call made",
  AWAIT_T30: "Waiting for 30s check",
  NO_CALL: "No call",
  FAIL_CLOSED: "Skipped (safety)",
  EXPIRED_UNSENT: "Call made · not sent",
};

export function V3Card({ data, error }: Props) {
  const now: number = data?.serverNow ?? Date.now();
  const openMs = Math.floor(now / 900_000) * 900_000;
  const open = new Date(openMs).toISOString();
  const rt = data?.runtime;
  const st = rt?.status ?? {};
  const connected = rt ? now - Date.parse(rt.updated_at) < 120_000 : false;
  const ready = connected && st.prediction_ready === true;
  const rec = data?.record;
  const dayNet = Number(rec?.today?.net ?? 0);
  const totNet = Number(rec?.total?.net ?? 0);
  const decisions: any[] = data?.decisions ?? [];
  const cur = decisions.find((d) => new Date(d.candle_open).toISOString() === open);
  const elapsed = Math.floor((now - openMs) / 1000);
  const badge = error ? "Status unavailable" : !rt ? "Not reporting to dashboard yet" : !connected ? `Worker silent ${ago(rt.updated_at, now)}` : ready ? "Ready to predict" : "Connected · not ready";
  const sending = st.delivery_enabled === true;
  const calibration = st.calibration_tracking;
  const ct = calibration?.total;
  const calibrationMode = st.calibration_mode;
  const historyWeeks = st.calibration_history_start_s == null ? 0 :
    Math.max(0, (now / 1000 - st.calibration_history_start_s) / 604800);
  const calibrationLabel = !calibrationMode ? "Not reporting yet" : calibrationMode === "off" ? "Off" :
    !connected ? "Status stale" : calibrationMode === "shadow" ?
    (st.calibration_ready ? "Shadow · scoring" : "Shadow · collecting history") :
    (st.calibration_ready ? "Active filter" : "Blocked · not ready");
  const calibrationActions: Record<string, string> = {
    KEEP_BASELINE: "Keep V3 call", SKIP_BASELINE: "Skip V3 call", ADD_LOWER60: "Add lower-threshold call",
    DECLINE_LOWER60: "Decline extra call", NO_RISK_PASSED_CANDIDATE: "No eligible candidate",
    CALIBRATION_HEAD_MISSING: "Collecting history · no calibrated score yet",
  };

  return (
    <section className="v3-shell self-start p-5 sm:p-6 space-y-5">
      <span className="v3-border" aria-hidden />

      <header className="relative flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="mb-1 text-[9px] font-semibold uppercase tracking-[0.3em] text-plasma/80">
            Price-flow · first 15s / 30s
          </div>
          <h3 className="v3-title text-5xl font-heading font-black tracking-tight leading-none">Version 3</h3>
          <div className="mt-2 inline-flex items-center gap-1.5 rounded-full border border-plasma/40 bg-plasma/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.1em] text-plasma-foreground">
            <span className={`size-1.5 rounded-full ${ready ? "bg-plasma v3-live" : connected ? "bg-ember" : "bg-muted-foreground"}`} />
            {badge}
          </div>
        </div>
        <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-[0.12em] ${sending ? "border-ember/60 bg-ember/15 text-ember" : "border-plasma/30 bg-plasma/5 text-plasma-foreground/80"}`}>
          {sending ? "Sending on" : "Sending off"}
        </span>
      </header>

      <section className="relative flex flex-wrap items-center gap-4 sm:gap-5">
        <div className="flex items-center gap-3 sm:gap-4">
          <Ring value={rec?.total?.winRate ?? null} sub="total" />
          <Ring value={rec?.today?.winRate ?? null} sub="today" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex gap-6">
            {([["Net wins · today", dayNet, "text-5xl"], ["Net wins · total", totNet, "text-6xl"]] as const).map(([label, n, size]) => (
              <div key={label}>
                <div className="text-[9px] uppercase tracking-[0.2em] text-muted-foreground">{label}</div>
                <div className={`mt-1 font-mono ${size} font-bold tracking-tighter tabular-nums leading-none ${n > 0 ? "text-plasma" : n < 0 ? "text-ember" : "text-foreground"}`}>
                  {signed(n)}
                </div>
              </div>
            ))}
          </div>
          <div className="mt-1.5 text-[10px] text-muted-foreground">predictions, not bets</div>
        </div>
      </section>

      {rec?.streak?.length ? (
        <div className="flex items-center gap-1" aria-label="Recent results, newest first">
          {rec.streak.map((r: string, i: number) => (
            <span key={i} className={`h-2 flex-1 rounded-full ${r === "W" ? "bg-plasma" : "bg-ember/70"}`} style={{ opacity: 1 - i * 0.035 }} />
          ))}
        </div>
      ) : null}

      <div className="grid grid-cols-3 gap-2.5">
        <Stat k="Wins" v={String(rec?.total?.wins ?? 0)} />
        <Stat k="Losses" v={String(rec?.total?.losses ?? 0)} />
        <Stat k="Pending" v={String(rec?.total?.pending ?? 0)} />
        <Stat k="Today calls" v={`${rec?.today?.calls ?? 0}/${rec?.dayIntervals ?? 0}`} />
        <Stat k="Today win rate" v={pct(rec?.today?.winRate, 0)} />
        <Stat k="Coverage" v={pct(rec?.coverage, 0)} />
      </div>

      <section className="v3-chip p-4">
        <div className="flex items-center justify-between gap-2">
          <div className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">Current 15-minute interval</div>
          <span className="text-[10px] text-muted-foreground tabular-nums">{open.slice(5, 16).replace("T", " ")} UTC · {elapsed}s in</span>
        </div>
        <div className="mt-1.5 text-lg font-semibold">
          {cur?.status === "SELECTED" || cur?.status === "EXPIRED_UNSENT" ? (
            <span className="text-plasma-foreground">
              Call at {cur.checkpoint}s{" "}
              <span className={`rounded-md border px-1.5 py-0.5 text-xs ${cur.direction === 1 ? "border-plasma/60 bg-plasma/20" : "border-ember/60 bg-ember/20"}`}>{side(cur.direction)}</span>{" "}
              <span className="text-xs font-normal text-muted-foreground">rank {pct(cur.rank)}</span>
            </span>
          ) : (
            <span className="text-muted-foreground">{cur ? STATUS_TEXT[cur.status] ?? cur.status : elapsed < 15 ? "Watching the first 15 seconds…" : "No call yet"}</span>
          )}
        </div>
        <div className="mt-3 space-y-2">
          <Gate label="15s check" rank={cur?.t15_rank ?? null} />
          <Gate label="30s check" rank={cur?.t30_rank ?? null} />
        </div>
        <p className="mt-2 text-[9px] text-muted-foreground">Base selection requires 70% rank, then the reversal check at 45s. Eligible messages go out at 48s and expire at 49s.</p>
      </section>

      <section className="v3-chip p-4 space-y-3" aria-label="V3 risk calibration tracking">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h4 className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">Risk calibration · R3</h4>
          <span className="text-xs font-semibold text-plasma-foreground">{calibrationLabel}</span>
        </div>
        <p className="text-[11px] text-muted-foreground">
          {calibrationMode === "enforce" ? "Keeps base calls at 55% estimated correctness; admits extra candidates at 64%." :
            "Forward tracking only. Current V3 calls continue while calibration collects the required history."}
        </p>
        <div className="grid grid-cols-2 gap-2">
          <Stat k="History collected" v={`${Math.min(historyWeeks, 26).toFixed(1)} / 26 weeks`} />
          <Stat k="Settled candidates" v={String(st.calibration_settled_candidates ?? 0)} />
          <Stat k="Intervals observed" v={String(st.calibration_observations ?? 0)} />
          <Stat k="Calibrated decisions" v={String(ct?.scored ?? 0)} />
        </div>
        {st.calibration_ready === false && calibrationMode !== "off" ? (
          <p className="text-[10px] text-muted-foreground">{st.calibration_not_ready_reason === "CALIBRATION_26_WEEK_HISTORY_REQUIRED" ?
            "Needs 26 weeks of eligible candidate history and at least 500 settled candidates before scoring." :
            `Not ready: ${String(st.calibration_not_ready_reason ?? "awaiting status").toLowerCase().replaceAll("_", " ")}`}</p>
        ) : null}
        {calibration?.latest ? (
          <div className="border-t border-border/40 pt-2 text-xs">
            <div className="text-[9px] text-muted-foreground">Latest check · {new Date(calibration.latest.candle_s * 1000).toISOString().slice(5,16).replace("T", " ")} UTC</div>
            <div className="mt-1">{calibrationActions[calibration.latest.reason] ?? String(calibration.latest.reason ?? calibration.latest.status).toLowerCase().replaceAll("_", " ")}</div>
            {calibration.latest.p_correct != null ? <div className="text-muted-foreground">Estimated correctness {pct(calibration.latest.p_correct)} · {side(calibration.latest.candidate_side)}</div> : null}
          </div>
        ) : null}
        {ct?.scored > 0 ? (
          <div className="space-y-2 border-t border-border/40 pt-2">
            <div className="text-[9px] uppercase tracking-wider text-muted-foreground">Calibration forward record · finalized Kalshi outcomes</div>
            <div className="grid grid-cols-3 gap-2">
              <Stat k="Kept / added" v={`${ct.kept} / ${ct.added}`} />
              <Stat k="Skipped" v={String(ct.skipped)} />
              <Stat k="Pending" v={String(ct.pending)} />
              <Stat k="Wins / losses" v={`${ct.wins} / ${ct.losses}`} />
              <Stat k="Win rate" v={pct(ct.win_rate)} />
              <Stat k="Net wins" v={signed(ct.net)} />
            </div>
            <p className="text-[10px] text-muted-foreground">Boise {calibration.boise_day}: {calibration.today.wins}W / {calibration.today.losses}L · net {signed(calibration.today.net)}. {calibrationMode === "shadow" ? "Hypothetical calls; no extra webhooks sent." : "Prediction results, not fills or profit."}</p>
          </div>
        ) : <p className="text-[10px] text-muted-foreground">Forward win rate appears after calibrated calls settle. Historical lab results are not included.</p>}
        {calibration?.asof_s ? <p className="text-[9px] text-muted-foreground">Tracking updated {ago(new Date(calibration.asof_s * 1000).toISOString(), now)}</p> : null}
      </section>

      <div className="grid grid-cols-2 gap-2.5">
        <Stat k="Prediction ready" v={!connected ? "no heartbeat" : st.prediction_ready ? "yes" : "no"} />
        <Stat k="Price feed" v={st.feed_age_ms == null ? "not reported" : `${st.feed_age_ms < 3000 ? "fresh" : "stale"} · ${(st.feed_age_ms / 1000).toFixed(1)}s`} />
        <Stat k="Clock" v={st.clock_skew_ms == null ? "not checked" : `${Math.abs(st.clock_skew_ms) <= 1000 ? "ok" : "off"} · ${st.clock_skew_ms} ms`} />
        <Stat k="Today's model" v={st.fit_today ? (st.fit_today["15"] && st.fit_today["30"] ? "trained" : "missing") : "not reported"} />
        <Stat k="History" v={st.caught_up == null ? "not reported" : st.caught_up ? "caught up" : "catching up"} />
        <Stat k="Mode" v={st.mode ? String(st.mode) : "—"} />
      </div>
      {connected && st.not_ready_reasons?.length ? (
        <p className="text-[10px] text-ember">Not ready: {st.not_ready_reasons.join(", ").toLowerCase().replaceAll("_", " ")}</p>
      ) : null}

      {rec?.daily?.length ? (
        <section className="v3-chip p-3">
          <div className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground mb-1.5">Daily record (Boise)</div>
          <div className="max-h-56 overflow-auto">
            <table className="w-full text-xs tabular-nums">
              <thead className="text-[9px] uppercase tracking-wider text-muted-foreground">
                <tr><th className="text-left font-normal">Day</th><th className="text-right font-normal">W-L</th><th className="text-right font-normal">Net</th><th className="text-right font-normal">Win %</th></tr>
              </thead>
              <tbody>
                {rec.daily.map((d: any) => (
                  <tr key={d.day} className="border-t border-border/40">
                    <td className="py-1">{d.day.slice(5)}</td>
                    <td className="text-right">{d.wins}-{d.losses}</td>
                    <td className={`text-right font-semibold ${d.net > 0 ? "text-plasma" : d.net < 0 ? "text-ember" : ""}`}>{signed(d.net)}</td>
                    <td className="text-right">{pct(d.winRate, 1)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}
      <p className="text-[9px] text-muted-foreground/80">
        Results graded from confirmed 15-minute candles (close vs open); today = Boise day. Bet size, price and odds are set by the betting app.
      </p>
    </section>
  );
}

function Gate({ label, rank }: { label: string; rank: number | null }) {
  const p = rank == null ? 0 : Math.max(0, Math.min(1, rank));
  const hit = rank != null && rank >= GATE;
  return (
    <div className="flex items-center gap-2 text-[11px] tabular-nums">
      <span className="w-16 shrink-0 font-semibold uppercase tracking-wide text-foreground/80">{label}</span>
      <div className="relative h-2 flex-1 overflow-hidden rounded-full bg-muted">
        <div className={`h-full rounded-full ${hit ? "bg-plasma" : "bg-ember/70"}`} style={{ width: `${p * 100}%` }} />
        <span className="absolute inset-y-0 w-px bg-plasma-foreground" style={{ left: `${GATE * 100}%` }} />
      </div>
      <span className={`w-12 text-right ${hit ? "text-plasma" : "text-muted-foreground"}`}>{rank == null ? "—" : pct(rank, 0)}</span>
    </div>
  );
}

function Stat({ k, v }: { k: string; v: string }) {
  return (
    <div className="v3-chip px-3 py-2.5">
      <div className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">{k}</div>
      <div className="mt-1 text-sm font-medium tabular-nums truncate">{v}</div>
    </div>
  );
}

function Ring({ value, sub }: { value: number | null; sub: string }) {
  const r = 34, c = 2 * Math.PI * r;
  const p = value == null ? 0 : Math.max(0, Math.min(1, value));
  return (
    <div className="relative size-[76px] shrink-0">
      <svg viewBox="0 0 80 80" className="size-full -rotate-90">
        <circle cx="40" cy="40" r={r} fill="none" stroke="var(--border)" strokeWidth="7" />
        <circle cx="40" cy="40" r={r} fill="none" stroke={value != null && value >= 0.5 ? "var(--plasma)" : "var(--ember)"}
          strokeWidth="7" strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - p)}
          style={{ filter: "drop-shadow(0 0 6px var(--plasma))" }} />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="font-mono text-sm font-bold tabular-nums">{value == null ? "\u2014" : `${(value * 100).toFixed(1)}%`}</span>
        <span className="text-[7px] uppercase tracking-[0.2em] text-muted-foreground">{sub}</span>
      </div>
    </div>
  );
}
