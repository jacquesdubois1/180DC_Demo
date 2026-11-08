import "server-only";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import { readFileContent } from "@/lib/storage";
import { AiRefusalError, aiMode, anthropic, FALLBACK_BETA, finishRun, model, startRun } from "./client";

/**
 * CV fact extraction (requested by HR: LinkedIn and nationality without manual lookup).
 * The PDF goes to Claude as a document block; the answer is validated against a schema.
 * Extracted facts are SUGGESTIONS shown with an "AI" label - HR decides, never the model.
 */
export const CvFacts = z.object({
  linkedin_url: z.string().nullable().describe("Full LinkedIn profile URL if present, else null"),
  nationality: z.string().nullable().describe("Nationality only if explicitly stated, else null"),
  university: z.string().nullable(),
  degree_program: z.string().nullable(),
  graduation_year: z.number().int().nullable(),
  languages: z.array(z.string()),
  skills: z.array(z.string()).describe("Up to 8 concrete skills/tools named in the CV"),
  experience_summary: z.string().describe("2-3 neutral sentences on relevant experience; no judgement of the person"),
  impact_experience: z.boolean().describe("True if the CV mentions volunteering, NGO, social or environmental impact work"),
});
export type CvFacts = z.infer<typeof CvFacts>;

const INSTRUCTIONS = `Extract factual information from this CV for a student consulting association's recruitment team.
Rules:
- Copy facts that are written in the CV; never guess. Use null when something is not stated.
- Do not infer nationality from the name, language or photo - only report it if the CV states it.
- Do not evaluate or rank the candidate; the summary must be neutral and factual.`;

export async function extractCvFacts(opts: { applicationId: string; fileId: string; userId: string }): Promise<CvFacts> {
  const runId = await startRun("cv_extraction", { summary: `CV extraction for application ${opts.applicationId}`, applicationId: opts.applicationId, userId: opts.userId });
  try {
    const file = await readFileContent(opts.fileId);
    if (!file) throw new Error("CV file not found");
    if (aiMode() !== "live") {
      const facts = mockExtract(file.bytes);
      await finishRun(runId, { ok: true, output: facts });
      return facts;
    }
    const response = await anthropic().beta.messages.parse({
      model: model(),
      max_tokens: 4000,
      betas: [FALLBACK_BETA],
      fallbacks: "default",
      output_config: { effort: "low", format: betaZodOutputFormat(CvFacts) },
      messages: [{
        role: "user",
        content: [
          { type: "document", source: { type: "base64", media_type: "application/pdf", data: file.bytes.toString("base64") } },
          { type: "text", text: INSTRUCTIONS },
        ],
      }],
    });
    if (response.stop_reason === "refusal") throw new AiRefusalError("The model declined to process this document.");
    const facts = response.parsed_output;
    if (!facts) throw new Error("Could not parse the model's answer");
    await finishRun(runId, { ok: true, output: facts, inputTokens: response.usage.input_tokens, outputTokens: response.usage.output_tokens, modelId: response.model });
    return facts;
  } catch (err) {
    await finishRun(runId, { ok: false, error: (err as Error).message });
    throw err;
  }
}

/** Offline extraction for demo mode: reads the text layer of the demo PDFs. */
function mockExtract(pdf: Buffer): CvFacts {
  const text = pdf.toString("latin1");
  const strings = [...text.matchAll(/\(((?:\\.|[^\\)])*)\)\s*Tj/g)].map((m) =>
    m[1].replace(/\\(\d{3})/g, (_, o: string) => String.fromCharCode(parseInt(o, 8))).replace(/\\([()\\])/g, "$1"));
  const header = strings[1] ?? "";
  const [, nationality] = header.split("|").map((s) => s.trim());
  const edu = strings.find((s) => / - .*\(/.test(s)) ?? "";
  const [uni, rest] = edu.split(" - ");
  const program = rest?.replace(/\s*\(.*\)\s*$/, "") ?? null;
  const langLine = strings.find((s) => s.startsWith("Languages:")) ?? "";
  const toolsLine = strings.find((s) => s.startsWith("Tools:")) ?? "";
  const link = strings.find((s) => s.includes("linkedin.com/in/"));
  const experience = strings.filter((s) => / - /.test(s) && !s.includes("(")).slice(0, 1).join(" ");
  const impactWords = /volunt|ngo|impact|refugee|food bank|clean-up|sustainab|tutor/i;
  return {
    linkedin_url: link ? `https://www.${link.replace(/^https?:\/\/(www\.)?/, "")}` : null,
    nationality: nationality || null,
    university: uni?.trim() || null,
    degree_program: program?.trim() || null,
    graduation_year: null,
    languages: langLine.replace("Languages:", "").split(",").map((s) => s.trim()).filter(Boolean),
    skills: toolsLine.replace("Tools:", "").split(",").map((s) => s.trim()).filter(Boolean),
    experience_summary: experience ? `Experience listed: ${experience}.` : "No work experience listed.",
    impact_experience: impactWords.test(strings.join(" ")),
  };
}
