import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { withService } from "@/lib/db";
import { env } from "@/lib/env";

/**
 * Claude API access for the Hub's AI features.
 *
 *   AI_MODE=off    features hidden
 *   AI_MODE=mock   deterministic offline answers (demo / development, no key, no cost)
 *   AI_MODE=live   Anthropic API (ANTHROPIC_API_KEY), model AI_MODEL (default claude-opus-5-5)
 *
 * Every call is logged in ai_runs (purpose, model, tokens, cost) for transparency.
 * Requests opt into server-side refusal fallbacks (`fallbacks: "default"`): if a safety
 * classifier declines, the API re-runs the request on Anthropic's recommended fallback model.
 */

export const FALLBACK_BETA = "server-side-fallback-2026-07-01";

let client: Anthropic | null = null;
export function anthropic(): Anthropic {
  if (!client) {
    if (!env().ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY is not set (AI_MODE=live)");
    client = new Anthropic({ apiKey: env().ANTHROPIC_API_KEY, maxRetries: 2, timeout: 120_000 });
  }
  return client;
}

export function aiMode() {
  return env().AI_MODE;
}

export function model() {
  return env().AI_MODEL;
}

// USD per million tokens (input, output) for cost logging
const PRICES: Record<string, [number, number]> = {
  "claude-opus-5-5": [4, 20],
  "claude-sonnet-5-5": [2, 10],
  "claude-haiku-5-5": [0.1, 0.5],
};

export function costUsd(modelId: string, inputTokens: number, outputTokens: number) {
  const [i, o] = PRICES[modelId] ?? [4, 20];
  return (inputTokens * i + outputTokens * o) / 1e6;
}

export type AiKind = "cv_extraction" | "lead_research" | "email_draft" | "reply_classification";

export async function startRun(kind: AiKind, input: { summary: string; applicationId?: string; leadId?: string; userId: string }) {
  const [row] = await withService((sql) => sql<{ id: string }[]>`
    insert into ai_runs (kind, model, input_summary, application_id, lead_id, created_by)
    values (${kind}, ${aiMode() === "live" ? model() : "demo-offline"}, ${input.summary.slice(0, 500)},
            ${input.applicationId ?? null}, ${input.leadId ?? null}, ${input.userId})
    returning id`);
  return row.id;
}

export async function finishRun(id: string, r: { ok: boolean; output?: unknown; error?: string; inputTokens?: number; outputTokens?: number; modelId?: string }) {
  const cost = r.modelId ? costUsd(r.modelId, r.inputTokens ?? 0, r.outputTokens ?? 0) : 0;
  await withService((sql) => sql`
    update ai_runs set status = ${r.ok ? "succeeded" : "failed"}, output = ${r.output === undefined ? null : sql.json(r.output as never)},
      error = ${r.error ?? null}, input_tokens = ${r.inputTokens ?? null}, output_tokens = ${r.outputTokens ?? null},
      cost_usd = ${cost}, finished_at = now()
    where id = ${id}`);
}

export class AiRefusalError extends Error {}
