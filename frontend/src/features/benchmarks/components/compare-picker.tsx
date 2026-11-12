"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { formatDateTime } from "@/lib/format";
import type { BenchmarkSummary } from "@/types/api";

const selectClassName =
  "h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

function optionLabel(summary: BenchmarkSummary): string {
  return `${formatDateTime(summary.created_at)} · #${summary.benchmark_id.slice(0, 8)} · ${summary.target} · ${summary.status}`;
}

/** Pick two runs of this dataset and open the comparison page. */
export function ComparePicker({
  datasetId,
  summaries,
}: {
  datasetId: string;
  summaries: BenchmarkSummary[];
}) {
  const router = useRouter();
  const [left, setLeft] = useState(summaries[1]?.benchmark_id ?? summaries[0]?.benchmark_id ?? "");
  const [right, setRight] = useState(summaries[0]?.benchmark_id ?? "");
  const invalid = left.length === 0 || right.length === 0 || left === right;

  function compare() {
    if (invalid) {
      return;
    }
    router.push(
      `/datasets/${datasetId}/compare?left=${encodeURIComponent(left)}&right=${encodeURIComponent(right)}`,
    );
  }

  return (
    <div className="space-y-2 rounded-xl border p-4">
      <div className="space-y-1">
        <h3 className="text-sm font-medium">Compare two runs</h3>
        <p className="text-sm text-muted-foreground">
          See how a data or configuration change affected each model family.
        </p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <label htmlFor="compare-left" className="text-xs text-muted-foreground">
            Run A
          </label>
          <select
            id="compare-left"
            className={selectClassName}
            value={left}
            onChange={(event) => setLeft(event.target.value)}
          >
            {summaries.map((summary) => (
              <option key={summary.benchmark_id} value={summary.benchmark_id}>
                {optionLabel(summary)}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1">
          <label htmlFor="compare-right" className="text-xs text-muted-foreground">
            Run B
          </label>
          <select
            id="compare-right"
            className={selectClassName}
            value={right}
            onChange={(event) => setRight(event.target.value)}
          >
            {summaries.map((summary) => (
              <option key={summary.benchmark_id} value={summary.benchmark_id}>
                {optionLabel(summary)}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" onClick={compare} disabled={invalid}>
          Compare runs
        </Button>
        {left === right && summaries.length > 1 ? (
          <p className="text-xs text-muted-foreground">
            Choose two different runs.
          </p>
        ) : null}
      </div>
    </div>
  );
}
