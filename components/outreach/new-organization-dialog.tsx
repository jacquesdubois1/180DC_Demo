"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Field, Input, Select } from "@/components/ui/input";
import { createOrganization } from "@/lib/outreach/actions";

const TYPES = [["startup", "Start-up"], ["social_enterprise", "Social enterprise"], ["ngo", "NGO / association"], ["foundation", "Foundation"],
  ["company", "Company"], ["public_sector", "Public sector"], ["other", "Other"]] as const;

export function NewOrganizationDialog({ trigger }: { trigger: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const router = useRouter();
  const [f, setF] = useState({ name: "", website: "", type: "startup", sector: "", city: "Barcelona", sizeBand: "" });
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button>{trigger}</Button></DialogTrigger>
      <DialogContent title="New organisation" description="Duplicates are detected by website domain and similar names, so nobody contacts the same organisation twice.">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Name" className="sm:col-span-2"><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
          <Field label="Website" className="sm:col-span-2"><Input value={f.website} placeholder="https://…" onChange={(e) => setF({ ...f, website: e.target.value })} /></Field>
          <Field label="Type"><Select value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })}>{TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select></Field>
          <Field label="Size"><Select value={f.sizeBand} onChange={(e) => setF({ ...f, sizeBand: e.target.value })}>
            <option value="">Unknown</option>{["1-10", "11-50", "51-200", "201-1000", "1000+"].map((s) => <option key={s}>{s}</option>)}</Select></Field>
          <Field label="Sector"><Input value={f.sector} placeholder="Circular economy" onChange={(e) => setF({ ...f, sector: e.target.value })} /></Field>
          <Field label="City"><Input value={f.city} onChange={(e) => setF({ ...f, city: e.target.value })} /></Field>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
          <Button disabled={pending || f.name.trim().length < 2} onClick={() => start(async () => {
            const r = await createOrganization({ ...f, type: f.type as never, sizeBand: (f.sizeBand || undefined) as never, createLead: true });
            if (r.ok) { toast.success(r.message); setOpen(false); if (r.data?.leadId) router.push(`/outreach/leads/${r.data.leadId}`); }
            else toast.error(r.error);
          })}>Create with lead</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
