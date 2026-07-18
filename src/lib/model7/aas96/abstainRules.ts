// AAS96 abstain-rule registry.
//
// Every abstain rule is always evaluated and its counterfactual is recorded,
// but only ACTIVE_ABSTAIN_RULE is allowed to modify the published prediction.
// To promote a new rule to live, change this constant — no other model
// changes required.

export type AbstainRuleId =
  | "NONE"
  | "cleanup_veto_v1";

export const ACTIVE_ABSTAIN_RULE: AbstainRuleId = "NONE";

export const ALL_ABSTAIN_RULES: AbstainRuleId[] = ["cleanup_veto_v1"];
