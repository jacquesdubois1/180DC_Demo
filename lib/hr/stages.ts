export const APPLICATION_STAGES = [
  "received", "screening", "interview", "final_review", "offer_sent", "offer_accepted", "offer_declined", "waitlisted", "rejected", "withdrawn",
] as const;
export type ApplicationStage = (typeof APPLICATION_STAGES)[number];

export const STAGE_META: Record<ApplicationStage, { label: string; tone: "neutral" | "brand" | "warn" | "danger" | "info" | "violet"; terminal?: boolean }> = {
  received: { label: "New", tone: "info" },
  screening: { label: "In review", tone: "neutral" },
  interview: { label: "Interview", tone: "violet" },
  final_review: { label: "Decision", tone: "warn" },
  offer_sent: { label: "Offer sent", tone: "brand" },
  offer_accepted: { label: "Offer accepted", tone: "brand", terminal: true },
  offer_declined: { label: "Offer declined", tone: "neutral", terminal: true },
  waitlisted: { label: "Waitlisted", tone: "warn" },
  rejected: { label: "Rejected", tone: "danger", terminal: true },
  withdrawn: { label: "Withdrawn", tone: "neutral", terminal: true },
};

/** Kanban columns (terminal "no" stages are shown collapsed at the end). */
export const BOARD_COLUMNS: ApplicationStage[] = ["received", "screening", "interview", "final_review", "offer_sent", "offer_accepted", "waitlisted", "rejected"];

/** Mirror of app.application_transition_allowed() - the database has the final word. */
export const TRANSITIONS: Record<ApplicationStage, ApplicationStage[]> = {
  received: ["screening", "rejected", "withdrawn"],
  screening: ["received", "interview", "waitlisted", "rejected", "withdrawn"],
  interview: ["screening", "final_review", "waitlisted", "rejected", "withdrawn"],
  final_review: ["interview", "offer_sent", "waitlisted", "rejected", "withdrawn"],
  waitlisted: ["final_review", "offer_sent", "rejected", "withdrawn"],
  offer_sent: ["offer_accepted", "offer_declined", "withdrawn"],
  rejected: ["screening", "interview", "final_review"],
  withdrawn: ["screening"],
  offer_declined: ["waitlisted"],
  offer_accepted: [],
};

export const NEEDS_REASON: ApplicationStage[] = ["rejected", "waitlisted", "offer_sent"];

export const RECOMMENDATION_META = {
  strong_yes: { label: "Strong yes", tone: "brand" as const, value: 4 },
  yes: { label: "Yes", tone: "brand" as const, value: 3 },
  maybe: { label: "Maybe", tone: "warn" as const, value: 2 },
  no: { label: "No", tone: "danger" as const, value: 1 },
};
export type Recommendation = keyof typeof RECOMMENDATION_META;
