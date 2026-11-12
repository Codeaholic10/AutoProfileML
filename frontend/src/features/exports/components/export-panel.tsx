"use client";

import { useQueryClient } from "@tanstack/react-query";
import { DownloadIcon, PackageIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { Button, buttonVariants } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { ApiError } from "@/lib/api/client";
import {
  isTerminalJobStatus,
  useCreateExport,
  useExportManifest,
  useJob,
} from "@/lib/api/hooks";
import { getExportDownloadUrl } from "@/lib/api/endpoints";
import { queryKeys } from "@/lib/api/query-keys";
import { formatBytes, formatDuration } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { BenchmarkRun } from "@/types/api";

import { succeededModels } from "@/features/benchmarks/metrics";

const selectClassName =
  "h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

/**
 * Generate and download a standalone training bundle for one model:
 * script, notebook, README, and the fitted pipeline as a ZIP.
 */
export function ExportPanel({ run }: { run: BenchmarkRun }) {
  const models = succeededModels(run);
  const [modelId, setModelId] = useState(
    run.best_model_id ?? models[0]?.model_id ?? "",
  );
  const [jobId, setJobId] = useState<string | null>(null);
  const notified = useRef(false);
  const queryClient = useQueryClient();

  const manifestQuery = useExportManifest(run.benchmark_id, modelId || null);
  const jobQuery = useJob(jobId);
  const mutation = useCreateExport();

  useEffect(() => {
    const job = jobQuery.data;
    if (!job || !isTerminalJobStatus(job.status) || notified.current) {
      return;
    }
    notified.current = true;
    if (job.status === "succeeded") {
      toast.success("Export bundle ready");
      void queryClient.invalidateQueries({
        queryKey: queryKeys.exports.detail(run.benchmark_id, modelId),
      });
    } else {
      toast.error(job.error ?? "The export job failed.");
    }
  }, [jobQuery.data, modelId, queryClient, run.benchmark_id]);

  if (models.length === 0) {
    return null;
  }

  function startExport() {
    if (modelId.length === 0) {
      return;
    }
    notified.current = false;
    mutation.mutate(
      { benchmarkId: run.benchmark_id, request: { model_id: modelId } },
      {
        onSuccess: (response) => setJobId(response.job.job_id),
        onError: (caught) => {
          toast.error(
            caught instanceof ApiError
              ? caught.detail
              : "Could not queue the export.",
          );
        },
      },
    );
  }

  const busy = mutation.isPending || jobQuery.data?.status === "running";
  const missing =
    manifestQuery.error instanceof ApiError && manifestQuery.error.status === 404;

  return (
    <section aria-labelledby="export-heading" className="space-y-4">
      <div className="space-y-1">
        <h2 id="export-heading" className="text-lg font-semibold">
          Export
        </h2>
        <p className="text-sm text-muted-foreground">
          Download a standalone training script, a matching notebook, and the fitted
          pipeline as a ZIP bundle.
        </p>
      </div>

      <div className="flex flex-wrap items-end gap-3 rounded-xl border p-4">
        <div className="space-y-1">
          <label htmlFor="export-model" className="text-xs text-muted-foreground">
            Model
          </label>
          <select
            id="export-model"
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

        <Button type="button" onClick={startExport} disabled={busy}>
          <PackageIcon aria-hidden="true" />
          {manifestQuery.data ? "Regenerate bundle" : "Generate bundle"}
        </Button>

        {jobQuery.data && !isTerminalJobStatus(jobQuery.data.status) ? (
          <div className="w-full space-y-1">
            <p className="text-xs text-muted-foreground">
              {jobQuery.data.stage} · {Math.round(jobQuery.data.progress * 100)}%
            </p>
            <Progress
              value={Math.round(jobQuery.data.progress * 100)}
              aria-label="Export progress"
            />
          </div>
        ) : null}

        {jobQuery.data?.status === "failed" ? (
          <p role="alert" className="w-full text-sm text-destructive">
            {jobQuery.data.error ?? "The export job failed."}
          </p>
        ) : null}
      </div>

      {manifestQuery.isPending ? (
        <Skeleton aria-label="Loading export" className="h-40 w-full rounded-xl" />
      ) : missing ? (
        <p className="rounded-xl border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">
          No export bundle yet for this model. Generate one to download the script,
          notebook, and pipeline.
        </p>
      ) : manifestQuery.isError ? (
        <p
          role="alert"
          className="rounded-xl border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive"
        >
          {manifestQuery.error instanceof ApiError
            ? manifestQuery.error.detail
            : "Could not load the export bundle."}
        </p>
      ) : (
        <div className="space-y-3 rounded-xl border p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="space-y-0.5">
              <p className="text-sm font-medium">
                {manifestQuery.data.model_name} · {formatBytes(manifestQuery.data.size_bytes)}
              </p>
              <p className="text-xs text-muted-foreground">
                Generated in {formatDuration(manifestQuery.data.duration_ms)}
              </p>
            </div>
            <a
              href={getExportDownloadUrl(run.benchmark_id, modelId)}
              download
              className={cn(buttonVariants({ variant: "outline" }))}
            >
              <DownloadIcon aria-hidden="true" />
              Download ZIP
            </a>
          </div>

          <ul className="divide-y rounded-lg border text-sm">
            {manifestQuery.data.files.map((file) => (
              <li
                key={file.name}
                className="flex items-center justify-between gap-3 px-3 py-2"
              >
                <span className="font-mono text-xs">{file.name}</span>
                <span className="text-xs text-muted-foreground">
                  {formatBytes(file.size_bytes)}
                </span>
              </li>
            ))}
          </ul>

          {manifestQuery.data.onnx_note ? (
            <p className="text-xs text-muted-foreground">
              {manifestQuery.data.onnx_note}
            </p>
          ) : null}
        </div>
      )}
    </section>
  );
}
