"use client";

import { RefreshCw } from "lucide-react";
import { useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { recomputeLeadScores } from "@/lib/outreach/actions";

export function RecomputeButton() {
  const [pending, start] = useTransition();
  return (
    <Button variant="outline" disabled={pending} onClick={() => start(async () => {
      const r = await recomputeLeadScores();
      if (r.ok) toast.success(r.message); else toast.error(r.error);
    })}><RefreshCw className={pending ? "animate-spin" : undefined} />Recompute scores</Button>
  );
}
