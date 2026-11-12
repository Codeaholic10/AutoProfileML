import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatDateTime, formatMetric } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { BenchmarkRun, ModelResult } from "@/types/api";

import {
  bestModel,
  bestModelDelta,
  comparabilityWarnings,
  familyRows,
  metricHeading,
} from "../comparison";
import { primaryMetric } from "../metrics";

function formatDelta(delta: number | null): string {
  if (delta === null) {
    return "—";
  }
  const rounded = Math.abs(delta) < 1e-9 ? 0 : delta;
  const sign = rounded > 0 ? "+" : "";
  return `${sign}${formatMetric(rounded)}`;
}

function primaryValue(model: ModelResult | null, task: BenchmarkRun["task_type"]): string {
  if (model === null || model.status !== "succeeded") {
    return "—";
  }
  const value = model.metrics[primaryMetric(task)];
  return value === undefined ? "—" : formatMetric(value);
}

function RunSummary({ label, run }: { label: string; run: BenchmarkRun }) {
  const best = bestModel(run);
  return (
    <div className="space-y-1 rounded-xl border p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium">{label}</span>
        <Badge variant="outline">{run.status}</Badge>
      </div>
      <p className="text-sm">
        Target <span className="font-mono text-xs">{run.target}</span> ·{" "}
        {run.task_type}
      </p>
      <p className="text-sm">
        Best: <span className="font-medium">{best?.name ?? "—"}</span>
        {best ? ` · ${metricHeading(run.task_type)} ${primaryValue(best, run.task_type)}` : ""}
      </p>
      <p className="text-xs text-muted-foreground">
        {run.folds}-fold · {formatDateTime(run.created_at)}
      </p>
      <Link
        href={`/benchmarks/${run.benchmark_id}`}
        className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
      >
        View run
      </Link>
    </div>
  );
}

/** Side-by-side comparison of two runs for the same dataset. */
export function BenchmarkComparison({
  left,
  right,
}: {
  left: BenchmarkRun;
  right: BenchmarkRun;
}) {
  const warnings = comparabilityWarnings(left, right);
  const rows = familyRows(left, right);
  const delta = bestModelDelta(left, right);
  const comparable = left.task_type === right.task_type;

  const configRows: { label: string; left: string; right: string }[] = [
    { label: "Target", left: left.target, right: right.target },
    { label: "Task", left: left.task_type, right: right.task_type },
    { label: "Folds", left: String(left.folds), right: String(right.folds) },
    {
      label: "Training rows",
      left:
        left.sample_rows === null ? "full dataset" : `${left.sample_rows} sampled`,
      right:
        right.sample_rows === null
          ? "full dataset"
          : `${right.sample_rows} sampled`,
    },
    {
      label: "Excluded features",
      left: left.excluded_features.join(", ") || "none",
      right: right.excluded_features.join(", ") || "none",
    },
    {
      label: "Best model",
      left: bestModel(left)?.name ?? "—",
      right: bestModel(right)?.name ?? "—",
    },
    { label: "Status", left: left.status, right: right.status },
  ];

  return (
    <div className="space-y-8">
      {warnings.length > 0 ? (
        <ul
          role="status"
          className="list-disc space-y-1 rounded-xl border border-amber-500/40 bg-amber-500/10 py-3 pr-4 pl-8 text-sm"
        >
          {warnings.map((warning) => (
            <li key={warning}>{warning}</li>
          ))}
        </ul>
      ) : null}

      <section aria-labelledby="comparison-summary" className="space-y-3">
        <h2 id="comparison-summary" className="text-lg font-semibold">
          Summary
        </h2>
        <div className="grid gap-4 md:grid-cols-3">
          <RunSummary label="Run A" run={left} />
          <div className="space-y-1 rounded-xl border p-4">
            <p className="text-sm font-medium">Best-model change</p>
            <p className="text-sm">
              {metricHeading(left.task_type)}:{" "}
              <span className="font-mono">
                {delta.leftValue === null ? "—" : formatMetric(delta.leftValue)}
              </span>{" "}
              →{" "}
              <span className="font-mono">
                {delta.rightValue === null ? "—" : formatMetric(delta.rightValue)}
              </span>
            </p>
            <p className="text-sm">
              Δ{" "}
              <span className="font-mono tabular-nums">
                {formatDelta(delta.delta)}
              </span>
              {delta.verdict ? ` · ${delta.verdict}` : ""}
            </p>
            {!comparable ? (
              <p className="text-xs text-muted-foreground">
                Different task types: no metric delta.
              </p>
            ) : null}
          </div>
          <RunSummary label="Run B" run={right} />
        </div>
      </section>

      <section aria-labelledby="comparison-config" className="space-y-3">
        <h2 id="comparison-config" className="text-lg font-semibold">
          Configuration
        </h2>
        <div className="overflow-x-auto rounded-xl border">
          <Table>
            <TableCaption className="sr-only">
              Configuration differences between the two runs
            </TableCaption>
            <TableHeader>
              <TableRow>
                <TableHead>Setting</TableHead>
                <TableHead>Run A</TableHead>
                <TableHead>Run B</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {configRows.map((row) => (
                <TableRow key={row.label}>
                  <TableCell className="text-muted-foreground">{row.label}</TableCell>
                  <TableCell className="font-mono text-xs">{row.left}</TableCell>
                  <TableCell className="font-mono text-xs">{row.right}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </section>

      <section aria-labelledby="comparison-models" className="space-y-3">
        <div className="space-y-1">
          <h2 id="comparison-models" className="text-lg font-semibold">
            Model families
          </h2>
          <p className="text-sm text-muted-foreground">
            Models are matched by family across runs. {metricHeading(left.task_type)}{" "}
            is {left.task_type === "classification" ? "higher" : "lower"}-better.
          </p>
        </div>
        <div className="overflow-x-auto rounded-xl border">
          <Table>
            <TableCaption className="sr-only">
              Per-family metric comparison between the two runs
            </TableCaption>
            <TableHeader>
              <TableRow>
                <TableHead>Family</TableHead>
                <TableHead>Run A model</TableHead>
                <TableHead className="text-right">{metricHeading(left.task_type)} A</TableHead>
                <TableHead>Run B model</TableHead>
                <TableHead className="text-right">{metricHeading(left.task_type)} B</TableHead>
                <TableHead className="text-right">Δ</TableHead>
                <TableHead>Verdict</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.family}>
                  <TableCell className="font-medium">{row.label}</TableCell>
                  <TableCell>
                    {row.left?.name ?? "—"}{" "}
                    {row.left?.status === "failed" ? (
                      <Badge variant="destructive">failed</Badge>
                    ) : null}
                  </TableCell>
                  <TableCell className="text-right font-mono tabular-nums">
                    {row.leftValue === null ? "—" : formatMetric(row.leftValue)}
                  </TableCell>
                  <TableCell>
                    {row.right?.name ?? "—"}{" "}
                    {row.right?.status === "failed" ? (
                      <Badge variant="destructive">failed</Badge>
                    ) : null}
                  </TableCell>
                  <TableCell className="text-right font-mono tabular-nums">
                    {row.rightValue === null ? "—" : formatMetric(row.rightValue)}
                  </TableCell>
                  <TableCell className="text-right font-mono tabular-nums">
                    {row.delta === null ? "—" : formatDelta(row.delta)}
                  </TableCell>
                  <TableCell>{row.verdict ?? "—"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </section>
    </div>
  );
}
