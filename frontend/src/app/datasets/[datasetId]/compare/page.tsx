import Link from "next/link";
import { notFound } from "next/navigation";

import { BenchmarkComparison } from "@/features/benchmarks/components/benchmark-comparison";
import { ComparePicker } from "@/features/benchmarks/components/compare-picker";
import { ApiError } from "@/lib/api/client";
import { getBenchmark, getDataset, listBenchmarks } from "@/lib/api/endpoints";
import type { BenchmarkRun, DatasetSummary } from "@/types/api";

async function loadDataset(datasetId: string): Promise<DatasetSummary> {
  try {
    return await getDataset(datasetId);
  } catch (caught) {
    if (caught instanceof ApiError && caught.status === 404) {
      notFound();
    }
    throw caught;
  }
}

async function loadRun(benchmarkId: string): Promise<BenchmarkRun> {
  try {
    return await getBenchmark(benchmarkId);
  } catch (caught) {
    if (caught instanceof ApiError && caught.status === 404) {
      notFound();
    }
    throw caught;
  }
}

export default async function ComparePage({
  params,
  searchParams,
}: PageProps<"/datasets/[datasetId]/compare">) {
  const { datasetId } = await params;
  const query = await searchParams;
  const leftId = typeof query.left === "string" ? query.left : query.left?.[0];
  const rightId = typeof query.right === "string" ? query.right : query.right?.[0];

  const [dataset, summaries] = await Promise.all([
    loadDataset(datasetId),
    listBenchmarks(datasetId),
  ]);

  let left: BenchmarkRun | null = null;
  let right: BenchmarkRun | null = null;
  if (
    leftId !== undefined &&
    rightId !== undefined &&
    leftId.length > 0 &&
    rightId.length > 0 &&
    leftId !== rightId
  ) {
    [left, right] = await Promise.all([loadRun(leftId), loadRun(rightId)]);
    if (left.dataset_id !== datasetId || right.dataset_id !== datasetId) {
      notFound();
    }
  }

  return (
    <div className="space-y-8">
      <header className="space-y-3">
        <Link
          href={`/datasets/${datasetId}`}
          className="text-sm text-muted-foreground hover:text-foreground"
        >
          ← Back to dataset
        </Link>
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">
            Compare benchmarks
          </h1>
          <p className="text-sm text-muted-foreground">
            {dataset.filename} · {summaries.length} run
            {summaries.length === 1 ? "" : "s"} recorded
          </p>
        </div>
      </header>

      {summaries.length < 2 ? (
        <p className="rounded-xl border border-dashed px-6 py-12 text-center text-sm text-muted-foreground">
          Run at least two benchmarks on this dataset to compare them.
        </p>
      ) : (
        <ComparePicker datasetId={datasetId} summaries={summaries} />
      )}

      {left !== null && right !== null ? (
        <BenchmarkComparison left={left} right={right} />
      ) : summaries.length >= 2 ? (
        <p className="rounded-xl border border-dashed px-6 py-12 text-center text-sm text-muted-foreground">
          Choose two different runs above to see the comparison.
        </p>
      ) : null}
    </div>
  );
}
