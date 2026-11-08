"use client";

import { DndContext, type DragEndEvent, PointerSensor, useDraggable, useDroppable, useSensor, useSensors } from "@dnd-kit/core";
import { ChevronDown, ChevronRight, FileText, GripVertical } from "lucide-react";
import Link from "next/link";
import { useOptimistic, useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/input";
import { moveApplication } from "@/lib/hr/actions";
import { type ApplicationStage, BOARD_COLUMNS, NEEDS_REASON, STAGE_META, TRANSITIONS } from "@/lib/hr/stages";
import { cn } from "@/lib/utils";

export interface BoardCard {
  id: string; alias: string; name: string; position: string; stage: ApplicationStage; avg: number | null;
  submitted: number; assigned: number; yes: number; maybe: number; no: number; daysInStage: number; hasCv: boolean;
}

export function PipelineBoard({ cards }: { cards: BoardCard[] }) {
  const [items, setOptimistic] = useOptimistic(cards, (state, upd: { id: string; stage: ApplicationStage }) =>
    state.map((c) => (c.id === upd.id ? { ...c, stage: upd.stage, daysInStage: 0 } : c)));
  const [, start] = useTransition();
  const [pending, setPending] = useState<{ card: BoardCard; to: ApplicationStage } | null>(null);
  const [reason, setReason] = useState("");
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({ rejected: true });
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  const commit = (card: BoardCard, to: ApplicationStage, note?: string) => {
    start(async () => {
      setOptimistic({ id: card.id, stage: to });
      const res = await moveApplication(card.id, to, note);
      if (res.ok) toast.success(`${card.name}: ${res.message}`);
      else toast.error(res.error);
    });
  };

  const onDragEnd = (e: DragEndEvent) => {
    const card = items.find((c) => c.id === e.active.id);
    const to = e.over?.id as ApplicationStage | undefined;
    if (!card || !to || to === card.stage) return;
    if (!TRANSITIONS[card.stage].includes(to)) {
      toast.error(`${STAGE_META[card.stage].label} → ${STAGE_META[to].label} is not a valid step`);
      return;
    }
    if (NEEDS_REASON.includes(to)) {
      setReason("");
      setPending({ card, to });
      return;
    }
    commit(card, to);
  };

  return (
    <>
      <DndContext sensors={sensors} onDragEnd={onDragEnd}>
        <div className="flex gap-3 overflow-x-auto pb-4">
          {BOARD_COLUMNS.map((stage) => {
            const col = items.filter((c) => c.stage === stage);
            return (
              <Column key={stage} stage={stage} count={col.length} collapsed={!!collapsed[stage]}
                onToggle={() => setCollapsed((s) => ({ ...s, [stage]: !s[stage] }))}>
                {col.map((c) => <Card key={c.id} card={c} />)}
              </Column>
            );
          })}
        </div>
      </DndContext>
      <Dialog open={!!pending} onOpenChange={(o) => !o && setPending(null)}>
        {pending ? (
          <DialogContent title={`${STAGE_META[pending.to].label}: ${pending.card.name}`}
            description="Decisions are recorded with a reason (visible to HR only). The candidate e-mail is prepared for your review, not sent automatically.">
            <Textarea autoFocus value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason for the decision…" />
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="outline" onClick={() => setPending(null)}>Cancel</Button>
              <Button variant={pending.to === "rejected" ? "danger" : "primary"} disabled={reason.trim().length < 5}
                onClick={() => { commit(pending.card, pending.to, reason); setPending(null); }}>
                Confirm
              </Button>
            </div>
          </DialogContent>
        ) : null}
      </Dialog>
    </>
  );
}

function Column({ stage, count, collapsed, onToggle, children }: { stage: ApplicationStage; count: number; collapsed: boolean; onToggle: () => void; children: React.ReactNode }) {
  const { isOver, setNodeRef } = useDroppable({ id: stage });
  const meta = STAGE_META[stage];
  return (
    <section ref={setNodeRef}
      className={cn("flex shrink-0 flex-col rounded-2xl border bg-surface-2/60 transition-colors", collapsed ? "w-14" : "w-[272px]",
        isOver ? "border-brand bg-brand-soft/60" : "border-line")}>
      <button onClick={onToggle} className={cn("flex items-center gap-2 px-3 py-2.5 text-left", collapsed && "h-full flex-col")}
        aria-label={`${meta.label}: ${count} applications`}>
        {collapsed ? <ChevronRight className="size-4 text-ink-3" /> : <ChevronDown className="size-4 text-ink-3" />}
        <span className={cn("text-[13px] font-semibold", collapsed && "[writing-mode:vertical-rl]")}>{meta.label}</span>
        <span className="rounded-full bg-surface px-1.5 text-[11.5px] font-medium text-ink-2 tabular">{count}</span>
      </button>
      {!collapsed ? <div className="flex max-h-[calc(100vh-250px)] min-h-24 flex-col gap-2 overflow-y-auto px-2 pb-2">{children}</div> : null}
    </section>
  );
}

function Card({ card }: { card: BoardCard }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: card.id });
  const style = transform ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)` } : undefined;
  const votes = card.yes + card.maybe + card.no;
  return (
    <article ref={setNodeRef} style={style}
      className={cn("group rounded-xl border border-line bg-surface p-3 shadow-[0_1px_0_rgba(0,0,0,0.02)]", isDragging && "z-10 rotate-1 shadow-lg")}>
      <div className="flex items-start gap-2">
        <button {...listeners} {...attributes} className="mt-0.5 cursor-grab text-ink-3 opacity-40 group-hover:opacity-100" aria-label={`Move ${card.name}`}>
          <GripVertical className="size-4" />
        </button>
        <div className="min-w-0 flex-1">
          <Link href={`/hr/applications/${card.id}`} className="block truncate text-[13.5px] font-medium hover:text-brand">{card.name}</Link>
          <div className="truncate text-[12px] text-ink-3">{card.position}</div>
        </div>
        {card.avg !== null ? (
          <span className="rounded-md bg-surface-2 px-1.5 py-0.5 text-[12px] font-semibold tabular" title="Average score (1-5)">{card.avg.toFixed(1)}</span>
        ) : null}
      </div>
      <div className="mt-2.5 flex items-center gap-2 text-[11.5px] text-ink-3">
        {votes ? (
          <span className="flex overflow-hidden rounded-full" title={`${card.yes} yes · ${card.maybe} maybe · ${card.no} no`}>
            {Array.from({ length: card.yes }).map((_, i) => <span key={`y${i}`} className="h-2 w-3 bg-[var(--series-1)]" />)}
            {Array.from({ length: card.maybe }).map((_, i) => <span key={`m${i}`} className="h-2 w-3 bg-warn" />)}
            {Array.from({ length: card.no }).map((_, i) => <span key={`n${i}`} className="h-2 w-3 bg-danger" />)}
          </span>
        ) : null}
        <span>{card.submitted}/{card.assigned || "–"} reviews</span>
        {card.hasCv ? <FileText className="size-3.5" aria-label="CV attached" /> : null}
        <span className="ml-auto">{card.daysInStage}d</span>
      </div>
    </article>
  );
}
