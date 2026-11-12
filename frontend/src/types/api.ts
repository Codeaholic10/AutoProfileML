/**
 * Types mirroring `backend/app/models/schemas.py`.
 *
 * Keep this file and the backend contract in sync in the same change. Field
 * names stay snake_case because they are the JSON the API actually returns;
 * timestamps stay ISO-8601 strings.
 */

export type DatasetFormat = "csv" | "parquet";
export type JobKind = "profiling" | "benchmark" | "explanation" | "export";
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

/* ------------------------------------------------------------------------- */
/* Benchmarks                                                                 */
/* ------------------------------------------------------------------------- */

export type TaskType = "classification" | "regression";
export type ModelFamily = "linear" | "random_forest" | "lightgbm" | "xgboost";

export interface BenchmarkCreateRequest {
  target: string;
  task_type: TaskType | null;
  excluded_features: string[];
  folds: number;
  sample_cap: number | null;
}

export type PreprocessingStepKind =
  | "numeric_impute"
  | "categorical_impute"
  | "iqr_clip"
  | "one_hot_encode"
  | "target_encode"
  | "standard_scale"
  | "drop";

export interface PreprocessingStep {
  kind: PreprocessingStepKind;
  columns: string[];
  strategy: string | null;
  parameters: Record<string, number | string | boolean>;
}

export interface PreprocessingPlan {
  numeric_features: string[];
  categorical_features: string[];
  excluded_features: string[];
  target_encoding: string[];
  one_hot_encoding: string[];
  steps: PreprocessingStep[];
  notes: string[];
}

export interface ModelResult {
  model_id: string;
  name: string;
  family: ModelFamily;
  status: "succeeded" | "failed";
  metrics: Record<string, number>;
  metric_std: Record<string, number>;
  training_seconds: number;
  rank: number | null;
  hyperparameters: Record<string, number | string | boolean | null>;
  error: string | null;
}

export interface BenchmarkRun {
  benchmark_id: string;
  dataset_id: string;
  target: string;
  task_type: TaskType;
  task_detection_reason: string;
  status: JobStatus;
  folds: number;
  random_state: number;
  excluded_features: string[];
  sample_cap: number | null;
  sample_rows: number | null;
  class_support: Record<string, number>;
  created_at: string;
  updated_at: string;
  preprocessing: PreprocessingPlan | null;
  leaderboard: ModelResult[];
  best_model_id: string | null;
  error: string | null;
}

export interface BenchmarkSummary {
  benchmark_id: string;
  dataset_id: string;
  target: string;
  task_type: TaskType;
  status: JobStatus;
  best_model_name: string | null;
  primary_metric: string;
  primary_metric_value: number | null;
  created_at: string;
}

export interface BenchmarkEnqueueResponse {
  benchmark: BenchmarkRun;
  job: JobRecord;
}

export interface OutOfFoldPrediction {
  row_index: number;
  y_true: string | number;
  y_pred: string | number;
  probabilities: Record<string, number> | null;
}

export interface OutOfFoldPredictions {
  benchmark_id: string;
  model_id: string;
  task_type: TaskType;
  classes: string[];
  prediction_count: number;
  truncated: boolean;
  predictions: OutOfFoldPrediction[];
}

/* ------------------------------------------------------------------------- */
/* Explanations                                                               */
/* ------------------------------------------------------------------------- */

export interface ExplanationCreateRequest {
  model_id: string;
  sample_size: number;
  local_rows: number;
}

export interface FeatureImportance {
  feature: string;
  mean_abs_shap: number;
  rank: number;
}

export interface ShapContribution {
  feature: string;
  value: string | number | null;
  contribution: number;
}

export interface LocalExplanation {
  row_index: number;
  prediction: number;
  base_value: number;
  contributions: ShapContribution[];
}

export interface ShapSummaryPoint {
  feature: string;
  feature_value: string | number | null;
  shap_value: number;
}

export type ExplanationMethod = "tree_shap" | "linear_shap" | "kernel_shap";

export interface ExplanationReport {
  explanation_id: string;
  benchmark_id: string;
  model_id: string;
  method: ExplanationMethod;
  sample_size: number;
  background_size: number;
  global_importance: FeatureImportance[];
  summary_points: ShapSummaryPoint[];
  local_explanations: LocalExplanation[];
  created_at: string;
  duration_ms: number;
  warnings: ProfilingWarning[];
}

export interface ExplanationEnqueueResponse {
  explanation_id: string;
  benchmark_id: string;
  model_id: string;
  task_type: TaskType;
  job: JobRecord;
}

/* ------------------------------------------------------------------------- */
/* Exports                                                                    */
/* ------------------------------------------------------------------------- */

export interface ExportCreateRequest {
  model_id: string;
}

export interface ExportFile {
  name: string;
  size_bytes: number;
}

export interface ExportManifest {
  export_id: string;
  benchmark_id: string;
  model_id: string;
  target: string;
  task_type: TaskType;
  model_name: string;
  files: ExportFile[];
  size_bytes: number;
  includes_onnx: boolean;
  onnx_note: string | null;
  created_at: string;
  duration_ms: number;
}

export interface ExportEnqueueResponse {
  export_id: string;
  benchmark_id: string;
  model_id: string;
  task_type: TaskType;
  job: JobRecord;
}
