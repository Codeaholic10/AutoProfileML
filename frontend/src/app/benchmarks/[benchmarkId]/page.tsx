import { notFound } from "next/navigation";

import { BenchmarkHeader } from "@/features/benchmarks/components/benchmark-header";
import { BenchmarkProgress } from "@/features/benchmarks/components/benchmark-progress";
import { LeaderboardTable } from "@/features/benchmarks/components/leaderboard-table";
import { MetricBarChart } from "@/features/benchmarks/components/metric-bar-chart";
import { ModelInspector } from "@/features/benchmarks/components/model-inspector";
import { PreprocessingPlanPanel } from "@/features/benchmarks/components/preprocessing-plan-panel";
import { ExplanationPanel } from "@/features/explanations/components/explanation-panel";
import { ExportPanel } from "@/features/exports/components/export-panel";
import { ApiError } from "@/lib/api/client";
import { getBenchmark } from "@/lib/api/endpoints";
import type { BenchmarkRun } from "@/types/api";

async function loadBenchmark(benchmarkId: string): Promise<BenchmarkRun> {
  try {
    return await getBenchmark(benchmarkId);
  } catch (caught) {
    if (caught instanceof ApiError && caught.status === 404) {
      notFound();
    }
    throw caught;
  }
}

export default async function BenchmarkDetailPage({
  params,
  searchParams,
}: PageProps<"/benchmarks/[benchmarkId]">) {
  const { benchmarkId } = await params;
  const query = await searchParams;
  const rawJob = query.job;
  const jobId = typeof rawJob === "string" ? rawJob : rawJob?.[0];

  const run = await loadBenchmark(benchmarkId);
  const active = run.status === "queued" || run.status === "running";

  return (
    <div className="space-y-8">
      <BenchmarkHeader run={run} />

      {active ? <BenchmarkProgress jobId={jobId} /> : null}

      {run.status === "failed" ? (
        <section
          role="alert"
          className="space-y-1 rounded-xl border border-destructive/40 bg-destructive/5 p-4 text-sm"
        >
          <p className="font-medium text-destructive">The benchmark run failed.</p>
          <p className="text-muted-foreground">
            {run.error ?? "No error detail was recorded."}
          </p>
        </section>
      ) : null}

      {run.status === "succeeded" ? (
        <>
          {run.preprocessing ? (
            <PreprocessingPlanPanel plan={run.preprocessing} />
          ) : null}
          <MetricBarChart run={run} />
          <LeaderboardTable run={run} />
          <ModelInspector run={run} />
          <ExplanationPanel run={run} />
          <ExportPanel run={run} />
        </>
      ) : null}

      {active && run.leaderboard.length > 0 ? (
        <LeaderboardTable run={run} />
      ) : null}
    </div>
  );
}
