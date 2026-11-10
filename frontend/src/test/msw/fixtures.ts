/** Deterministic API fixtures shared by MSW handlers and tests. */

import type {
  BenchmarkEnqueueResponse,
  BenchmarkRun,
  BenchmarkSummary,
  DatasetListItem,
  DatasetSummary,
  DatasetUploadResponse,
  ExplanationEnqueueResponse,
  ExplanationReport,
  JobRecord,
  OutOfFoldPredictions,
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

/* ------------------------------------------------------------------------- */
/* Benchmarks                                                                 */
/* ------------------------------------------------------------------------- */

const CREATED_AT = "2026-10-22T09:00:00Z";

export const benchmarkRun: BenchmarkRun = {
  benchmark_id: "bench-0001",
  dataset_id: datasetSummary.dataset_id,
  target: "city",
  task_type: "classification",
  task_detection_reason: "Target 'city' is categorical.",
  status: "succeeded",
  folds: 5,
  random_state: 42,
  excluded_features: [],
  sample_rows: null,
  class_support: { delhi: 4, mumbai: 3, pune: 3 },
  created_at: CREATED_AT,
  updated_at: "2026-10-22T09:01:00Z",
  preprocessing: {
    numeric_features: ["age"],
    categorical_features: ["city"],
    excluded_features: [],
    target_encoding: [],
    one_hot_encoding: ["city"],
    steps: [
      {
        kind: "numeric_impute",
        columns: ["age"],
        strategy: "median",
        parameters: { knn_neighbors: 5 },
      },
      {
        kind: "one_hot_encode",
        columns: ["city"],
        strategy: null,
        parameters: {},
      },
    ],
    notes: [],
  },
  leaderboard: [
    {
      model_id: "model-linear",
      name: "Logistic Regression",
      family: "linear",
      status: "succeeded",
      metrics: { accuracy: 0.58, f1_macro: 0.56, roc_auc: 0.71, log_loss: 0.94 },
      metric_std: { accuracy: 0.02, f1_macro: 0.03, roc_auc: 0.01, log_loss: 0.02 },
      training_seconds: 0.2,
      rank: 3,
      hyperparameters: { max_iter: 1000, class_weight: "balanced" },
      error: null,
    },
    {
      model_id: "model-forest",
      name: "Random Forest",
      family: "random_forest",
      status: "succeeded",
      metrics: { accuracy: 0.7, f1_macro: 0.69, roc_auc: 0.88, log_loss: 0.61 },
      metric_std: { accuracy: 0.03, f1_macro: 0.04, roc_auc: 0.02, log_loss: 0.03 },
      training_seconds: 1.5,
      rank: 1,
      hyperparameters: { n_estimators: 300 },
      error: null,
    },
    {
      model_id: "model-boost",
      name: "LightGBM",
      family: "lightgbm",
      status: "succeeded",
      metrics: { accuracy: 0.66, f1_macro: 0.64, roc_auc: 0.83, log_loss: 0.7 },
      metric_std: { accuracy: 0.02, f1_macro: 0.02, roc_auc: 0.03, log_loss: 0.01 },
      training_seconds: 1.1,
      rank: 2,
      hyperparameters: { n_estimators: 300, learning_rate: 0.05 },
      error: null,
    },
    {
      model_id: "model-xgb",
      name: "XGBoost",
      family: "xgboost",
      status: "failed",
      metrics: {},
      metric_std: {},
      training_seconds: 0,
      rank: null,
      hyperparameters: {},
      error: "ValueError: Invalid classes inferred from unique values",
    },
  ],
  best_model_id: "model-forest",
  error: null,
};

export const regressionRun: BenchmarkRun = {
  ...benchmarkRun,
  benchmark_id: "bench-0002",
  target: "income",
  task_type: "regression",
  task_detection_reason: "Target 'income' is numeric and continuous.",
  class_support: {},
  preprocessing: null,
  leaderboard: [
    {
      model_id: "model-ridge",
      name: "Ridge",
      family: "linear",
      status: "succeeded",
      metrics: { rmse: 812.5, mae: 601.2, r2: 0.71 },
      metric_std: { rmse: 32.1, mae: 21.4, r2: 0.02 },
      training_seconds: 0.1,
      rank: 1,
      hyperparameters: {},
      error: null,
    },
    {
      model_id: "model-forest-reg",
      name: "Random Forest",
      family: "random_forest",
      status: "succeeded",
      metrics: { rmse: 905.2, mae: 655.9, r2: 0.64 },
      metric_std: { rmse: 40.8, mae: 30.1, r2: 0.03 },
      training_seconds: 1.4,
      rank: 2,
      hyperparameters: { n_estimators: 300 },
      error: null,
    },
  ],
  best_model_id: "model-ridge",
};

export const benchmarkSummary: BenchmarkSummary = {
  benchmark_id: benchmarkRun.benchmark_id,
  dataset_id: benchmarkRun.dataset_id,
  target: benchmarkRun.target,
  task_type: benchmarkRun.task_type,
  status: benchmarkRun.status,
  best_model_name: "Random Forest",
  primary_metric: "f1_macro",
  primary_metric_value: 0.69,
  created_at: CREATED_AT,
};

export const benchmarkJob: JobRecord = {
  ...succeededJob,
  job_id: "job-bench",
  kind: "benchmark",
  dataset_id: datasetSummary.dataset_id,
  result: { benchmark_id: benchmarkRun.benchmark_id, model_count: 4 },
};

export const benchmarkEnqueueResponse: BenchmarkEnqueueResponse = {
  benchmark: {
    ...benchmarkRun,
    status: "queued",
    leaderboard: [],
    best_model_id: null,
    preprocessing: null,
    class_support: {},
  },
  job: { ...benchmarkJob, status: "queued", progress: 0, stage: "queued", result: null },
};

export const outOfFoldPredictions: OutOfFoldPredictions = {
  benchmark_id: benchmarkRun.benchmark_id,
  model_id: "model-forest",
  task_type: "classification",
  classes: ["delhi", "mumbai", "pune"],
  prediction_count: 6,
  truncated: false,
  predictions: [
    {
      row_index: 0,
      y_true: "delhi",
      y_pred: "delhi",
      probabilities: { delhi: 0.8, mumbai: 0.15, pune: 0.05 },
    },
    {
      row_index: 1,
      y_true: "mumbai",
      y_pred: "mumbai",
      probabilities: { delhi: 0.1, mumbai: 0.75, pune: 0.15 },
    },
    {
      row_index: 2,
      y_true: "pune",
      y_pred: "pune",
      probabilities: { delhi: 0.1, mumbai: 0.2, pune: 0.7 },
    },
    {
      row_index: 3,
      y_true: "delhi",
      y_pred: "mumbai",
      probabilities: { delhi: 0.3, mumbai: 0.6, pune: 0.1 },
    },
    {
      row_index: 4,
      y_true: "pune",
      y_pred: "delhi",
      probabilities: { delhi: 0.55, mumbai: 0.2, pune: 0.25 },
    },
    {
      row_index: 5,
      y_true: "mumbai",
      y_pred: "mumbai",
      probabilities: { delhi: 0.05, mumbai: 0.9, pune: 0.05 },
    },
  ],
};

export const explanationReport: ExplanationReport = {
  explanation_id: "explain-0001",
  benchmark_id: benchmarkRun.benchmark_id,
  model_id: "model-forest",
  method: "tree_shap",
  sample_size: 6,
  background_size: 6,
  global_importance: [
    { feature: "numeric__age", mean_abs_shap: 0.082, rank: 1 },
    { feature: "low_cardinality__city_delhi", mean_abs_shap: 0.051, rank: 2 },
    { feature: "numeric__income", mean_abs_shap: 0.02, rank: 3 },
  ],
  summary_points: [
    { feature: "numeric__age", feature_value: 31, shap_value: 0.06 },
    { feature: "numeric__age", feature_value: 44, shap_value: -0.04 },
    { feature: "low_cardinality__city_delhi", feature_value: "delhi", shap_value: 0.05 },
    {
      feature: "low_cardinality__city_delhi",
      feature_value: "pune",
      shap_value: -0.03,
    },
  ],
  local_explanations: [
    {
      row_index: 0,
      prediction: 0.8,
      base_value: 0.33,
      contributions: [
        { feature: "numeric__age", value: 31, contribution: 0.21 },
        { feature: "low_cardinality__city_delhi", value: "delhi", contribution: 0.12 },
        { feature: "numeric__income", value: 42000, contribution: -0.03 },
      ],
    },
    {
      row_index: 1,
      prediction: 0.75,
      base_value: 0.33,
      contributions: [
        { feature: "low_cardinality__city_delhi", value: "mumbai", contribution: -0.18 },
        { feature: "numeric__age", value: 52, contribution: 0.07 },
      ],
    },
  ],
  created_at: "2026-10-22T09:05:00Z",
  duration_ms: 240.5,
  warnings: [],
};

export const explanationEnqueueResponse: ExplanationEnqueueResponse = {
  explanation_id: explanationReport.explanation_id,
  benchmark_id: benchmarkRun.benchmark_id,
  model_id: "model-forest",
  task_type: "classification",
  job: {
    ...succeededJob,
    job_id: "job-explain",
    kind: "explanation",
    result: { explanation_id: explanationReport.explanation_id },
  },
};
