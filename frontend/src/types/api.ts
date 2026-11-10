/**
 * Types mirroring `backend/app/models/schemas.py`.
 *
 * Keep this file and the backend contract in sync in the same change. Field
 * names stay snake_case because they are the JSON the API actually returns;
 * timestamps stay ISO-8601 strings.
 */

export type DatasetFormat = "csv" | "parquet";
export type JobKind = "profiling" | "benchmark";
export type JobStatus = "queued" | "running" | "succeeded" | "failed";
export type SemanticType = "numeric" | "categorical" | "boolean" | "temporal" | "unknown";
export type WarningSeverity = "info" | "warning" | "critical";
export type CollinearitySeverity = "ok" | "moderate" | "severe";

export interface DatasetSummary {
  dataset_id: string;
  filename: string;
  format: DatasetFormat;
  size_bytes: number;
  uploaded_at: string;
  row_count: number | null;
  column_count: number | null;
}

export interface TopValue {
  value: string;
  count: number;
  percentage: number;
}

export interface ColumnProfile {
  name: string;
  dtype: string;
  semantic_type: SemanticType;
  null_count: number;
  null_percentage: number;
  unique_count: number;
  is_constant: boolean;
  mean: number | null;
  std: number | null;
  minimum: number | null;
  maximum: number | null;
  q1: number | null;
  median: number | null;
  q3: number | null;
  skewness: number | null;
  kurtosis: number | null;
  top_values: TopValue[];
}

export interface CollinearityFinding {
  feature: string;
  vif: number;
  severity: CollinearitySeverity;
  correlated_with: string | null;
}

export interface ProfilingWarning {
  code: string;
  severity: WarningSeverity;
  column: string | null;
  message: string;
}

export interface CorrelationMatrix {
  features: string[];
  values: number[][];
}

export interface ProfileReport {
  dataset_id: string;
  row_count: number;
  column_count: number;
  memory_bytes: number;
  duplicate_rows: number;
  duplicate_percentage: number;
  generated_at: string;
  duration_ms: number;
  numeric_columns: number;
  categorical_columns: number;
  columns: ColumnProfile[];
  collinearity: CollinearityFinding[];
  correlation: CorrelationMatrix | null;
  warnings: ProfilingWarning[];
}

export interface JobRecord {
  job_id: string;
  kind: JobKind;
  status: JobStatus;
  progress: number;
  stage: string;
  dataset_id: string | null;
  created_at: string;
  updated_at: string;
  error: string | null;
  result: Record<string, unknown> | null;
}

export interface DatasetUploadResponse {
  dataset: DatasetSummary;
  job: JobRecord;
}

export interface DatasetListItem {
  dataset: DatasetSummary;
  has_profile: boolean;
  latest_job: JobRecord | null;
}
