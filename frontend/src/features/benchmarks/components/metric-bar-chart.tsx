"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatMetric } from "@/lib/format";
import type { BenchmarkRun } from "@/types/api";

import { metricLabel, primaryMetric, sortModels } from "../metrics";

/** Primary-metric comparison across succeeded models, with a table twin. */
export function MetricBarChart({ run }: { run: BenchmarkRun }) {
  const metric = primaryMetric(run.task_type);
  const models = sortModels(run.leaderboard, metric);
  const data = models.map((model) => ({
    name: model.name,
    value: model.metrics[metric] ?? 0,
  }));

  if (data.length === 0) {
    return (
      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Model comparison</h2>
        <p className="rounded-xl border border-dashed px-4 py-6 text-sm text-muted-foreground">
          No model completed successfully, so there is nothing to compare.
        </p>
      </section>
    );
  }

  return (
    <figure className="space-y-2">
      <figcaption className="space-y-1">
        <span className="block text-lg font-semibold">Model comparison</span>
        <span className="block text-sm text-muted-foreground">
          {metricLabel(metric)} by model · {run.task_type === "classification"
            ? "higher is better"
            : "lower is better"}
        </span>
      </figcaption>

      <div
        aria-hidden="true"
        style={{ height: Math.max(180, data.length * 48) }}
        className="w-full"
      >
        <ResponsiveContainer height="100%" width="100%">
          <BarChart
            barCategoryGap={12}
            data={data}
            layout="vertical"
            margin={{ top: 4, right: 24, bottom: 8, left: 4 }}
          >
            <CartesianGrid horizontal={false} stroke="var(--viz-grid)" />
            <XAxis
              axisLine={{ stroke: "var(--viz-axis)" }}
              height={36}
              label={{
                value: metricLabel(metric),
                position: "insideBottom",
                offset: -4,
                fill: "var(--viz-muted)",
                fontSize: 12,
              }}
              tick={{ fill: "var(--viz-muted)", fontSize: 12 }}
              tickLine={false}
              type="number"
            />
            <YAxis
              axisLine={false}
              dataKey="name"
              tick={{ fill: "var(--viz-muted)", fontSize: 12 }}
              tickLine={false}
              type="category"
              width={132}
            />
            <Tooltip
              contentStyle={{
                background: "var(--popover)",
                borderColor: "var(--border)",
                borderRadius: 8,
                color: "var(--popover-foreground)",
              }}
              cursor={{ fill: "var(--viz-neutral)" }}
              formatter={(value) => [formatMetric(Number(value)), metricLabel(metric)]}
            />
            <Bar
              dataKey="value"
              fill="var(--viz-series-1)"
              maxBarSize={24}
              radius={[0, 4, 4, 0]}
            />
          </BarChart>
        </ResponsiveContainer>
      </div>

      <details className="text-sm">
        <summary className="cursor-pointer text-muted-foreground">
          View as table
        </summary>
        <Table>
          <TableCaption className="sr-only">
            {metricLabel(metric)} by model
          </TableCaption>
          <TableHeader>
            <TableRow>
              <TableHead>Model</TableHead>
              <TableHead className="text-right">{metricLabel(metric)}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.map((entry) => (
              <TableRow key={entry.name}>
                <TableCell>{entry.name}</TableCell>
                <TableCell className="text-right font-mono tabular-nums">
                  {formatMetric(entry.value)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </details>
    </figure>
  );
}
