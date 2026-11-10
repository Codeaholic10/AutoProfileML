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
  BenchmarkEnqueueResponse,
  BenchmarkRun,
  BenchmarkSummary,
  CollinearityFinding,
  ColumnProfile,
  CorrelationMatrix,
  DatasetListItem,
  DatasetSummary,
  DatasetUploadResponse,
  ExplanationEnqueueResponse,
  ExplanationReport,
  FeatureImportance,
  JobRecord,
  LocalExplanation,
  ModelResult,
  OutOfFoldPrediction,
  OutOfFoldPredictions,
  PreprocessingPlan,
  PreprocessingStep,
  ProfileReport,
  ProfilingWarning,
  ShapContribution,
  ShapSummaryPoint,
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
const jobKindSchema = z.enum(["profiling", "benchmark", "explanation", "export"]);
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

/* ------------------------------------------------------------------------- */
/* Benchmarks                                                                 */
/* ------------------------------------------------------------------------- */

const taskTypeSchema = z.enum(["classification", "regression"]);
const modelFamilySchema = z.enum(["linear", "random_forest", "lightgbm", "xgboost"]);
const modelStatusSchema = z.enum(["succeeded", "failed"]);
const scalarValueSchema = z.union([z.number(), z.string(), z.boolean()]);
const preprocessingStepKindSchema = z.enum([
  "numeric_impute",
  "categorical_impute",
  "iqr_clip",
  "one_hot_encode",
  "target_encode",
  "standard_scale",
  "drop",
]);

export const preprocessingStepSchema: z.ZodType<PreprocessingStep> = z.object({
  kind: preprocessingStepKindSchema,
  columns: z.array(z.string()),
  strategy: z.string().nullable(),
  parameters: z.record(z.string(), scalarValueSchema),
});

export const preprocessingPlanSchema: z.ZodType<PreprocessingPlan> = z.object({
  numeric_features: z.array(z.string()),
  categorical_features: z.array(z.string()),
  excluded_features: z.array(z.string()),
  target_encoding: z.array(z.string()),
  one_hot_encoding: z.array(z.string()),
  steps: z.array(preprocessingStepSchema),
  notes: z.array(z.string()),
});

export const modelResultSchema: z.ZodType<ModelResult> = z.object({
  model_id: z.string(),
  name: z.string(),
  family: modelFamilySchema,
  status: modelStatusSchema,
  metrics: z.record(z.string(), z.number()),
  metric_std: z.record(z.string(), z.number()),
  training_seconds: z.number(),
  rank: z.number().nullable(),
  hyperparameters: z.record(z.string(), scalarValueSchema.nullable()),
  error: z.string().nullable(),
});

export const benchmarkRunSchema: z.ZodType<BenchmarkRun> = z.object({
  benchmark_id: z.string(),
  dataset_id: z.string(),
  target: z.string(),
  task_type: taskTypeSchema,
  task_detection_reason: z.string(),
  status: jobStatusSchema,
  folds: z.number(),
  random_state: z.number(),
  excluded_features: z.array(z.string()),
  sample_rows: z.number().nullable(),
  class_support: z.record(z.string(), z.number()),
  created_at: z.string(),
  updated_at: z.string(),
  preprocessing: preprocessingPlanSchema.nullable(),
  leaderboard: z.array(modelResultSchema),
  best_model_id: z.string().nullable(),
  error: z.string().nullable(),
});

export const benchmarkSummarySchema: z.ZodType<BenchmarkSummary> = z.object({
  benchmark_id: z.string(),
  dataset_id: z.string(),
  target: z.string(),
  task_type: taskTypeSchema,
  status: jobStatusSchema,
  best_model_name: z.string().nullable(),
  primary_metric: z.string(),
  primary_metric_value: z.number().nullable(),
  created_at: z.string(),
});

export const benchmarkEnqueueResponseSchema: z.ZodType<BenchmarkEnqueueResponse> = z.object({
  benchmark: benchmarkRunSchema,
  job: jobRecordSchema,
});

const predictionValueSchema = z.union([z.string(), z.number()]);

export const outOfFoldPredictionSchema: z.ZodType<OutOfFoldPrediction> = z.object({
  row_index: z.number(),
  y_true: predictionValueSchema,
  y_pred: predictionValueSchema,
  probabilities: z.record(z.string(), z.number()).nullable(),
});

export const outOfFoldPredictionsSchema: z.ZodType<OutOfFoldPredictions> = z.object({
  benchmark_id: z.string(),
  model_id: z.string(),
  task_type: taskTypeSchema,
  classes: z.array(z.string()),
  prediction_count: z.number(),
  truncated: z.boolean(),
  predictions: z.array(outOfFoldPredictionSchema),
});

/* ------------------------------------------------------------------------- */
/* Explanations                                                               */
/* ------------------------------------------------------------------------- */

export const featureImportanceSchema: z.ZodType<FeatureImportance> = z.object({
  feature: z.string(),
  mean_abs_shap: z.number(),
  rank: z.number(),
});

export const shapContributionSchema: z.ZodType<ShapContribution> = z.object({
  feature: z.string(),
  value: predictionValueSchema.nullable(),
  contribution: z.number(),
});

export const localExplanationSchema: z.ZodType<LocalExplanation> = z.object({
  row_index: z.number(),
  prediction: z.number(),
  base_value: z.number(),
  contributions: z.array(shapContributionSchema),
});

export const shapSummaryPointSchema: z.ZodType<ShapSummaryPoint> = z.object({
  feature: z.string(),
  feature_value: predictionValueSchema.nullable(),
  shap_value: z.number(),
});

export const explanationReportSchema: z.ZodType<ExplanationReport> = z.object({
  explanation_id: z.string(),
  benchmark_id: z.string(),
  model_id: z.string(),
  method: z.enum(["tree_shap", "linear_shap", "kernel_shap"]),
  sample_size: z.number(),
  background_size: z.number(),
  global_importance: z.array(featureImportanceSchema),
  summary_points: z.array(shapSummaryPointSchema),
  local_explanations: z.array(localExplanationSchema),
  created_at: z.string(),
  duration_ms: z.number(),
  warnings: z.array(profilingWarningSchema),
});

export const explanationEnqueueResponseSchema: z.ZodType<ExplanationEnqueueResponse> =
  z.object({
    explanation_id: z.string(),
    benchmark_id: z.string(),
    model_id: z.string(),
    task_type: taskTypeSchema,
    job: jobRecordSchema,
  });
