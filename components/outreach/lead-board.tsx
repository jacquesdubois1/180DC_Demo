"use client";

import { DndContext, type DragEndEvent, PointerSensor, useDraggable, useDroppable, useSensor, useSensors } from "@dnd-kit/core";
import { GraduationCap, GripVertical } from "lucide-react";
import Link from "next/link";
import { useOptimistic, useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/input";
import { Avatar } from "@/components/ui/misc";
import { moveLead } from "@/lib/outreach/actions";
import { CLOSING, LEAD_BOARD, LEAD_META, type LeadStage } from "@/lib/outreach/stages";
import { cn } from "@/lib/utils";

export interface LeadCard {
  id: string; org: string; owner: string | null; stage: LeadStage; fit: number | null; win: number | null; due: string | null;
  overdue: boolean; idle: number; contact: string | null; alumni: boolean; nextStep: string | null;
}

export function LeadBoard({ cards }: { cards: LeadCard[] }) {
  const [items, setOptimistic] = useOptimistic(cards, (s, u: { id: string; stage: LeadStage }) => s.map((c) => (c.id === u.id ? { ...c, stage: u.stage, idle: 0 } : c)));
  const [, start] = useTransition();
  const [pending, setPending] = useState<{ card: LeadCard; to: LeadStage } | null>(null);
  const [reason, setReason] = useState("");
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  const commit = (card: LeadCard, to: LeadStage, note?: string) => start(async () => {
    setOptimistic({ id: card.id, stage: to });
    const r = await moveLead(card.id, to, note);
    if (r.ok) toast.success(`${card.org}: ${r.message}`); else toast.error(r.error);
  });
  const onDragEnd = (e: DragEndEvent) => {
    const card = items.find((c) => c.id === e.active.id);
    const to = e.over?.id as LeadStage | undefined;
    if (!card || !to || to === card.stage) return;
    if (CLOSING.includes(to)) { setReason(""); setPending({ card, to }); return; }
    commit(card, to);
  };

  return (
    <>
      <DndContext sensors={sensors} onDragEnd={onDragEnd}>
        <div className="flex gap-3 overflow-x-auto pb-4">
          {LEAD_BOARD.map((stage) => {
            const col = items.filter((c) => c.stage === stage);
            const expected = col.reduce((s, c) => s + (c.win ?? 0), 0);
            return (
              <Column key={stage} stage={stage} count={col.length} expected={expected}>
                {col.map((c) => <Card key={c.id} card={c} />)}
              </Column>
            );
          })}
        </div>
      </DndContext>
      <Dialog open={!!pending} onOpenChange={(o) => !o && setPending(null)}>
        {pending ? (
          <DialogContent title={`${LEAD_META[pending.to].label}: ${pending.card.org}`} description="Why? The reason helps us learn which organisations to target next time.">
            <Textarea autoFocus value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. no capacity this semester" />
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="outline" onClick={() => setPending(null)}>Cancel</Button>
              <Button disabled={reason.trim().length < 3} onClick={() => { commit(pending.card, pending.to, reason); setPending(null); }}>Confirm</Button>
            </div>
          </DialogContent>
        ) : null}
      </Dialog>
    </>
  );
}

function Column({ stage, count, expected, children }: { stage: LeadStage; count: number; expected: number; children: React.ReactNode }) {
  const { isOver, setNodeRef } = useDroppable({ id: stage });
  return (
    <section ref={setNodeRef} className={cn("flex w-[268px] shrink-0 flex-col rounded-2xl border bg-surface-2/60", isOver ? "border-brand bg-brand-soft/60" : "border-line")}>
      <div className="flex items-center gap-2 px-3 py-2.5">
        <span className="text-[13px] font-semibold">{LEAD_META[stage].label}</span>
        <span className="rounded-full bg-surface px-1.5 text-[11.5px] font-medium text-ink-2 tabular">{count}</span>
        {!LEAD_META[stage].closed && count ? <span className="ml-auto text-[11.5px] text-ink-3 tabular" title="Expected signed projects (sum of win probabilities)">≈{expected.toFixed(1)} proj.</span> : null}
      </div>
      <div className="flex max-h-[calc(100vh-260px)] min-h-24 flex-col gap-2 overflow-y-auto px-2 pb-2">{children}</div>
    </section>
  );
}

function Card({ card }: { card: LeadCard }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: card.id });
  const style = transform ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)` } : undefined;
  return (
    <article ref={setNodeRef} style={style} className={cn("group rounded-xl border border-line bg-surface p-3", isDragging && "z-10 rotate-1 shadow-lg")}>
      <div className="flex items-start gap-2">
        <button {...listeners} {...attributes} className="mt-0.5 cursor-grab text-ink-3 opacity-40 group-hover:opacity-100" aria-label={`Move ${card.org}`}><GripVertical className="size-4" /></button>
        <div className="min-w-0 flex-1">
          <Link href={`/outreach/leads/${card.id}`} className="block truncate text-[13.5px] font-medium hover:text-brand">{card.org}</Link>
          <div className="flex items-center gap-1 truncate text-[12px] text-ink-3">
            {card.alumni ? <GraduationCap className="size-3.5 text-brand" aria-label="Esade alumni contact" /> : null}{card.contact ?? "no contact yet"}
          </div>
        </div>
        {card.fit !== null ? <span className="rounded-md bg-surface-2 px-1.5 py-0.5 text-[11.5px] font-semibold tabular" title="ICP fit score">{Math.round(card.fit)}</span> : null}
      </div>
      {card.nextStep ? <div className="mt-2 truncate text-[12px] text-ink-2">→ {card.nextStep}</div> : null}
      <div className="mt-2 flex items-center gap-2 text-[11.5px] text-ink-3">
        {card.owner ? <Avatar name={card.owner} className="size-5 text-[9px]" /> : null}
        {card.due ? <span className={cn(card.overdue && "font-medium text-danger")}>{card.overdue ? "overdue " : "due "}{new Date(card.due).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}</span> : null}
        {card.win !== null && !LEAD_META[card.stage].closed ? <span className="ml-auto tabular" title="Probability to sign">{Math.round(card.win * 100)}%</span> : null}
        {card.idle > 14 && !LEAD_META[card.stage].closed ? <span className="text-warn">idle {card.idle}d</span> : null}
      </div>
    </article>
  );
}
