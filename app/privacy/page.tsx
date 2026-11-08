import type { Metadata } from "next";
import { BrandLockup } from "@/components/brand";

export const metadata: Metadata = { title: "Privacy notice", robots: { index: true, follow: true } };

/** DRAFT privacy notice (version 2026-11) - to be reviewed by the board and a qualified person before go-live. */
export default function Privacy() {
  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-10 text-[15px] leading-relaxed">
      <div className="mb-8"><BrandLockup /></div>
      <div className="eyebrow mb-2">Version 2026-11 · draft for board review</div>
      <h1 className="text-[30px] font-semibold tracking-tight">Privacy notice - recruitment and client outreach</h1>
      <div className="mt-6 space-y-5 text-ink-2 [&_h2]:mt-8 [&_h2]:text-[18px] [&_h2]:font-semibold [&_h2]:text-ink">
        <p><b className="text-ink">Controller:</b> 180 Degrees Consulting Barcelona (student association at Esade). Contact: the HR team via the e-mail address on our website.</p>
        <h2>What we process and why</h2>
        <p><b className="text-ink">Applicants:</b> name, contact details, studies, languages, optional LinkedIn and nationality, your answers and CV, and the internal assessments of our reviewers. Purpose: running the recruitment cycle you applied for. Legal basis: your consent and steps prior to joining the association (art. 6(1)(a) and (b) GDPR).</p>
        <p><b className="text-ink">Contacts at organisations:</b> name, role, business e-mail and our correspondence, to offer pro bono consulting projects. Legal basis: legitimate interest (art. 6(1)(f) GDPR). Every e-mail contains an opt-out link; after opting out you are never contacted again.</p>
        <h2>How we protect it</h2>
        <p>Data is stored in the EU (Supabase, Frankfurt) and only accessible to the members whose role requires it - enforced in the database itself. Reviewers in the first round see applications without names, nationality or university. Every access to a CV is logged.</p>
        <p>If AI assistance is enabled, CVs may be processed by Anthropic (Claude API) to suggest factual fields such as your LinkedIn URL; the result is checked by a person. Decisions are always made by people, never automatically.</p>
        <h2>How long we keep it</h2>
        <p>If you are not selected, your application is anonymised automatically after the retention period shown on the form (default 180 days); only non-identifying statistics remain. If you join, your data becomes part of your membership record.</p>
        <h2>Your rights</h2>
        <p>You can request access, correction, deletion, restriction, data portability, or object to processing, and withdraw consent at any time, by contacting us. You may also complain to the Spanish data protection authority (AEPD).</p>
      </div>
    </main>
  );
}
