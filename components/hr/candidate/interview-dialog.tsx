"use client";

import { CalendarPlus } from "lucide-react";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Field, Input, Select } from "@/components/ui/input";
import { scheduleInterview } from "@/lib/hr/actions";

export function InterviewDialog({ applicationId, pool }: { applicationId: string; pool: { id: string; name: string }[] }) {
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [panel, setPanel] = useState<string[]>([]);
  const [form, setForm] = useState({ scheduledAt: "", durationMinutes: 45, format: "in_person" as "online" | "in_person", location: "" });
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button size="sm" variant="outline"><CalendarPlus />Schedule interview</Button></DialogTrigger>
      <DialogContent title="Schedule interview" description="Interviewers automatically receive an interview scorecard for this candidate.">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Date & time"><Input type="datetime-local" value={form.scheduledAt} onChange={(e) => setForm({ ...form, scheduledAt: e.target.value })} /></Field>
          <Field label="Duration (minutes)"><Input type="number" min={10} max={240} value={form.durationMinutes} onChange={(e) => setForm({ ...form, durationMinutes: Number(e.target.value) })} /></Field>
          <Field label="Format">
            <Select value={form.format} onChange={(e) => setForm({ ...form, format: e.target.value as "online" | "in_person" })}>
              <option value="in_person">In person</option><option value="online">Online</option>
            </Select>
          </Field>
          <Field label="Room or link"><Input value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} placeholder="Esade room / Meet link" /></Field>
        </div>
        <div className="mt-4">
          <div className="mb-1.5 text-[13px] font-medium text-ink-2">Interview panel</div>
          <div className="flex flex-wrap gap-2">
            {pool.map((p) => (
              <label key={p.id} className={`flex cursor-pointer items-center gap-2 rounded-full border px-3 py-1 text-[13px] ${panel.includes(p.id) ? "border-brand bg-brand-soft text-brand" : "border-line"}`}>
                <input type="checkbox" className="sr-only" checked={panel.includes(p.id)}
                  onChange={(e) => setPanel((s) => (e.target.checked ? [...s, p.id] : s.filter((x) => x !== p.id)))} />
                {p.name}
              </label>
            ))}
          </div>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
          <Button disabled={pending || !form.scheduledAt || !panel.length} onClick={() => start(async () => {
            const res = await scheduleInterview({ applicationId, ...form, interviewerIds: panel });
            if (res.ok) { toast.success(res.message); setOpen(false); } else toast.error(res.error);
          })}>Schedule</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
