"use client";

import { CartesianGrid, ReferenceLine, ResponsiveContainer, Scatter, ScatterChart, Tooltip, XAxis, YAxis } from "recharts";

/** Raw-average rank vs calibrated rank. Points off the diagonal changed rank after calibration. */
export function RankScatter({ points }: { points: { alias: string; raw: number; cal: number; shift: number }[] }) {
  const n = Math.max(1, ...points.map((p) => Math.max(p.raw, p.cal)));
  return (
    <div style={{ height: 300 }} role="img" aria-label="Rank by raw average versus calibrated rank">
      <ResponsiveContainer width="100%" height="100%">
        <ScatterChart margin={{ top: 8, right: 12, bottom: 18, left: 0 }}>
          <CartesianGrid stroke="var(--chart-grid)" />
          <XAxis type="number" dataKey="raw" name="Rank (raw average)" domain={[1, n]} reversed tick={{ fontSize: 11, fill: "var(--chart-axis)" }}
            label={{ value: "rank by raw average", position: "insideBottom", offset: -10, fontSize: 11, fill: "var(--ink-3)" }} />
          <YAxis type="number" dataKey="cal" name="Rank (calibrated)" domain={[1, n]} reversed tick={{ fontSize: 11, fill: "var(--chart-axis)" }}
            label={{ value: "calibrated rank", angle: -90, position: "insideLeft", offset: 14, fontSize: 11, fill: "var(--ink-3)" }} />
          <ReferenceLine segment={[{ x: 1, y: 1 }, { x: n, y: n }]} stroke="var(--chart-axis)" strokeDasharray="4 4" />
          <Tooltip
            cursor={{ strokeDasharray: "3 3" }}
            contentStyle={{ background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 10, fontSize: 12, color: "var(--ink)" }}
            formatter={(v, name) => [v as number, name as string]}
            labelFormatter={() => ""}
            content={({ payload }) => {
              const p = payload?.[0]?.payload as { alias: string; raw: number; cal: number; shift: number } | undefined;
              if (!p) return null;
              return (
                <div className="rounded-lg border border-line bg-surface px-3 py-2 text-[12px] shadow-sm">
                  <div className="font-mono text-ink-3">{p.alias}</div>
                  <div>raw rank {p.raw} → calibrated {p.cal}</div>
                  <div className={p.shift > 0 ? "text-brand" : p.shift < 0 ? "text-danger" : "text-ink-3"}>
                    {p.shift > 0 ? `up ${p.shift}` : p.shift < 0 ? `down ${-p.shift}` : "unchanged"}
                  </div>
                </div>
              );
            }}
          />
          <Scatter isAnimationActive={false} data={points.filter((p) => Math.abs(p.shift) < 5)} fill="var(--chart-axis)" fillOpacity={0.6} />
          <Scatter isAnimationActive={false} data={points.filter((p) => Math.abs(p.shift) >= 5)} fill="var(--series-2)" />
        </ScatterChart>
      </ResponsiveContainer>
    </div>
  );
}
