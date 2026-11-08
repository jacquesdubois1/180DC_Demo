import "server-only";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import { renderTemplate } from "@/lib/email/render";
import { AiRefusalError, aiMode, anthropic, FALLBACK_BETA, finishRun, model, startRun } from "./client";

/** Personalised first-touch e-mail draft. A person always reviews it before it is sent. */
export const EmailDraft = z.object({
  subject: z.string().describe("Short, specific subject line (max 70 characters)"),
  body: z.string().describe("Plain-text e-mail body, max 150 words, ending with the sender name and the line {{unsubscribe_link}}"),
});
export type EmailDraft = z.infer<typeof EmailDraft>;

export interface DraftInput {
  leadId: string;
  userId: string;
  senderName: string;
  contactFirstName: string;
  organization: string;
  sector: string | null;
  city: string | null;
  description: string | null;
  projectIdea: string | null;
  template: { subject: string; body: string };
}

export async function draftOutreachEmail(input: DraftInput): Promise<EmailDraft> {
  const runId = await startRun("email_draft", { summary: `Draft for ${input.organization}`, leadId: input.leadId, userId: input.userId });
  try {
    if (aiMode() !== "live") {
      const opener = input.description
        ? `I came across ${input.organization} - ${input.description.replace(/^\S+ works on /i, "your work on ").replace(/\.$/, "")} - and thought of our programme.`
        : `I came across ${input.organization}'s work in ${input.city ?? "Barcelona"} and thought of our programme.`;
      const vars = { first_name: input.contactFirstName, organization: input.organization, sector: (input.sector ?? "your field").toLowerCase(),
        project_idea: (input.projectIdea ?? "a strategic question you are facing").replace(/^\w/, (c) => c.toLowerCase()), sender_name: input.senderName };
      const body = renderTemplate(input.template.body, vars).text.replace(/^(Dear|Hi) ([^,\n]+),\n\n/, `$1 $2,\n\n${opener} `);
      const draft = { subject: renderTemplate(input.template.subject, vars).text, body };
      await finishRun(runId, { ok: true, output: draft });
      return draft;
    }
    const prompt = `You write on behalf of ${input.senderName}, a student volunteer at 180 Degrees Consulting Barcelona (Esade chapter of the world's largest student consultancy; free 10-week consulting projects for NGOs and social enterprises).
Write a first e-mail to ${input.contactFirstName} at ${input.organization}.
Organisation facts (only use these, do not invent anything): sector: ${input.sector ?? "unknown"}; city: ${input.city ?? "unknown"}; description: ${input.description ?? "none"}; possible project: ${input.projectIdea ?? "none"}.
Use this template as the structure and tone reference:
---
${input.template.subject}
${input.template.body}
---
Requirements: max 150 words; warm, specific, no flattery or exaggeration; one clear ask (a 20-minute call); keep the literal line {{unsubscribe_link}} at the end; English.`;
    const response = await anthropic().beta.messages.parse({
      model: model(),
      max_tokens: 2000,
      betas: [FALLBACK_BETA],
      fallbacks: "default",
      output_config: { effort: "low", format: betaZodOutputFormat(EmailDraft) },
      messages: [{ role: "user", content: prompt }],
    });
    if (response.stop_reason === "refusal") throw new AiRefusalError("The model declined to write this e-mail.");
    const draft = response.parsed_output;
    if (!draft) throw new Error("Could not parse the draft");
    await finishRun(runId, { ok: true, output: draft, inputTokens: response.usage.input_tokens, outputTokens: response.usage.output_tokens, modelId: response.model });
    return draft;
  } catch (err) {
    await finishRun(runId, { ok: false, error: (err as Error).message });
    throw err;
  }
}
