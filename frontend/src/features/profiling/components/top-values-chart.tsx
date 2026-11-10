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
import { formatCount, formatPercent } from "@/lib/format";
import type { TopValue } from "@/types/api";

interface TopValuesChartProps {
  columnName: string;
  values: TopValue[];
}

function truncateLabel(value: string): string {
  return value.length > 14 ? `${value.slice(0, 13)}…` : value;
}

/** Ranked horizontal bars for a categorical column, with a table twin. */
export function TopValuesChart({ columnName, values }: TopValuesChartProps) {
  if (values.length === 0) {
    return null;
  }

  return (
    <figure className="space-y-2">
      <figcaption className="text-sm font-medium">
        Top values for {columnName}
      </figcaption>

      <div aria-hidden="true" className="h-56 w-full">
        <ResponsiveContainer height="100%" width="100%">
          <BarChart
            barCategoryGap={12}
            data={values}
            layout="vertical"
            margin={{ top: 4, right: 16, bottom: 8, left: 4 }}
          >
            <CartesianGrid horizontal={false} stroke="var(--viz-grid)" />
            <XAxis
              axisLine={{ stroke: "var(--viz-axis)" }}
              dataKey="count"
              height={36}
              label={{
                value: "Rows",
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
              dataKey="value"
              tick={{ fill: "var(--viz-muted)", fontSize: 12 }}
              tickFormatter={truncateLabel}
              tickLine={false}
              type="category"
              width={96}
            />
            <Tooltip
              contentStyle={{
                background: "var(--popover)",
                borderColor: "var(--border)",
                borderRadius: 8,
                color: "var(--popover-foreground)",
              }}
              cursor={{ fill: "var(--viz-neutral)" }}
              formatter={(value) => [formatCount(Number(value)), "Rows"]}
            />
            <Bar
              dataKey="count"
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
            Top values for {columnName}
          </TableCaption>
          <TableHeader>
            <TableRow>
              <TableHead>Value</TableHead>
              <TableHead className="text-right">Rows</TableHead>
              <TableHead className="text-right">Share</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {values.map((entry) => (
              <TableRow key={entry.value}>
                <TableCell>{entry.value}</TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatCount(entry.count)}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatPercent(entry.percentage, 2)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </details>
    </figure>
  );
}
