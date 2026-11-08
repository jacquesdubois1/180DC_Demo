import * as React from "react";
import { cn, initials } from "@/lib/utils";

export function Avatar({ name, className }: { name: string; className?: string }) {
  return (
    <span className={cn("inline-flex size-7 shrink-0 items-center justify-center rounded-full bg-brand-soft text-[11px] font-semibold text-brand", className)}>
      {initials(name)}
    </span>
  );
}

export function PageHeader({ eyebrow, title, description, actions }: {
  eyebrow?: string; title: string; description?: React.ReactNode; actions?: React.ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        {eyebrow ? <div className="eyebrow mb-1">{eyebrow}</div> : null}
        <h1 className="text-[26px] font-semibold leading-tight tracking-tight text-balance">{title}</h1>
        {description ? <p className="mt-1.5 max-w-[70ch] text-[14px] text-ink-2">{description}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}

export function Stat({ label, value, sub, tone = "default" }: {
  label: string; value: React.ReactNode; sub?: React.ReactNode; tone?: "default" | "warn" | "danger" | "brand";
}) {
  const color = { default: "text-ink", warn: "text-warn", danger: "text-danger", brand: "text-brand" }[tone];
  return (
    <div className="min-w-0 rounded-2xl border border-line bg-surface px-4 py-3.5">
      <div className="text-[12px] font-medium text-ink-3">{label}</div>
      <div className={cn("mt-1 text-[24px] font-semibold leading-tight tracking-tight tabular", color)}>{value}</div>
      {sub ? <div className="mt-0.5 text-[12px] text-ink-3">{sub}</div> : null}
    </div>
  );
}

export function EmptyState({ title, children, icon }: { title: string; children?: React.ReactNode; icon?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-line px-6 py-12 text-center">
      {icon ? <div className="mb-3 text-ink-3">{icon}</div> : null}
      <div className="font-medium">{title}</div>
      {children ? <div className="mt-1 max-w-md text-[13px] text-ink-3">{children}</div> : null}
    </div>
  );
}

export function Kbd({ children }: { children: React.ReactNode }) {
  return <kbd className="rounded border border-line bg-surface-2 px-1.5 py-0.5 font-mono text-[11px] text-ink-2">{children}</kbd>;
}

export function Progress({ value, className }: { value: number; className?: string }) {
  return (
    <div className={cn("h-1.5 w-full overflow-hidden rounded-full bg-surface-2", className)}>
      <div className="h-full rounded-full bg-brand" style={{ width: `${Math.max(0, Math.min(100, value * 100))}%` }} />
    </div>
  );
}
