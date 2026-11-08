export const LEAD_STAGES = ["new", "contacted", "follow_up", "replied", "meeting", "proposal", "won", "lost", "not_interested", "on_hold"] as const;
export type LeadStage = (typeof LEAD_STAGES)[number];

export const LEAD_META: Record<LeadStage, { label: string; tone: "neutral" | "brand" | "warn" | "danger" | "info" | "violet"; closed?: boolean }> = {
  new: { label: "Identified", tone: "neutral" },
  contacted: { label: "Contacted", tone: "info" },
  follow_up: { label: "Follow-up", tone: "info" },
  replied: { label: "Replied", tone: "violet" },
  meeting: { label: "Call scheduled", tone: "violet" },
  proposal: { label: "Scope sent", tone: "warn" },
  won: { label: "Signed", tone: "brand", closed: true },
  lost: { label: "Lost", tone: "danger", closed: true },
  not_interested: { label: "Not interested", tone: "neutral", closed: true },
  on_hold: { label: "On hold", tone: "neutral" },
};

export const LEAD_BOARD: LeadStage[] = ["new", "contacted", "follow_up", "replied", "meeting", "proposal", "won", "lost"];
export const CLOSING: LeadStage[] = ["lost", "not_interested"];
export const OPEN_STAGES: LeadStage[] = ["new", "contacted", "follow_up", "replied", "meeting", "proposal", "on_hold"];

/** Funnel order used for "reached at least" statistics */
export const FUNNEL: { stage: LeadStage; label: string }[] = [
  { stage: "contacted", label: "Contacted" },
  { stage: "replied", label: "Replied" },
  { stage: "meeting", label: "Call" },
  { stage: "proposal", label: "Scope sent" },
  { stage: "won", label: "Signed" },
];
