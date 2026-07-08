// Optional LLM narrator — runs AFTER the decision is final. Never modifies it.
// On any error, returns a canned string. Never throws.
import type { Features } from "./featureEngine";
import type { Scores } from "./scoringEngine";
import type { Decision } from "./decisionEngine";
import type { Sizing } from "./sizingEngine";

export async function narrateDecision(args: {
  features: Features; scores: Scores; decision: Decision; sizing: Sizing;
  apiKey?: string | null;
}): Promise<string> {
  const { features, scores, decision, sizing, apiKey } = args;
  const fallback = () => {
    const dir = decision.prediction;
    const setup = decision.setup_type;
    const dominant = scores.bull > scores.bear ? `bull ${scores.bull.toFixed(1)} > bear ${scores.bear.toFixed(1)}` : `bear ${scores.bear.toFixed(1)} > bull ${scores.bull.toFixed(1)}`;
    const guardTxt = decision.guards_applied.length ? ` Guards: ${decision.guards_applied.join(", ")}.` : "";
    return `Engine decision: ${dir} (${setup}, margin ${scores.margin.toFixed(1)}), ${dominant}. Trade: ${decision.final_trade_status}, units ${sizing.units}.${guardTxt}`;
  };
  if (!apiKey) return fallback();
  try {
    const summary = {
      prediction: decision.prediction,
      confidence: decision.confidence,
      setup_type: decision.setup_type,
      trade_status: decision.final_trade_status,
      units: sizing.units,
      bull: scores.bull, bear: scores.bear, margin: scores.margin,
      partial_agreement: decision.partial_agreement,
      guards: decision.guards_applied,
      caps: decision.caps_applied,
      zone: features.fib_zone,
      atr_state: features.atr_state,
      vwap_side: features.above_vwap ? "above" : features.below_vwap ? "below" : "near",
    };
    const res = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        instructions: "You write a 2-sentence trading commentary for a dashboard. Do not question or change the decision. Refer to it factually.",
        input: `Decision object: ${JSON.stringify(summary)}\n\nReply with the 2 sentences only.`,
        max_output_tokens: 220,
      }),
    });
    if (!res.ok) return fallback();
    const j = await res.json() as Record<string, unknown>;
    const txt = typeof j.output_text === "string" ? j.output_text.trim() : "";
    if (!txt) return "engine decision (narrator unavailable)";
    return txt;
  } catch {
    return "engine decision (narrator unavailable)";
  }
}
