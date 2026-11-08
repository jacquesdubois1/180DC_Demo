"use client";

import { FileSpreadsheet, Upload } from "lucide-react";
import { useActionState, useState } from "react";
import { SubmitButton } from "@/components/ui/submit-button";
import { uploadImport } from "@/lib/outreach/import-actions";

export function ImportUpload() {
  const [state, action] = useActionState(uploadImport, null);
  const [name, setName] = useState<string | null>(null);
  return (
    <form action={action} className="space-y-3">
      <label className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-line bg-surface-2/50 px-4 py-8 text-center hover:bg-surface-2">
        <FileSpreadsheet className="size-8 text-ink-3" />
        <span className="text-[14px] font-medium">{name ?? "Choose an Excel or CSV file"}</span>
        <span className="text-[12.5px] text-ink-3">.xlsx or .csv, up to 5 MB and 2,000 rows · first sheet, first row = column names</span>
        <input type="file" name="file" accept=".xlsx,.csv,.tsv,.txt" className="sr-only" required onChange={(e) => setName(e.target.files?.[0]?.name ?? null)} />
      </label>
      {state && !state.ok ? <p className="text-[13px] text-danger">{state.error}</p> : null}
      <div className="flex items-center justify-between gap-3">
        <a href="/templates/prospects-template.csv" download className="text-[13px] text-brand hover:underline">Download an example file</a>
        <SubmitButton pendingText="Checking rows…"><Upload />Upload &amp; check</SubmitButton>
      </div>
    </form>
  );
}
