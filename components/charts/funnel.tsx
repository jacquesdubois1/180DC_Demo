/** Funnel as horizontal steps: absolute count + conversion from the previous step. */
export function Funnel({ steps }: { steps: { label: string; value: number }[] }) {
  const top = Math.max(1, steps[0]?.value ?? 1);
  return (
    <ol className="space-y-2.5">
      {steps.map((s, i) => {
        const prev = i > 0 ? steps[i - 1].value : null;
        const conv = prev ? s.value / prev : null;
        return (
          <li key={s.label} className="grid grid-cols-[8.5rem_1fr_5.5rem] items-center gap-3 text-[13px]" title={`${s.label}: ${s.value}`}>
            <span className="text-ink-2">{s.label}</span>
            <span className="flex h-6 items-center gap-2 overflow-hidden rounded-md bg-surface-2">
              <span className="flex h-full shrink-0 items-center rounded-md px-2 text-[12px] font-semibold text-white dark:text-[#0d1a12]"
                style={{ width: `${Math.max(2, (s.value / top) * 100)}%`, background: "var(--series-1)" }}>
                {s.value / top >= 0.15 ? s.value : null}
              </span>
              {s.value / top < 0.15 ? <span className="text-[12px] font-semibold tabular">{s.value}</span> : null}
            </span>
            <span className="text-right text-[12px] text-ink-3 tabular">{conv === null ? "" : `${Math.round(conv * 100)}% of prev.`}</span>
          </li>
        );
      })}
    </ol>
  );
}
