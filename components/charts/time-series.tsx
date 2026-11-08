"use client";

import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

/** Single-series area chart with crosshair tooltip. */
export function TimeSeries({ data, label, height = 220 }: { data: { date: string; value: number }[]; label: string; height?: number }) {
  return (
    <div style={{ height }} role="img" aria-label={`${label} over time`}>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -18 }}>
          <defs>
            <linearGradient id="ts-fill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--series-1)" stopOpacity={0.25} />
              <stop offset="100%" stopColor="var(--series-1)" stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke="var(--chart-grid)" vertical={false} />
          <XAxis dataKey="date" tick={{ fontSize: 11, fill: "var(--chart-axis)" }} tickLine={false} axisLine={false} minTickGap={24} />
          <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: "var(--chart-axis)" }} tickLine={false} axisLine={false} />
          <Tooltip
            cursor={{ stroke: "var(--chart-axis)", strokeDasharray: "3 3" }}
            contentStyle={{ background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 10, fontSize: 12, color: "var(--ink)" }}
            labelStyle={{ color: "var(--ink-3)" }}
            formatter={(v) => [v as number, label]}
          />
          <Area isAnimationActive={false} type="monotone" dataKey="value" stroke="var(--series-1)" strokeWidth={2} fill="url(#ts-fill)" activeDot={{ r: 4, strokeWidth: 2, stroke: "var(--surface)" }} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
