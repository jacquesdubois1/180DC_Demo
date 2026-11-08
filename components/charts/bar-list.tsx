import { cn } from "@/lib/utils";

/** Horizontal bars with direct labels (single series, accessible, no JS). */
export function BarList({ rows, format = (v) => String(v), color = "var(--series-1)", className, max }: {
  rows: { label: string; value: number; sub?: string; href?: string }[];
  format?: (v: number) => string;
  color?: string;
  className?: string;
  max?: number;
}) {
  const top = max ?? Math.max(1, ...rows.map((r) => r.value));
  return (
    <ul className={cn("space-y-2", className)}>
      {rows.map((r) => (
        <li key={r.label} className="grid grid-cols-[minmax(0,10rem)_1fr_auto] items-center gap-3 text-[13px]" title={`${r.label}: ${format(r.value)}`}>
          <span className="truncate text-ink-2">{r.label}</span>
          <span className="h-2.5 overflow-hidden rounded-full bg-surface-2">
            <span className="block h-full rounded-full" style={{ width: `${(r.value / top) * 100}%`, background: color }} />
          </span>
          <span className="tabular text-right font-medium">
            {format(r.value)}{r.sub ? <span className="ml-1.5 font-normal text-ink-3">{r.sub}</span> : null}
          </span>
        </li>
      ))}
    </ul>
  );
}
