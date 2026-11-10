"use client";

import { Loader2Icon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";

import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { ApiError } from "@/lib/api/client";
import { isTerminalJobStatus, useJob } from "@/lib/api/hooks";

interface BenchmarkProgressProps {
  /** Job id from the create response; absent after a mid-run reload. */
  jobId?: string;
}

/** Poll the benchmark job and refresh the server-rendered run when it settles. */
export function BenchmarkProgress({ jobId }: BenchmarkProgressProps) {
  const router = useRouter();
  const { data: job, isError, error } = useJob(jobId);
  const refreshed = useRef(false);

  useEffect(() => {
    if (job && isTerminalJobStatus(job.status) && !refreshed.current) {
      refreshed.current = true;
      router.refresh();
    }
  }, [job, router]);

  if (jobId === undefined) {
    return (
      <section className="flex flex-wrap items-center justify-between gap-3 rounded-xl border px-4 py-3 text-sm">
        <p className="flex items-center gap-2">
          <Loader2Icon aria-hidden="true" className="size-4 animate-spin" />
          The run is still in progress. This page updates after a refresh.
        </p>
        <Button variant="outline" size="sm" onClick={() => router.refresh()}>
          Refresh
        </Button>
      </section>
    );
  }

  if (isError) {
    return (
      <section className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-destructive/40 bg-destructive/5 p-4 text-sm">
        <p role="alert" className="text-destructive">
          {error instanceof ApiError
            ? error.detail
            : "Could not load the benchmark job."}
        </p>
        <Button variant="outline" size="sm" onClick={() => router.refresh()}>
          Refresh
        </Button>
      </section>
    );
  }

  if (!job) {
    return (
      <Skeleton
        aria-label="Loading benchmark status"
        className="h-20 w-full rounded-xl"
      />
    );
  }

  const percent = Math.round(job.progress * 100);

  return (
    <section
      aria-labelledby="benchmark-progress-heading"
      className="space-y-3 rounded-xl border p-4"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2
          id="benchmark-progress-heading"
          className="flex items-center gap-2 text-sm font-medium"
        >
          <Loader2Icon
            aria-hidden="true"
            className="size-4 animate-spin text-muted-foreground"
          />
          {job.status === "queued" ? "Benchmark queued" : `Benchmark: ${job.stage}`}
        </h2>
        <span className="text-sm tabular-nums text-muted-foreground">{percent}%</span>
      </div>
      <Progress
        value={percent}
        aria-label={`Benchmark progress: ${percent}%`}
      />
      {job.error ? (
        <p role="alert" className="text-sm text-destructive">
          {job.error}
        </p>
      ) : null}
    </section>
  );
}
