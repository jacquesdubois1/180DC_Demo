"use client";

import { Upload } from "lucide-react";
import { useActionState, useState } from "react";
import { SubmitButton } from "@/components/ui/submit-button";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { type ApplyState, submitApplication } from "@/lib/hr/apply-action";
import { cn } from "@/lib/utils";

interface Position { id: string; name: string; description: string | null; questions: { key: string; label: string; required: boolean; max_words?: number }[] }

const LANGS = ["English", "Spanish", "Catalan", "French", "German", "Italian", "Portuguese", "Mandarin", "Arabic", "Hindi"];
const YEARS = ["1st year", "2nd year", "3rd year", "4th year", "Master", "MBA", "PhD"];
const HEARD = ["A friend / member", "Esade club fair", "Instagram", "LinkedIn", "Professor", "Newsletter", "Other"];

export function ApplyForm({ positions, retentionDays }: { positions: Position[]; retentionDays: number }) {
  const [state, action] = useActionState<ApplyState, FormData>(submitApplication, null);
  const [positionId, setPositionId] = useState(positions[0]?.id ?? "");
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [startedAt] = useState(() => Date.now());
  const [cvName, setCvName] = useState<string | null>(null);
  const position = positions.find((p) => p.id === positionId);
  const err = (k: string) => (state && !state.ok ? state.fieldErrors?.[k] : undefined);
  const wc = (s: string | undefined) => (s ?? "").trim().split(/\s+/).filter(Boolean).length;

  return (
    <form action={action} className="mt-8 space-y-8">
      <input type="hidden" name="started_at" value={startedAt} />
      <div className="hidden" aria-hidden="true"><label>Website<input name="website" tabIndex={-1} autoComplete="off" /></label></div>

      <section className="space-y-4">
        <h2 className="text-[17px] font-semibold">About you</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="First name" error={err("first_name")}><Input name="first_name" required autoComplete="given-name" /></Field>
          <Field label="Last name" error={err("last_name")}><Input name="last_name" required autoComplete="family-name" /></Field>
          <Field label="E-mail" error={err("email")}><Input name="email" type="email" required autoComplete="email" /></Field>
          <Field label="Phone (optional)" error={err("phone")}><Input name="phone" type="tel" autoComplete="tel" /></Field>
          <Field label="LinkedIn (optional)" error={err("linkedin_url")}><Input name="linkedin_url" placeholder="https://www.linkedin.com/in/…" /></Field>
          <Field label="Nationality (optional)" hint="Only used to plan visa/exchange logistics and diversity statistics; never shown to blind reviewers.">
            <Input name="nationality" />
          </Field>
        </div>
      </section>

      <section className="space-y-4">
        <h2 className="text-[17px] font-semibold">Studies</h2>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="University" error={err("university")} className="sm:col-span-3"><Input name="university" required defaultValue="ESADE Business School" /></Field>
          <Field label="Degree program" error={err("degree_program")} className="sm:col-span-2"><Input name="degree_program" required placeholder="BBA, MSc Business Analytics…" /></Field>
          <Field label="Year" error={err("study_year")}>
            <Select name="study_year" required defaultValue="">{["", ...YEARS].map((y) => <option key={y} value={y} disabled={!y}>{y || "Choose…"}</option>)}</Select>
          </Field>
        </div>
        <div>
          <div className="mb-1.5 text-[13px] font-medium text-ink-2">Languages you speak fluently</div>
          <div className="flex flex-wrap gap-2">
            {LANGS.map((l) => (
              <label key={l} className="cursor-pointer">
                <input type="checkbox" name="languages" value={l} className="peer sr-only" defaultChecked={l === "English"} />
                <span className="inline-block rounded-full border border-line px-3 py-1 text-[13px] peer-checked:border-brand peer-checked:bg-brand-soft peer-checked:text-brand peer-focus-visible:outline-2">{l}</span>
              </label>
            ))}
          </div>
        </div>
      </section>

      <section className="space-y-4">
        <h2 className="text-[17px] font-semibold">Track</h2>
        <div className="grid gap-3 sm:grid-cols-2" role="radiogroup">
          {positions.map((p) => (
            <label key={p.id} className={cn("cursor-pointer rounded-2xl border p-4 transition", positionId === p.id ? "border-brand bg-brand-soft/50" : "border-line hover:border-brand")}>
              <input type="radio" name="position_id" value={p.id} checked={positionId === p.id} onChange={() => setPositionId(p.id)} className="sr-only" />
              <div className="font-medium">{p.name}</div>
              <div className="mt-0.5 text-[13px] text-ink-3">{p.description}</div>
            </label>
          ))}
        </div>
        {err("position_id") ? <p className="text-xs text-danger">{err("position_id")}</p> : null}
        <Field label="Second choice (optional)">
          <Select name="second_choice_position_id" defaultValue="">
            <option value="">No second choice</option>
            {positions.filter((p) => p.id !== positionId).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </Select>
        </Field>
      </section>

      {position ? (
        <section className="space-y-5">
          <h2 className="text-[17px] font-semibold">Questions</h2>
          {position.questions.map((q) => {
            const n = wc(answers[q.key]);
            return (
              <Field key={q.key} label={q.label} error={err(`q_${q.key}`)}>
                <Textarea name={`q_${q.key}`} required={q.required} className="min-h-32" value={answers[q.key] ?? ""}
                  onChange={(e) => setAnswers((s) => ({ ...s, [q.key]: e.target.value }))} />
                {q.max_words ? <span className={cn("text-right text-[12px] tabular", n > q.max_words ? "text-danger" : "text-ink-3")}>{n}/{q.max_words} words</span> : null}
              </Field>
            );
          })}
        </section>
      ) : null}

      <section className="space-y-4">
        <h2 className="text-[17px] font-semibold">CV</h2>
        <label className={cn("flex cursor-pointer items-center gap-3 rounded-2xl border border-dashed px-4 py-5", err("cv") ? "border-danger" : "border-line hover:border-brand")}>
          <Upload className="size-5 text-ink-3" />
          <span className="flex-1 text-[14px]">{cvName ?? "Upload your CV as PDF (max. 5 MB)"}</span>
          <input type="file" name="cv" accept="application/pdf" className="sr-only" required onChange={(e) => setCvName(e.target.files?.[0]?.name ?? null)} />
        </label>
        {err("cv") ? <p className="text-xs text-danger">{err("cv")}</p> : null}
        <Field label="How did you hear about us? (optional)">
          <Select name="heard_from" defaultValue="">{["", ...HEARD].map((h) => <option key={h} value={h}>{h || "Choose…"}</option>)}</Select>
        </Field>
      </section>

      <section className="rounded-2xl border border-line bg-surface p-4 text-[13.5px]">
        <label className="flex items-start gap-3">
          <input type="checkbox" name="consent" className="mt-1" required />
          <span>
            I have read the <a href="/privacy" target="_blank" className="font-medium text-brand underline">privacy notice</a>. 180 Degrees Consulting Barcelona
            processes my application only for this recruitment cycle. If I am not selected, my data is deleted or anonymised after {retentionDays} days.
            I can ask for access or deletion at any time.
          </span>
        </label>
        {err("consent") ? <p className="mt-1 text-xs text-danger">{err("consent")}</p> : null}
      </section>

      {state && !state.ok ? <p className="rounded-xl bg-danger-soft px-4 py-2.5 text-[13.5px] text-danger">{state.error}</p> : null}
      <SubmitButton size="lg" pendingText="Submitting…">Submit application</SubmitButton>
    </form>
  );
}
