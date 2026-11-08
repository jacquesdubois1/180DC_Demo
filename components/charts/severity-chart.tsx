/**
 * Dot-and-whisker chart for reviewer severity (diverging around 0).
 * Left of zero (red) = harsher than the average reviewer, right (blue) = more lenient.
 * Whiskers = 95% interval. Server-rendered SVG with <title> tooltips.
 */
export function SeverityChart({ rows }: { rows: { name: string; severity: number; se: number; n: number }[] }) {
  const ext = Math.max(1, ...rows.map((r) => Math.abs(r.severity) + 1.96 * r.se)) * 1.05;
  const W = 560;
  const rowH = 40;
  const left = 130;
  const right = 70;
  const plotW = W - left - right;
  const H = rows.length * rowH + 34;
  const x = (v: number) => left + ((v + ext) / (2 * ext)) * plotW;
  const ticks = [-1, -0.5, 0, 0.5, 1].filter((t) => Math.abs(t) <= ext);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label="Reviewer severity estimates with 95% intervals">
      {ticks.map((t) => (
        <g key={t}>
          <line x1={x(t)} x2={x(t)} y1={8} y2={H - 24} stroke={t === 0 ? "var(--chart-axis)" : "var(--chart-grid)"} strokeWidth={t === 0 ? 1.5 : 1} />
          <text x={x(t)} y={H - 8} textAnchor="middle" fontSize="12.5" fill="var(--chart-axis)">{t > 0 ? `+${t}` : t}</text>
        </g>
      ))}
      <text x={x(-ext) + 4} y={H - 8} fontSize="12.5" fill="var(--ink-3)">← harsher</text>
      <text x={x(ext) - 4} y={H - 8} fontSize="12.5" fill="var(--ink-3)" textAnchor="end">more lenient →</text>
      {rows.map((r, i) => {
        const y = 20 + i * rowH;
        const color = Math.abs(r.severity) < 0.1 ? "var(--chart-axis)" : r.severity < 0 ? "var(--div-neg)" : "var(--div-pos)";
        return (
          <g key={r.name}>
            <title>{`${r.name}: ${r.severity >= 0 ? "+" : ""}${r.severity.toFixed(2)} points (95% interval ${(r.severity - 1.96 * r.se).toFixed(2)} to ${(r.severity + 1.96 * r.se).toFixed(2)}), ${r.n} reviews`}</title>
            <text x={left - 12} y={y + 4} textAnchor="end" fontSize="14" fill="var(--ink-2)">{r.name}</text>
            <line x1={x(r.severity - 1.96 * r.se)} x2={x(r.severity + 1.96 * r.se)} y1={y} y2={y} stroke={color} strokeWidth={2} strokeLinecap="round" opacity={0.55} />
            <circle cx={x(r.severity)} cy={y} r={5.5} fill={color} stroke="var(--surface)" strokeWidth={2} />
            <text x={W - right + 10} y={y + 4} fontSize="14" fill="var(--ink)" className="tabular">
              {r.severity >= 0 ? "+" : ""}{r.severity.toFixed(2)}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
