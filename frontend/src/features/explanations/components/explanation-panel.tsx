"use client";

import { SparklesIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { ApiError } from "@/lib/api/client";
import {
  isTerminalJobStatus,
  useCreateExplanation,
  useExplanation,
  useJob,
} from "@/lib/api/hooks";
import { queryKeys } from "@/lib/api/query-keys";
import { formatCount, formatDuration } from "@/lib/format";
import type { BenchmarkRun, ExplanationMethod } from "@/types/api";

import { succeededModels } from "@/features/benchmarks/metrics";
import { GlobalImportanceChart } from "./global-importance-chart";
import { LocalExplanationInspector } from "./local-explanation-inspector";
import { ShapBeeswarm } from "./shap-beeswarm";

const METHOD_LABELS: Record<ExplanationMethod, string> = {
  tree_shap: "Tree SHAP",
  linear_shap: "Linear SHAP",
  kernel_shap: "Kernel SHAP",
};

const SAMPLE_SIZES = [50, 100, 250, 500, 1000] as const;

const selectClassName =
  "h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

/**
 * SHAP explanations for one benchmark model: queue a job, poll it, then show
 * global importance, the beeswarm, and per-row contributions.
 */
export function ExplanationPanel({ run }: { run: BenchmarkRun }) {
  const models = succeededModels(run);
  const [modelId, setModelId] = useState(
    run.best_model_id ?? models[0]?.model_id ?? "",
  );
  const [sampleSize, setSampleSize] = useState<number>(500);
  const [jobId, setJobId] = useState<string | null>(null);
  const notified = useRef(false);
  const queryClient = useQueryClient();

  const explanationQuery = useExplanation(run.benchmark_id, modelId || null);
  const jobQuery = useJob(jobId);
  const mutation = useCreateExplanation();

  useEffect(() => {
    const job = jobQuery.data;
    if (!job || !isTerminalJobStatus(job.status) || notified.current) {
      return;
    }
    notified.current = true;
    if (job.status === "succeeded") {
      toast.success("Explanation ready");
      void queryClient.invalidateQueries({
        queryKey: queryKeys.explanations.detail(run.benchmark_id, modelId),
      });
    } else {
      toast.error(job.error ?? "The explanation job failed.");
    }
  }, [jobQuery.data, modelId, queryClient, run.benchmark_id]);

  if (models.length === 0) {
    return null;
  }

  function startExplanation() {
    if (modelId.length === 0) {
      return;
    }
    notified.current = false;
    mutation.mutate(
      {
        benchmarkId: run.benchmark_id,
        request: { model_id: modelId, sample_size: sampleSize, local_rows: 10 },
      },
      {
        onSuccess: (response) => setJobId(response.job.job_id),
        onError: (caught) => {
          toast.error(
            caught instanceof ApiError
              ? caught.detail
              : "Could not queue the explanation.",
          );
        },
      },
    );
  }

  const busy = mutation.isPending || jobQuery.data?.status === "running";

  return (
    <section aria-labelledby="explanation-heading" className="space-y-4">
      <div className="space-y-1">
        <h2 id="explanation-heading" className="text-lg font-semibold">
          Explainability (SHAP)
        </h2>
        <p className="text-sm text-muted-foreground">
          Global importance and per-row contributions for a chosen model, computed
          on a fixed-seed sample.
        </p>
      </div>

      <div className="flex flex-wrap items-end gap-3 rounded-xl border p-4">
        <div className="space-y-1">
          <label htmlFor="explanation-model" className="text-xs text-muted-foreground">
            Model
          </label>
          <select
            id="explanation-model"
            className={`${selectClassName} min-w-52`}
            value={modelId}
            onChange={(event) => {
              setModelId(event.target.value);
              setJobId(null);
              notified.current = false;
            }}
          >
            {models.map((model) => (
              <option key={model.model_id} value={model.model_id}>
                {model.name}
              </option>
            ))}
          </select>
        </div>

        <div className="space-y-1">
          <label htmlFor="explanation-sample" className="text-xs text-muted-foreground">
            Sample size
          </label>
          <select
            id="explanation-sample"
            className={`${selectClassName} min-w-32`}
            value={sampleSize}
            onChange={(event) => setSampleSize(Number(event.target.value))}
          >
            {SAMPLE_SIZES.map((size) => (
              <option key={size} value={size}>
                {formatCount(size)} rows
              </option>
            ))}
          </select>
        </div>

        <Button type="button" onClick={startExplanation} disabled={busy}>
          <SparklesIcon aria-hidden="true" />
          {explanationQuery.data ? "Re-explain model" : "Explain model"}
        </Button>

        {jobQuery.data && !isTerminalJobStatus(jobQuery.data.status) ? (
          <div className="w-full space-y-1">
            <p className="text-xs text-muted-foreground">
              {jobQuery.data.stage} ·{" "}
              {Math.round(jobQuery.data.progress * 100)}%
            </p>
            <Progress
              value={Math.round(jobQuery.data.progress * 100)}
              aria-label="Explanation progress"
            />
          </div>
        ) : null}

        {jobQuery.data?.status === "failed" ? (
          <p role="alert" className="w-full text-sm text-destructive">
            {jobQuery.data.error ?? "The explanation job failed."}
          </p>
        ) : null}
      </div>

      {explanationQuery.isPending ? (
        <Skeleton aria-label="Loading explanation" className="h-80 w-full rounded-xl" />
      ) : explanationQuery.isError ? (
        explanationQuery.error instanceof ApiError &&
        explanationQuery.error.status === 404 ? (
          <p className="rounded-xl border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">
            No explanation yet for this model. Run one above to see global
            importance, a beeswarm, and per-row contributions.
          </p>
        ) : (
          <p
            role="alert"
            className="rounded-xl border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive"
          >
            {explanationQuery.error instanceof ApiError
              ? explanationQuery.error.detail
              : "Could not load the explanation."}
          </p>
        )
      ) : (
        <div className="space-y-6">
          <p className="text-xs text-muted-foreground">
            {METHOD_LABELS[explanationQuery.data.method]} ·{" "}
            {formatCount(explanationQuery.data.sample_size)} sampled rows ·{" "}
            {formatCount(explanationQuery.data.background_size)} background rows ·{" "}
            {formatDuration(explanationQuery.data.duration_ms)}
          </p>

          {explanationQuery.data.warnings.length > 0 ? (
            <ul className="list-disc space-y-1 pl-5 text-xs text-muted-foreground">
              {explanationQuery.data.warnings.map((warning) => (
                <li key={warning.code}>{warning.message}</li>
              ))}
            </ul>
          ) : null}

          <GlobalImportanceChart
            importance={explanationQuery.data.global_importance}
          />
          <ShapBeeswarm points={explanationQuery.data.summary_points} />
          <LocalExplanationInspector
            explanations={explanationQuery.data.local_explanations}
          />
        </div>
      )}
    </section>
  );
}
