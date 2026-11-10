import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { formatCount, formatDateTime } from "@/lib/format";
import type { BenchmarkRun } from "@/types/api";

import { primaryMetric, succeededModels } from "../metrics";

const STATUS_VARIANT: Record<
  BenchmarkRun["status"],
  "default" | "secondary" | "outline" | "destructive"
> = {
  queued: "outline",
  running: "secondary",
  succeeded: "default",
  failed: "destructive",
};

export function BenchmarkHeader({ run }: { run: BenchmarkRun }) {
  const best = run.leaderboard.find(
    (model) => model.model_id === run.best_model_id,
  );
  const metric = primaryMetric(run.task_type);
  const bestValue = best?.metrics[metric];
  const completed = succeededModels(run).length;

  return (
    <section className="space-y-4">
      <Link
        href={`/datasets/${run.dataset_id}`}
        className="text-sm text-muted-foreground hover:text-foreground"
      >
        ← Back to dataset
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-tight">
              Benchmark · {run.target}
            </h1>
            <Badge variant={STATUS_VARIANT[run.status]}>{run.status}</Badge>
            <Badge variant="outline">
              {run.task_type === "classification" ? "Classification" : "Regression"}
            </Badge>
            <Badge variant="outline">{run.folds}-fold CV</Badge>
          </div>
          <p className="text-sm text-muted-foreground">
            {run.task_detection_reason} · Started {formatDateTime(run.created_at)}
          </p>
          {best && bestValue !== undefined ? (
            <p className="text-sm">
              Best: <span className="font-medium">{best.name}</span> ·{" "}
              {metric} {bestValue.toFixed(4)} · {completed} model
              {completed === 1 ? "" : "s"} completed
            </p>
          ) : null}
        </div>
      </div>

      {run.sample_rows !== null ? (
        <p
          role="status"
          className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm"
        >
          Training was capped to a fixed-seed sample of{" "}
          {formatCount(run.sample_rows)} rows.
        </p>
      ) : null}
    </section>
  );
}
