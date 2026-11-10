/** Typed calls for every dataset, benchmark, explanation, and job endpoint. */

import type {
  BenchmarkCreateRequest,
  BenchmarkEnqueueResponse,
  BenchmarkRun,
  BenchmarkSummary,
  DatasetListItem,
  DatasetSummary,
  DatasetUploadResponse,
  ExplanationCreateRequest,
  ExplanationEnqueueResponse,
  ExplanationReport,
  JobRecord,
  OutOfFoldPredictions,
  ProfileReport,
} from "@/types/api";

import { apiFetch, apiSend, apiUpload } from "./client";
import {
  benchmarkEnqueueResponseSchema,
  benchmarkRunSchema,
  benchmarkSummarySchema,
  datasetListItemSchema,
  datasetSummarySchema,
  datasetUploadResponseSchema,
  explanationEnqueueResponseSchema,
  explanationReportSchema,
  jobRecordSchema,
  outOfFoldPredictionsSchema,
  profileReportSchema,
} from "./schemas";

const DATASETS_PATH = "/api/datasets";
const BENCHMARKS_PATH = "/api/benchmarks";

function datasetPath(datasetId: string): string {
  return `${DATASETS_PATH}/${encodeURIComponent(datasetId)}`;
}

function benchmarkPath(benchmarkId: string): string {
  return `${BENCHMARKS_PATH}/${encodeURIComponent(benchmarkId)}`;
}

export function listDatasets(): Promise<DatasetListItem[]> {
  return apiFetch(DATASETS_PATH, datasetListItemSchema.array());
}

export function getDataset(datasetId: string): Promise<DatasetSummary> {
  return apiFetch(datasetPath(datasetId), datasetSummarySchema);
}

export function getProfile(datasetId: string): Promise<ProfileReport> {
  return apiFetch(`${datasetPath(datasetId)}/profile`, profileReportSchema);
}

/** Upload a file as multipart/form-data, reporting transfer progress. */
export function uploadDataset(
  file: File,
  onProgress?: (percent: number) => void,
): Promise<DatasetUploadResponse> {
  const body = new FormData();
  body.append("file", file);
  return apiUpload(DATASETS_PATH, body, datasetUploadResponseSchema, onProgress);
}

export function reprofileDataset(datasetId: string): Promise<JobRecord> {
  return apiFetch(`${datasetPath(datasetId)}/profile`, jobRecordSchema, {
    method: "POST",
  });
}

export function getJob(jobId: string): Promise<JobRecord> {
  return apiFetch(`/api/jobs/${encodeURIComponent(jobId)}`, jobRecordSchema);
}

export function listDatasetJobs(datasetId: string): Promise<JobRecord[]> {
  return apiFetch(`${datasetPath(datasetId)}/jobs`, jobRecordSchema.array());
}

export function deleteDataset(datasetId: string): Promise<void> {
  return apiSend(datasetPath(datasetId), { method: "DELETE" });
}

/* ------------------------------------------------------------------------- */
/* Benchmarks                                                                 */
/* ------------------------------------------------------------------------- */

export function createBenchmark(
  datasetId: string,
  request: BenchmarkCreateRequest,
): Promise<BenchmarkEnqueueResponse> {
  return apiFetch(`${datasetPath(datasetId)}/benchmarks`, benchmarkEnqueueResponseSchema, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
  });
}

export function listBenchmarks(datasetId: string): Promise<BenchmarkSummary[]> {
  return apiFetch(
    `${datasetPath(datasetId)}/benchmarks`,
    benchmarkSummarySchema.array(),
  );
}

export function getBenchmark(benchmarkId: string): Promise<BenchmarkRun> {
  return apiFetch(benchmarkPath(benchmarkId), benchmarkRunSchema);
}

export function getPredictions(
  benchmarkId: string,
  modelId: string,
): Promise<OutOfFoldPredictions> {
  return apiFetch(
    `${benchmarkPath(benchmarkId)}/models/${encodeURIComponent(modelId)}/predictions`,
    outOfFoldPredictionsSchema,
  );
}

/* ------------------------------------------------------------------------- */
/* Explanations                                                               */
/* ------------------------------------------------------------------------- */

export function createExplanation(
  benchmarkId: string,
  request: ExplanationCreateRequest,
): Promise<ExplanationEnqueueResponse> {
  return apiFetch(
    `${benchmarkPath(benchmarkId)}/explanations`,
    explanationEnqueueResponseSchema,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
    },
  );
}

export function getExplanation(
  benchmarkId: string,
  modelId: string,
): Promise<ExplanationReport> {
  return apiFetch(
    `${benchmarkPath(benchmarkId)}/explanations/${encodeURIComponent(modelId)}`,
    explanationReportSchema,
  );
}
