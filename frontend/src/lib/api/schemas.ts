/**
 * Runtime validation for every API payload.
 *
 * Each schema is annotated with the matching mirror type from `@/types/api`, so
 * a backend field change breaks `tsc` here instead of failing silently in the
 * browser. Unknown fields are stripped by Zod, which is the documented policy
 * for forward-compatible responses.
 */

import { z } from "zod";

import type {
  CollinearityFinding,
  ColumnProfile,
  CorrelationMatrix,
  DatasetListItem,
  DatasetSummary,
  DatasetUploadResponse,
  JobRecord,
  ProfileReport,
  ProfilingWarning,
  TopValue,
} from "@/types/api";

const datasetFormatSchema = z.enum(["csv", "parquet"]);
const semanticTypeSchema = z.enum([
  "numeric",
  "categorical",
  "boolean",
  "temporal",
  "unknown",
]);
const warningSeveritySchema = z.enum(["info", "warning", "critical"]);
const collinearitySeveritySchema = z.enum(["ok", "moderate", "severe"]);
const jobKindSchema = z.enum(["profiling", "benchmark"]);
const jobStatusSchema = z.enum(["queued", "running", "succeeded", "failed"]);

export const datasetSummarySchema: z.ZodType<DatasetSummary> = z.object({
  dataset_id: z.string(),
  filename: z.string(),
  format: datasetFormatSchema,
  size_bytes: z.number(),
  uploaded_at: z.string(),
  row_count: z.number().nullable(),
  column_count: z.number().nullable(),
});

export const topValueSchema: z.ZodType<TopValue> = z.object({
  value: z.string(),
  count: z.number(),
  percentage: z.number(),
});

export const columnProfileSchema: z.ZodType<ColumnProfile> = z.object({
  name: z.string(),
  dtype: z.string(),
  semantic_type: semanticTypeSchema,
  null_count: z.number(),
  null_percentage: z.number(),
  unique_count: z.number(),
  is_constant: z.boolean(),
  mean: z.number().nullable(),
  std: z.number().nullable(),
  minimum: z.number().nullable(),
  maximum: z.number().nullable(),
  q1: z.number().nullable(),
  median: z.number().nullable(),
  q3: z.number().nullable(),
  skewness: z.number().nullable(),
  kurtosis: z.number().nullable(),
  top_values: z.array(topValueSchema),
});

export const collinearityFindingSchema: z.ZodType<CollinearityFinding> = z.object({
  feature: z.string(),
  vif: z.number(),
  severity: collinearitySeveritySchema,
  correlated_with: z.string().nullable(),
});

export const profilingWarningSchema: z.ZodType<ProfilingWarning> = z.object({
  code: z.string(),
  severity: warningSeveritySchema,
  column: z.string().nullable(),
  message: z.string(),
});

export const correlationMatrixSchema: z.ZodType<CorrelationMatrix> = z.object({
  features: z.array(z.string()),
  values: z.array(z.array(z.number())),
});

export const profileReportSchema: z.ZodType<ProfileReport> = z.object({
  dataset_id: z.string(),
  row_count: z.number(),
  column_count: z.number(),
  memory_bytes: z.number(),
  duplicate_rows: z.number(),
  duplicate_percentage: z.number(),
  generated_at: z.string(),
  duration_ms: z.number(),
  numeric_columns: z.number(),
  categorical_columns: z.number(),
  columns: z.array(columnProfileSchema),
  collinearity: z.array(collinearityFindingSchema),
  correlation: correlationMatrixSchema.nullable(),
  warnings: z.array(profilingWarningSchema),
});

export const jobRecordSchema: z.ZodType<JobRecord> = z.object({
  job_id: z.string(),
  kind: jobKindSchema,
  status: jobStatusSchema,
  progress: z.number(),
  stage: z.string(),
  dataset_id: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
  error: z.string().nullable(),
  result: z.record(z.string(), z.unknown()).nullable(),
});

export const datasetUploadResponseSchema: z.ZodType<DatasetUploadResponse> = z.object({
  dataset: datasetSummarySchema,
  job: jobRecordSchema,
});

export const datasetListItemSchema: z.ZodType<DatasetListItem> = z.object({
  dataset: datasetSummarySchema,
  has_profile: z.boolean(),
  latest_job: jobRecordSchema.nullable(),
});
