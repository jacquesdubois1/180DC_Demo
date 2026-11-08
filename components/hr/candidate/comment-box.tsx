"use client";

import { useRef, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Select, Textarea } from "@/components/ui/input";
import { addComment } from "@/lib/hr/actions";

export function CommentBox({ applicationId, allowReviewerVisibility = true }: { applicationId: string; allowReviewerVisibility?: boolean }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const vis = useRef<HTMLSelectElement>(null);
  const [pending, start] = useTransition();
  return (
    <div className="space-y-2">
      <Textarea ref={ref} placeholder="Add an internal note…" className="min-h-20" />
      <div className="flex items-center justify-end gap-2">
        {allowReviewerVisibility ? (
          <Select ref={vis} defaultValue="hr" className="w-auto text-[13px]">
            <option value="hr">Visible to HR</option>
            <option value="reviewers">Visible to HR + assigned interviewers</option>
          </Select>
        ) : null}
        <Button size="sm" disabled={pending} onClick={() => start(async () => {
          const body = ref.current?.value ?? "";
          const res = await addComment(applicationId, body, (vis.current?.value as "hr" | "reviewers") ?? "hr");
          if (res.ok) { if (ref.current) ref.current.value = ""; toast.success("Note added"); }
          else toast.error(res.error);
        })}>Add note</Button>
      </div>
    </div>
  );
}
