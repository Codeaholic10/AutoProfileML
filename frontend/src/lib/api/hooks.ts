"use client";

/** TanStack Query hooks for the dataset data layer. */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import type { JobStatus } from "@/types/api";

import { ApiError } from "./client";
import {
  deleteDataset,
  getDataset,
  getJob,
  getProfile,
  listDatasets,
  reprofileDataset,
  uploadDataset,
} from "./endpoints";
import { queryKeys } from "./query-keys";

/** How often a non-terminal job is polled, in milliseconds. */
export const JOB_POLL_INTERVAL_MS = 2000;

export function isTerminalJobStatus(status: JobStatus | undefined): boolean {
  return status === "succeeded" || status === "failed";
}

export function useDatasets() {
  return useQuery({
    queryKey: queryKeys.datasets.list(),
    queryFn: listDatasets,
  });
}

export function useDataset(datasetId: string) {
  return useQuery({
    queryKey: queryKeys.datasets.detail(datasetId),
    queryFn: () => getDataset(datasetId),
    enabled: datasetId.length > 0,
  });
}

export function useProfile(datasetId: string) {
  return useQuery({
    queryKey: queryKeys.datasets.profile(datasetId),
    queryFn: () => getProfile(datasetId),
    enabled: datasetId.length > 0,
    // 409 means profiling is still running; retrying cannot help.
    retry: (failureCount, error) =>
      !(error instanceof ApiError && error.status === 409) && failureCount < 1,
  });
}

/**
 * Poll a job until it reaches a terminal status.
 *
 * The interval callback returns `false` for `succeeded`/`failed`, which stops
 * the poll; no `setInterval` or effect-driven polling is used anywhere.
 */
export function useJob(jobId: string | null | undefined) {
  const id = jobId ?? "";
  return useQuery({
    queryKey: queryKeys.jobs.detail(id),
    queryFn: () => getJob(id),
    enabled: id.length > 0,
    refetchInterval: (query) =>
      isTerminalJobStatus(query.state.data?.status) ? false : JOB_POLL_INTERVAL_MS,
  });
}

export function useUploadDataset() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (file: File) => uploadDataset(file),
    onSuccess: (response) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.datasets.list() });
      void queryClient.invalidateQueries({
        queryKey: queryKeys.datasets.detail(response.dataset.dataset_id),
      });
    },
  });
}

export function useReprofileDataset() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (datasetId: string) => reprofileDataset(datasetId),
    onSuccess: (_job, datasetId) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.datasets.all });
      void queryClient.invalidateQueries({
        queryKey: queryKeys.datasets.jobs(datasetId),
      });
    },
  });
}

export function useDeleteDataset() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (datasetId: string) => deleteDataset(datasetId),
    onSuccess: (_result, datasetId) => {
      queryClient.removeQueries({ queryKey: queryKeys.datasets.detail(datasetId) });
      queryClient.removeQueries({ queryKey: queryKeys.datasets.profile(datasetId) });
      queryClient.removeQueries({ queryKey: queryKeys.datasets.jobs(datasetId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.datasets.list() });
    },
  });
}
