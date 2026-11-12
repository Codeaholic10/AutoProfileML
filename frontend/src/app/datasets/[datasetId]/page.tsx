import { notFound } from "next/navigation";

import { BenchmarkForm } from "@/features/benchmarks/components/benchmark-form";
import { BenchmarkHistory } from "@/features/benchmarks/components/benchmark-history";
import { ComparePicker } from "@/features/benchmarks/components/compare-picker";
import { ColumnTable } from "@/features/profiling/components/column-table";
import { CollinearityPanel } from "@/features/profiling/components/collinearity-panel";
import { CorrelationHeatmap } from "@/features/profiling/components/correlation-heatmap";
import { DatasetHeader } from "@/features/profiling/components/dataset-header";
import { JobProgress } from "@/features/profiling/components/job-progress";
import { ProfileOverview } from "@/features/profiling/components/profile-overview";
import { ReprofileButton } from "@/features/profiling/components/reprofile-button";
import { WarningsPanel } from "@/features/profiling/components/warnings-panel";
import { ApiError } from "@/lib/api/client";
import { getDataset, getProfile, listBenchmarks, listDatasetJobs } from "@/lib/api/endpoints";
import type { DatasetSummary, JobRecord, ProfileReport } from "@/types/api";

async function loadProfile(datasetId: string): Promise<ProfileReport | null> {
  try {
    return await getProfile(datasetId);
  } catch (caught) {
    // 409 means profiling is still running; the job panel explains it.
    if (caught instanceof ApiError && caught.status === 409) {
      return null;
    }
    throw caught;
  }
}

export default async function DatasetDetailPage({
  params,
}: PageProps<"/datasets/[datasetId]">) {
  const { datasetId } = await params;

  let dataset: DatasetSummary;
  try {
    dataset = await getDataset(datasetId);
  } catch (caught) {
    if (caught instanceof ApiError && caught.status === 404) {
      notFound();
    }
    throw caught;
  }

  const [profile, jobs, benchmarks] = await Promise.all([
    loadProfile(datasetId),
    listDatasetJobs(datasetId),
    listBenchmarks(datasetId),
  ]);

  const latestJob: JobRecord | undefined = jobs.at(-1);
  const activeJob =
    latestJob &&
    (latestJob.status === "queued" || latestJob.status === "running")
      ? latestJob
      : null;
  const failedJob = latestJob?.status === "failed" ? latestJob : null;

  return (
    <div className="space-y-8">
      <DatasetHeader dataset={dataset} />

      {activeJob ? <JobProgress jobId={activeJob.job_id} /> : null}

      {failedJob && !activeJob ? (
        <section className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-destructive/40 bg-destructive/5 p-4">
          <div className="space-y-1 text-sm">
            <p className="font-medium text-destructive">
              The last profiling run failed.
            </p>
            <p className="text-muted-foreground">
              {failedJob.error ?? "No error detail was recorded."}
            </p>
          </div>
          <ReprofileButton datasetId={datasetId} label="Try again" size="sm" />
        </section>
      ) : null}

      {profile ? (
        <>
          <ProfileOverview profile={profile} />
          <WarningsPanel warnings={profile.warnings} />
          <ColumnTable columns={profile.columns} />
          <CollinearityPanel findings={profile.collinearity} />
          <CorrelationHeatmap correlation={profile.correlation} />
        </>
      ) : !activeJob && !failedJob ? (
        <section className="space-y-3 rounded-xl border border-dashed px-6 py-12 text-center">
          <h2 className="font-medium">Profile not available</h2>
          <p className="text-sm text-muted-foreground">
            Run profiling to build the profile for this dataset.
          </p>
          <ReprofileButton
            datasetId={datasetId}
            label="Run profiling"
            variant="default"
          />
        </section>
      ) : null}

      <section id="benchmarks" className="scroll-mt-8 space-y-4">
        <div className="space-y-1">
          <h2 className="text-lg font-semibold">Benchmarks</h2>
          <p className="text-sm text-muted-foreground">
            Compare four models on a target column, then inspect their out-of-fold
            predictions and SHAP explanations.
          </p>
        </div>

        {profile ? (
          <BenchmarkForm
            datasetId={datasetId}
            columns={profile.columns}
            collinearity={profile.collinearity}
            rowCount={profile.row_count}
          />
        ) : (
          <p className="rounded-xl border border-dashed px-4 py-6 text-sm text-muted-foreground">
            Profile the dataset before running a benchmark.
          </p>
        )}

        {benchmarks.length >= 2 ? (
          <ComparePicker datasetId={datasetId} summaries={benchmarks} />
        ) : null}

        <BenchmarkHistory summaries={benchmarks} />
      </section>
    </div>
  );
}
