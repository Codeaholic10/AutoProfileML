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
import type { FeatureImportance } from "@/types/api";

const DISPLAY_LIMIT = 15;

function truncate(value: string): string {
  return value.length > 24 ? `${value.slice(0, 23)}…` : value;
}

/** Top features by mean absolute SHAP value, with a table twin. */
export function GlobalImportanceChart({
  importance,
}: {
  importance: FeatureImportance[];
}) {
  const data = importance.slice(0, DISPLAY_LIMIT);

  if (data.length === 0) {
    return (
      <p className="rounded-xl border border-dashed px-4 py-6 text-sm text-muted-foreground">
        No global feature importances were computed.
      </p>
    );
  }

  return (
    <figure className="space-y-2">
      <figcaption className="space-y-1">
        <span className="block text-sm font-medium">
          Global feature importance (mean |SHAP|)
        </span>
        <span className="block text-xs text-muted-foreground">
          How much each encoded feature moves the model output on average.
        </span>
      </figcaption>

      <div
        aria-hidden="true"
        style={{ height: Math.max(200, data.length * 30) }}
        className="w-full"
      >
        <ResponsiveContainer height="100%" width="100%">
          <BarChart
            barCategoryGap={8}
            data={data}
            layout="vertical"
            margin={{ top: 4, right: 24, bottom: 8, left: 4 }}
          >
            <CartesianGrid horizontal={false} stroke="var(--viz-grid)" />
            <XAxis
              axisLine={{ stroke: "var(--viz-axis)" }}
              height={36}
              label={{
                value: "mean |SHAP|",
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
              dataKey="feature"
              tick={{ fill: "var(--viz-muted)", fontSize: 12 }}
              tickFormatter={truncate}
              tickLine={false}
              type="category"
              width={160}
            />
            <Tooltip
              contentStyle={{
                background: "var(--popover)",
                borderColor: "var(--border)",
                borderRadius: 8,
                color: "var(--popover-foreground)",
              }}
              cursor={{ fill: "var(--viz-neutral)" }}
              formatter={(value) => [formatMetric(Number(value)), "mean |SHAP|"]}
            />
            <Bar
              dataKey="mean_abs_shap"
              fill="var(--viz-series-1)"
              maxBarSize={16}
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
            Global feature importance by mean absolute SHAP value
          </TableCaption>
          <TableHeader>
            <TableRow>
              <TableHead className="w-14">Rank</TableHead>
              <TableHead>Feature</TableHead>
              <TableHead className="text-right">mean |SHAP|</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {importance.map((entry) => (
              <TableRow key={entry.feature}>
                <TableCell className="tabular-nums">{entry.rank}</TableCell>
                <TableCell className="font-mono text-xs">{entry.feature}</TableCell>
                <TableCell className="text-right font-mono tabular-nums">
                  {formatMetric(entry.mean_abs_shap)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </details>
    </figure>
  );
}
