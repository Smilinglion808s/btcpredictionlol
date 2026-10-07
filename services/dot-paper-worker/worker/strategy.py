"""DOT-BTC-FLOW-1.0.0: deterministic, closed-bar research signal.

One implementation is used by historical replay and paper-forward worker.
This module neither places orders nor calls an LLM. See research/PREREGISTRATION.json.
Numeric comparisons use IEEE754 double consistently. All timestamps are UTC ms.
"""
from __future__ import annotations
import hashlib
import json
import math
from pathlib import Path
from typing import Mapping, Sequence, TypedDict, Any

STRATEGY_VERSION = "DOT-BTC-FLOW-1.0.0"
CONFIG_PATH = Path(__file__).with_name("strategy_config.json")
CONFIG: dict[str, Any] = json.loads(CONFIG_PATH.read_text())
config = CONFIG
CONFIG_HASH = hashlib.sha256(CONFIG_PATH.read_bytes()).hexdigest()
STRATEGY_HASH = hashlib.sha256(Path(__file__).read_bytes()).hexdigest()

class Bar(TypedDict):
    open_ms: int
    close_ms: int
    open: str
    high: str
    low: str
    close: str
    volume: str
    quote_volume: str
    taker_buy_quote_volume: str

class Position(TypedDict):
    side: str
    entry: str
    entry_ms: int

class Decision(TypedDict):
    action: str
    reason: str
    stop_bps: int
    target_bps: int
    max_hold_ms: int
    signal: dict[str, Any]

def evaluate(closed_bars: Sequence[Mapping[str, Any]],
             position: Mapping[str, Any] | None = None,
             config: Mapping[str, Any] = CONFIG) -> Decision:
    """Evaluate only completed bars. Caller enforces closure/receipt time,
    frozen config/hash, idempotence, cooldown, daily/total risk and quote fills.
    A bars list containing gaps/invalid data fails closed. Position max-hold and
    flow exits only use latest completed bar; independent quote-based protective
    stops are execution-layer responsibilities.
    """
    c = config
    out: Decision = {"action":"ABSTAIN", "reason":"WARMUP", "stop_bps":int(c["stop_bps"]),
        "target_bps":int(c["target_bps"]), "max_hold_ms":int(c["max_hold_ms"]), "signal":{}}
    n, k = int(c["baseline_bars"]), int(c["flow_bars"])
    if len(closed_bars) < n + k: return out
    rows = closed_bars[-(n+k):]
    try:
        prev = None
        for r in rows:
            ts, end = int(r["open_ms"]), int(r["close_ms"])
            if end != ts + int(c["timeframe_ms"]) - 1 or (prev is not None and ts != prev + int(c["timeframe_ms"])):
                raise ValueError("noncontiguous_bar")
            prev=ts
            o,h,l,cl,v,q,b=[float(r[x]) for x in ["open","high","low","close","volume","quote_volume","taker_buy_quote_volume"]]
            if not all(math.isfinite(x) for x in [o,h,l,cl,v,q,b]) or min(o,h,l,cl)<=0 or not l<=min(o,cl)<=max(o,cl)<=h:
                raise ValueError("invalid_ohlc")
            if v<0 or q<=0 or b<0 or b>q: raise ValueError("invalid_or_zero_volume")
        recent=rows[-k:]
        q=sum(float(r["quote_volume"]) for r in recent)
        b=sum(float(r["taker_buy_quote_volume"]) for r in recent)
        baseline=sum(float(r["quote_volume"]) for r in rows[:-k])/n
        imbalance=2*b/q-1
        volume_ratio=q/(k*baseline)
        ret_bps=(float(recent[-1]["close"])/float(recent[0]["open"])-1)*10000
        decision_ms=int(rows[-1]["close_ms"])+1
        direction=1 if imbalance>0 else -1 if imbalance<0 else 0
        out["signal"]={"decision_ms":decision_ms,"imbalance":imbalance,"volume_ratio":volume_ratio,
                       "return_bps":ret_bps,"direction":direction,"source":"executed_taker_quote_volume",
                       "bar_count":n+k,"strategy_version":STRATEGY_VERSION}
        if position is not None:
            side=str(position["side"]).upper()
            if side not in ["LONG","SHORT"]: raise ValueError("invalid_position_side")
            sign=1 if side=="LONG" else -1
            if decision_ms-int(position["entry_ms"])>=int(c["max_hold_ms"]):
                out.update(action="EXIT",reason="MAX_HOLD")
            elif sign*imbalance <= -float(c["flow_exit_imbalance"]):
                out.update(action="EXIT",reason="FLOW_REVERSAL")
            else: out["reason"]="HOLD"
            return out
        if abs(imbalance)<float(c["min_imbalance"]): out["reason"]="WEAK_FLOW"
        elif volume_ratio<float(c["min_volume_ratio"]): out["reason"]="LOW_PARTICIPATION"
        elif direction*ret_bps<float(c["min_aligned_return_bps"]): out["reason"]="PRICE_NOT_CONFIRMED"
        elif direction*ret_bps>float(c["max_aligned_return_bps"]): out["reason"]="CHASE_FILTER"
        else: out.update(action="LONG" if direction>0 else "SHORT",reason="FLOW_CONTINUATION")
    except (KeyError,ValueError,TypeError,ZeroDivisionError,OverflowError) as e:
        out.update(action="ABSTAIN",reason="INVALID_INPUT:"+str(e),signal={})
    return out
