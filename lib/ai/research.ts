import "server-only";
import type Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import { AiRefusalError, aiMode, anthropic, FALLBACK_BETA, finishRun, model, startRun } from "./client";

/**
 * AI lead research. Step 1: Claude researches the web (server-side web search tool) for
 * organisations matching Client Relations' criteria. Step 2: the findings are converted
 * into validated, structured suggestions. Nothing enters the pipeline until a person accepts it.
 */

export const ResearchCriteria = z.object({
  sectors: z.array(z.string()).min(1).max(8),
  city: z.string().min(2).max(80),
  orgTypes: z.array(z.string()).min(1),
  sizeBands: z.array(z.string()).default([]),
  keywords: z.string().max(300).default(""),
  count: z.number().int().min(3).max(15).default(6),
});
export type ResearchCriteria = z.infer<typeof ResearchCriteria>;

const Suggestion = z.object({
  name: z.string(),
  website: z.string().nullable(),
  org_type: z.enum(["company", "startup", "social_enterprise", "ngo", "foundation", "public_sector", "university", "other"]),
  sector: z.string(),
  city: z.string(),
  rationale: z.string().describe("2 sentences: what they do and why a pro bono student consulting project could help them now"),
  sources: z.array(z.string()).describe("URLs where the facts were found"),
  suggested_contact_role: z.string().describe("Role to contact, e.g. Founder & CEO or Head of Partnerships"),
  fit_score: z.number().int().min(0).max(100),
});
const SuggestionList = z.object({ suggestions: z.array(Suggestion) });
export type LeadSuggestion = z.infer<typeof Suggestion>;

export async function researchLeads(criteria: ResearchCriteria, userId: string, exclude: string[]): Promise<{ runId: string; suggestions: LeadSuggestion[] }> {
  const summary = `${criteria.orgTypes.join("/")} in ${criteria.sectors.join(", ")}, ${criteria.city}${criteria.keywords ? `, ${criteria.keywords}` : ""}`;
  const runId = await startRun("lead_research", { summary, userId });
  try {
    if (aiMode() !== "live") {
      const suggestions = mockSuggestions(criteria);
      await finishRun(runId, { ok: true, output: { suggestions: suggestions.length, mode: "mock" } });
      return { runId, suggestions };
    }
    const client = anthropic();
    const ask = `Find ${criteria.count} real organisations that could become clients of 180 Degrees Consulting Barcelona (free 10-week student consulting projects for social-impact organisations).
Criteria: types ${criteria.orgTypes.join(", ")}; sectors ${criteria.sectors.join(", ")}; located in or near ${criteria.city}; size ${criteria.sizeBands.join(", ") || "any"}; ${criteria.keywords ? `extra: ${criteria.keywords}; ` : ""}
Prefer organisations with a visible current challenge (growth, new programme, funding, measurement) a strategy project could address.
Do not include: ${exclude.slice(0, 200).join("; ") || "-"}.
For each, note the official website, what they do, why now, and the URLs you used. Only report facts you found.`;
    const messages: Anthropic.Beta.BetaMessageParam[] = [{ role: "user", content: ask }];
    let research = "";
    let inputTokens = 0;
    let outputTokens = 0;
    for (let turn = 0; turn < 4; turn++) {
      const response = await client.beta.messages.create({
        model: model(),
        max_tokens: 16000,
        betas: [FALLBACK_BETA],
        fallbacks: "default",
        output_config: { effort: "medium" },
        tools: [{ type: "web_search_20260209", name: "web_search", max_uses: 10 }],
        messages,
      });
      inputTokens += response.usage.input_tokens;
      outputTokens += response.usage.output_tokens;
      if (response.stop_reason === "refusal") throw new AiRefusalError("The model declined this research request.");
      research += response.content.filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text").map((b) => b.text).join("\n");
      if (response.stop_reason !== "pause_turn") break;
      messages.push({ role: "assistant", content: response.content }); // long server-tool turn: let it continue
    }
    const structured = await client.beta.messages.parse({
      model: model(),
      max_tokens: 8000,
      betas: [FALLBACK_BETA],
      fallbacks: "default",
      output_config: { effort: "low", format: betaZodOutputFormat(SuggestionList) },
      messages: [{ role: "user", content: `Convert these research notes into structured suggestions. Keep only organisations with a website and at least one source URL. Score fit 0-100 against the criteria (${summary}).\n\n${research}` }],
    });
    if (structured.stop_reason === "refusal") throw new AiRefusalError("The model declined to structure the results.");
    const suggestions = structured.parsed_output?.suggestions ?? [];
    inputTokens += structured.usage.input_tokens;
    outputTokens += structured.usage.output_tokens;
    await finishRun(runId, { ok: true, output: { suggestions: suggestions.length }, inputTokens, outputTokens, modelId: structured.model });
    return { runId, suggestions };
  } catch (err) {
    await finishRun(runId, { ok: false, error: (err as Error).message });
    throw err;
  }
}

/** Offline demo: plausible FICTIONAL organisations (reserved example domains). */
function mockSuggestions(c: ResearchCriteria): LeadSuggestion[] {
  const stems = ["Raiz", "Vela", "Nexe", "Brot", "Onada", "Teula", "Rumb", "Cel", "Faro", "Llavor", "Arbre", "Gota"];
  const challenges = ["is expanding to a second location and needs a market-entry plan", "wants to measure its social impact for funders",
    "depends on a single grant and needs a diversified funding strategy", "is launching a B2B offer and needs a pricing model",
    "struggles to retain volunteers and wants to understand why", "needs a go-to-market plan for a new programme"];
  return Array.from({ length: c.count }, (_, i) => {
    const stem = stems[(i * 5 + c.sectors[0].length) % stems.length];
    const sector = c.sectors[i % c.sectors.length];
    const type = c.orgTypes[i % c.orgTypes.length];
    const name = type === "ngo" ? `Associació ${stem}` : type === "foundation" ? `Fundació ${stem}` : `${stem}${["lab", "works", "circular", "social"][i % 4]}`;
    const domain = `${name.toLowerCase().replace(/[^a-z]/g, "")}.example.com`;
    return {
      name, website: `https://www.${domain}`, org_type: type as LeadSuggestion["org_type"], sector, city: c.city,
      rationale: `${name} works on ${sector.toLowerCase()} in ${c.city}. It ${challenges[i % challenges.length]}.`,
      sources: [`https://www.${domain}/about`], suggested_contact_role: type === "startup" ? "Founder & CEO" : "Managing Director", fit_score: 90 - i * 4,
    };
  });
}
