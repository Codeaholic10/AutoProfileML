"use client";

import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
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
import type { OutOfFoldPredictions } from "@/types/api";

import { buildRocCurves, rocChartData } from "../analysis";

const SERIES_COLORS = [
  "var(--viz-series-1)",
  "var(--viz-series-2)",
  "var(--viz-series-3)",
  "var(--viz-series-4)",
  "var(--viz-series-5)",
] as const;

/** One-vs-rest ROC curves plus a macro average, from stored probabilities. */
export function RocCurveChart({
  predictions,
}: {
  predictions: OutOfFoldPredictions;
}) {
  const { curves, hiddenClasses } = buildRocCurves(predictions);

  if (curves.length === 0) {
    return (
      <p className="rounded-xl border border-dashed px-4 py-6 text-sm text-muted-foreground">
        ROC curves need stored out-of-fold probabilities. This model has none, for
        example because the run failed before predictions were written.
      </p>
    );
  }

  const data = rocChartData(curves);

  return (
    <figure className="space-y-2">
      <figcaption className="space-y-1">
        <span className="block text-sm font-medium">
          ROC curves (one-vs-rest)
        </span>
        <span className="block text-xs text-muted-foreground">
          Computed from {predictions.prediction_count} out-of-fold predictions.
          {hiddenClasses > 0
            ? ` ${hiddenClasses} additional class${
                hiddenClasses === 1 ? "" : "es"
              } not shown.`
            : ""}
        </span>
      </figcaption>

      <div aria-hidden="true" className="h-72 w-full">
        <ResponsiveContainer height="100%" width="100%">
          <LineChart
            data={data}
            margin={{ top: 8, right: 16, bottom: 12, left: 8 }}
          >
            <CartesianGrid stroke="var(--viz-grid)" strokeDasharray="3 3" />
            <XAxis
              axisLine={{ stroke: "var(--viz-axis)" }}
              dataKey="fpr"
              domain={[0, 1]}
              label={{
                value: "False positive rate",
                position: "insideBottom",
                offset: -6,
                fill: "var(--viz-muted)",
                fontSize: 12,
              }}
              tick={{ fill: "var(--viz-muted)", fontSize: 12 }}
              tickFormatter={(value) => Number(value).toFixed(1)}
              tickLine={false}
              type="number"
            />
            <YAxis
              axisLine={{ stroke: "var(--viz-axis)" }}
              domain={[0, 1]}
              label={{
                value: "True positive rate",
                angle: -90,
                position: "insideLeft",
                fill: "var(--viz-muted)",
                fontSize: 12,
              }}
              tick={{ fill: "var(--viz-muted)", fontSize: 12 }}
              tickFormatter={(value) => Number(value).toFixed(1)}
              tickLine={false}
            />
            <ReferenceLine
              segment={[
                { x: 0, y: 0 },
                { x: 1, y: 1 },
              ]}
              stroke="var(--viz-axis)"
              strokeDasharray="4 4"
            />
            <Tooltip
              contentStyle={{
                background: "var(--popover)",
                borderColor: "var(--border)",
                borderRadius: 8,
                color: "var(--popover-foreground)",
              }}
              formatter={(value, name) => [
                Number(value).toFixed(3),
                String(name),
              ]}
              labelFormatter={(label) =>
                `False positive rate ${Number(label).toFixed(2)}`
              }
            />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            {curves.map((curve, index) => (
              <Line
                key={curve.label}
                dataKey={`series${index}`}
                dot={false}
                isAnimationActive={false}
                name={`${curve.label} (AUC ${curve.auc.toFixed(3)})`}
                stroke={SERIES_COLORS[index % SERIES_COLORS.length]}
                strokeWidth={index === 0 ? 2.5 : 2}
                type="monotone"
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>

      <details className="text-sm">
        <summary className="cursor-pointer text-muted-foreground">
          View AUC summary
        </summary>
        <Table>
          <TableCaption className="sr-only">
            Area under the ROC curve by class
          </TableCaption>
          <TableHeader>
            <TableRow>
              <TableHead>Curve</TableHead>
              <TableHead className="text-right">AUC</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {curves.map((curve) => (
              <TableRow key={curve.label}>
                <TableCell>{curve.label}</TableCell>
                <TableCell className="text-right font-mono tabular-nums">
                  {curve.auc.toFixed(3)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </details>
    </figure>
  );
}
