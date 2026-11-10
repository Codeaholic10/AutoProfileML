/** Typed calls for every dataset and job endpoint the API exposes. */

import type {
  DatasetListItem,
  DatasetSummary,
  DatasetUploadResponse,
  JobRecord,
  ProfileReport,
} from "@/types/api";

import { apiFetch, apiSend } from "./client";
import {
  datasetListItemSchema,
  datasetSummarySchema,
  datasetUploadResponseSchema,
  jobRecordSchema,
  profileReportSchema,
} from "./schemas";

const DATASETS_PATH = "/api/datasets";

function datasetPath(datasetId: string): string {
  return `${DATASETS_PATH}/${encodeURIComponent(datasetId)}`;
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

/** Upload a file as multipart/form-data; the browser sets the boundary. */
export function uploadDataset(file: File): Promise<DatasetUploadResponse> {
  const body = new FormData();
  body.append("file", file);
  return apiFetch(DATASETS_PATH, datasetUploadResponseSchema, {
    method: "POST",
    body,
  });
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
