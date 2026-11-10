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
import { cn } from "@/lib/utils";
import { formatDateTime, formatMetric } from "@/lib/format";
import type { BenchmarkSummary } from "@/types/api";

const STATUS_VARIANT: Record<
  BenchmarkSummary["status"],
  "default" | "secondary" | "outline" | "destructive"
> = {
  queued: "outline",
  running: "secondary",
  succeeded: "default",
  failed: "destructive",
};

/** Previous benchmark runs for a dataset, newest first. */
export function BenchmarkHistory({ summaries }: { summaries: BenchmarkSummary[] }) {
  if (summaries.length === 0) {
    return (
      <p className="rounded-xl border border-dashed px-4 py-6 text-sm text-muted-foreground">
        No benchmark runs yet. Start one above; results appear here when the run
        finishes.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto rounded-xl border">
      <Table>
        <TableCaption className="sr-only">
          Benchmark runs for this dataset
        </TableCaption>
        <TableHeader>
          <TableRow>
            <TableHead>Started</TableHead>
            <TableHead>Target</TableHead>
            <TableHead>Task</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Best model</TableHead>
            <TableHead className="text-right">Primary metric</TableHead>
            <TableHead className="text-right">Open</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {summaries.map((summary) => (
            <TableRow key={summary.benchmark_id}>
              <TableCell className="tabular-nums text-muted-foreground">
                {formatDateTime(summary.created_at)}
              </TableCell>
              <TableCell className="font-medium">{summary.target}</TableCell>
              <TableCell className="capitalize">{summary.task_type}</TableCell>
              <TableCell>
                <Badge variant={STATUS_VARIANT[summary.status]}>
                  {summary.status}
                </Badge>
              </TableCell>
              <TableCell>{summary.best_model_name ?? "—"}</TableCell>
              <TableCell className="text-right font-mono tabular-nums">
                {summary.primary_metric_value === null
                  ? "—"
                  : `${formatMetric(summary.primary_metric_value)} (${summary.primary_metric})`}
              </TableCell>
              <TableCell className="text-right">
                <Link
                  href={`/benchmarks/${summary.benchmark_id}`}
                  className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
                >
                  View
                </Link>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
