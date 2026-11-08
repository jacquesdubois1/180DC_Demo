"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input, Textarea } from "@/components/ui/input";
import { reviewEmail } from "@/lib/hr/actions";

export function EmailReview({ email }: { email: { id: string; subject: string; body_text: string; status: string } }) {
  const [subject, setSubject] = useState(email.subject);
  const [body, setBody] = useState(email.body_text);
  const [pending, start] = useTransition();
  return (
    <div className="space-y-2 rounded-xl border border-warn/30 bg-warn-soft/40 p-3">
      <div className="flex items-center gap-2 text-[13px] font-medium text-warn"><Badge tone="warn">Needs review</Badge>Check the e-mail before it goes out</div>
      <Input value={subject} onChange={(e) => setSubject(e.target.value)} aria-label="Subject" />
      <Textarea value={body} onChange={(e) => setBody(e.target.value)} className="min-h-40 font-[inherit]" aria-label="Body" />
      <div className="flex justify-end gap-2">
        <Button size="sm" variant="ghost" disabled={pending} onClick={() => start(async () => {
          const r = await reviewEmail(email.id, "cancel");
          if (r.ok) toast.success(r.message); else toast.error(r.error);
        })}>Discard</Button>
        <Button size="sm" disabled={pending} onClick={() => start(async () => {
          const r = await reviewEmail(email.id, "send", { subject, body });
          if (r.ok) toast.success(r.message); else toast.error(r.error);
        })}>Approve &amp; send</Button>
      </div>
    </div>
  );
}
