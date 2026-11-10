/** Deterministic API fixtures shared by MSW handlers and tests. */

import type {
  DatasetListItem,
  DatasetSummary,
  DatasetUploadResponse,
  JobRecord,
  ProfileReport,
} from "@/types/api";

const UPLOADED_AT = "2026-10-21T12:00:00Z";

export const datasetSummary: DatasetSummary = {
  dataset_id: "ds-0001",
  filename: "sample.csv",
  format: "csv",
  size_bytes: 4096,
  uploaded_at: UPLOADED_AT,
  row_count: 10,
  column_count: 2,
};

export const profileReport: ProfileReport = {
  dataset_id: datasetSummary.dataset_id,
  row_count: 10,
  column_count: 2,
  memory_bytes: 2048,
  duplicate_rows: 0,
  duplicate_percentage: 0,
  generated_at: UPLOADED_AT,
  duration_ms: 12.5,
  numeric_columns: 1,
  categorical_columns: 1,
  columns: [
    {
      name: "age",
      dtype: "Int64",
      semantic_type: "numeric",
      null_count: 0,
      null_percentage: 0,
      unique_count: 10,
      is_constant: false,
      mean: 40.2,
      std: 10.1,
      minimum: 27,
      maximum: 61,
      q1: 33.25,
      median: 39.5,
      q3: 47.75,
      skewness: 0.42,
      kurtosis: -0.31,
      top_values: [],
    },
    {
      name: "city",
      dtype: "String",
      semantic_type: "categorical",
      null_count: 0,
      null_percentage: 0,
      unique_count: 3,
      is_constant: false,
      mean: null,
      std: null,
      minimum: null,
      maximum: null,
      q1: null,
      median: null,
      q3: null,
      skewness: null,
      kurtosis: null,
      top_values: [
        { value: "delhi", count: 4, percentage: 40 },
        { value: "mumbai", count: 3, percentage: 30 },
        { value: "pune", count: 3, percentage: 30 },
      ],
    },
  ],
  collinearity: [
    { feature: "age", vif: 1.0, severity: "ok", correlated_with: null },
  ],
  correlation: null,
  warnings: [
    {
      code: "high_cardinality",
      severity: "warning",
      column: "city",
      message:
        "Column 'city' has 3 distinct values; target encoding will be used instead of one-hot encoding.",
    },
  ],
};

export const queuedJob: JobRecord = {
  job_id: "job-0001",
  kind: "profiling",
  status: "queued",
  progress: 0,
  stage: "queued",
  dataset_id: datasetSummary.dataset_id,
  created_at: UPLOADED_AT,
  updated_at: UPLOADED_AT,
  error: null,
  result: null,
};

export const runningJob: JobRecord = {
  ...queuedJob,
  status: "running",
  progress: 0.6,
  stage: "profiling",
  updated_at: "2026-10-21T12:00:02Z",
};

export const succeededJob: JobRecord = {
  ...queuedJob,
  status: "succeeded",
  progress: 1,
  stage: "completed",
  updated_at: "2026-10-21T12:00:05Z",
  result: {
    dataset_id: datasetSummary.dataset_id,
    row_count: 10,
    column_count: 2,
    warning_count: 1,
    duration_ms: 12.5,
  },
};

export const failedJob: JobRecord = {
  ...queuedJob,
  status: "failed",
  stage: "failed",
  updated_at: "2026-10-21T12:00:05Z",
  error: "Could not profile 'sample.csv': ComputeError: invalid CSV",
};

export const datasetListItem: DatasetListItem = {
  dataset: datasetSummary,
  has_profile: true,
  latest_job: succeededJob,
};

export const uploadResponse: DatasetUploadResponse = {
  dataset: datasetSummary,
  job: queuedJob,
};
