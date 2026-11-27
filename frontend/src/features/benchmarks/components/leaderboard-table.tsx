"use client";

import { ArrowDownIcon, ArrowUpDownIcon, ArrowUpIcon } from "lucide-react";
import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatDuration, formatMetric } from "@/lib/format";
import type { BenchmarkRun, ModelResult } from "@/types/api";

import {
  isHigherBetter,
  metricLabel,
  primaryMetric,
  SECONDARY_METRICS,
  sortModels,
} from "../metrics";

type SortDirection = "asc" | "desc";

function defaultDirection(metric: string): SortDirection {
  return isHigherBetter(metric) ? "desc" : "asc";
}

function comparisonValue(model: ModelResult, metric: string): number {
  if (metric === "training_seconds") {
    return model.training_seconds;
  }
  return model.metrics[metric] ?? Number.NEGATIVE_INFINITY;
}

function sortRows(
  run: BenchmarkRun,
  sortKey: string,
  direction: SortDirection,
): ModelResult[] {
  if (sortKey === primaryMetric(run.task_type)) {
    return sortModels(run.leaderboard, sortKey, direction);
  }
  const succeeded = run.leaderboard.filter((model) => model.status === "succeeded");
  const failed = run.leaderboard.filter((model) => model.status !== "succeeded");
  const ordered = [...succeeded].sort((left, right) => {
    const difference =
      comparisonValue(left, sortKey) - comparisonValue(right, sortKey);
    return direction === "asc" ? difference : -difference;
  });
  return [...ordered, ...failed];
}

/** Cross-validated model comparison, sortable by any metric column. */
export function LeaderboardTable({ run }: { run: BenchmarkRun }) {
  const metric = primaryMetric(run.task_type);
  const secondary = SECONDARY_METRICS[run.task_type];
  const [sortKey, setSortKey] = useState(metric);
  const [direction, setDirection] = useState<SortDirection>(
    defaultDirection(metric),
  );

  const rows = sortRows(run, sortKey, direction);

  function toggleSort(key: string) {
    if (key === sortKey) {
      setDirection((current) => (current === "asc" ? "desc" : "asc"));
      return;
    }
    setSortKey(key);
    setDirection(defaultDirection(key));
  }

  function sortIcon(key: string) {
    if (key !== sortKey) {
      return <ArrowUpDownIcon aria-hidden="true" className="size-3.5 opacity-50" />;
    }
    return direction === "asc" ? (
      <ArrowUpIcon aria-hidden="true" className="size-3.5" />
    ) : (
      <ArrowDownIcon aria-hidden="true" className="size-3.5" />
    );
  }

  function header(key: string, label: string, numeric = true) {
    return (
      <TableHead
        key={key}
        aria-sort={
          key === sortKey ? (direction === "asc" ? "ascending" : "descending") : "none"
        }
        className={numeric ? "text-right" : undefined}
      >
        <button
          type="button"
          onClick={() => toggleSort(key)}
          className="inline-flex items-center gap-1 font-medium hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        >
          {label}
          {sortIcon(key)}
        </button>
      </TableHead>
    );
  }

  if (run.leaderboard.length === 0) {
    return (
      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Leaderboard</h2>
        <p className="rounded-xl border border-dashed px-4 py-6 text-sm text-muted-foreground">
          No model results were recorded for this run.
        </p>
      </section>
    );
  }

  return (
    <section aria-labelledby="leaderboard-heading" className="space-y-3">
      <div className="space-y-1">
        <h2 id="leaderboard-heading" className="text-lg font-semibold">
          Leaderboard
        </h2>
        <p className="text-sm text-muted-foreground">
          {run.folds}-fold cross-validation, mean metrics with standard deviation.
          Sort by any metric column.
        </p>
      </div>

      <div className="overflow-x-auto rounded-xl border">
        <Table>
          <TableCaption className="sr-only">
            Cross-validated model comparison ranked by {metricLabel(metric)}
          </TableCaption>
          <TableHeader>
            <TableRow>
              <TableHead className="w-14">Rank</TableHead>
              <TableHead>Model</TableHead>
              {header(metric, metricLabel(metric))}
              {secondary.map((name) => header(name, metricLabel(name)))}
              {header("training_seconds", "Training", false)}
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((model) => {
              const isBest = model.model_id === run.best_model_id;
              const succeeded = model.status === "succeeded";
              return (
                <TableRow key={model.model_id}>
                  <TableCell className="tabular-nums">
                    {model.rank ?? "—"}
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">{model.name}</span>
                      {isBest ? <Badge variant="secondary">best</Badge> : null}
                    </div>
                    <p className="text-xs text-muted-foreground capitalize">
                      {model.family.replace("_", " ")}
                    </p>
                    {model.error ? (
                      <p className="max-w-md text-xs text-destructive">
                        {model.error}
                      </p>
                    ) : null}
                  </TableCell>
                  <TableCell className="text-right font-mono tabular-nums">
                    {succeeded
                      ? formatMetric(model.metrics[metric] ?? Number.NaN)
                      : "—"}
                    <span className="block text-xs text-muted-foreground">
                      {succeeded && model.metric_std[metric] !== undefined
                        ? `± ${formatMetric(model.metric_std[metric] ?? 0)}`
                        : ""}
                    </span>
                  </TableCell>
                  {secondary.map((name) => (
                    <TableCell
                      key={name}
                      className="text-right font-mono tabular-nums"
                    >
                      {succeeded
                        ? formatMetric(model.metrics[name] ?? Number.NaN)
                        : "—"}
                    </TableCell>
                  ))}
                  <TableCell className="text-right tabular-nums text-muted-foreground">
                    {formatDuration(model.training_seconds * 1000)}
                  </TableCell>
                  <TableCell>
                    <Badge variant={succeeded ? "outline" : "destructive"}>
                      {model.status}
                    </Badge>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </section>
  );
}
