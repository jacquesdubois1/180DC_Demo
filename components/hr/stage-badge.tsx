import { Badge } from "@/components/ui/badge";
import { type ApplicationStage, STAGE_META } from "@/lib/hr/stages";

export function StageBadge({ stage }: { stage: ApplicationStage }) {
  const m = STAGE_META[stage];
  return <Badge tone={m.tone}>{m.label}</Badge>;
}
