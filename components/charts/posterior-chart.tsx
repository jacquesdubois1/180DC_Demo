"use client";

import { Area, AreaChart, CartesianGrid, Legend, ReferenceDot, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

const SERIES = ["var(--series-1)", "var(--series-2)", "var(--series-3)"];

/**
 * Posterior distributions of each variant's reply rate. Curves are scaled to their own peak
 * ("relative plausibility"), which is easier to read than a raw density. Where the curves
 * barely overlap the difference is real; heavy overlap means "keep testing".
 */
export function PosteriorChart({ data, variants, height = 210 }: { data: Record<string, number>[]; variants: string[]; height?: number }) {
  const peaks = variants.map((v) => {
    let best = data[0];
    for (const r of data) if (r[v] > best[v]) best = r;
    return { v, x: best.x, max: best[v] || 1 };
  });
  const maxX = (data.at(-1)?.x ?? 1) * 100;
  const step = maxX > 60 ? 20 : maxX > 30 ? 10 : 5;
  const ticks = Array.from({ length: Math.floor(maxX / step) + 1 }, (_, i) => i * step);
  const scaled = data.map((r) => {
    const o: Record<string, number> = { x: Math.round(r.x * 1000) / 10 };
    for (const p of peaks) o[p.v] = r[p.v] / p.max;
    return o;
  });
  return (
    <div style={{ height }} role="img" aria-label={`Posterior reply-rate distributions for variants ${variants.join(", ")}`}>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={scaled} margin={{ top: 18, right: 12, bottom: 0, left: -24 }}>
          <CartesianGrid stroke="var(--chart-grid)" vertical={false} />
          <XAxis dataKey="x" type="number" domain={[0, "dataMax"]} ticks={ticks} unit="%" tick={{ fontSize: 11, fill: "var(--chart-axis)" }} tickLine={false} axisLine={false} />
          <YAxis hide domain={[0, 1.15]} />
          <Tooltip
            cursor={{ stroke: "var(--chart-axis)", strokeDasharray: "3 3" }}
            contentStyle={{ background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 10, fontSize: 12, color: "var(--ink)" }}
            labelStyle={{ color: "var(--ink-3)" }}
            labelFormatter={(x) => `Reply rate ${x}%`}
            formatter={(v, name) => [`${Math.round((v as number) * 100)}% of peak`, `Variant ${name}`]}
          />
          <Legend verticalAlign="top" align="right" height={20} iconType="plainline" formatter={(v) => <span style={{ color: "var(--ink-2)", fontSize: 12 }}>Variant {v}</span>} />
          {variants.map((v, i) => (
            <Area key={v} isAnimationActive={false} type="monotone" dataKey={v} stroke={SERIES[i % SERIES.length]} strokeWidth={2}
              fill={SERIES[i % SERIES.length]} fillOpacity={0.12} activeDot={{ r: 4, strokeWidth: 2, stroke: "var(--surface)" }} />
          ))}
          {peaks.map((p) => (
            <ReferenceDot key={p.v} x={Math.round(p.x * 1000) / 10} y={1} r={0}
              label={{ value: `${p.v} · ${(p.x * 100).toFixed(1)}%`, position: "top", fontSize: 11, fill: "var(--ink-2)" }} />
          ))}
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
