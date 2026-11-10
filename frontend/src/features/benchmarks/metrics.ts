/** Metric names and ordering shared by the benchmark views. */

import type { BenchmarkRun, ModelResult, TaskType } from "@/types/api";

export const PRIMARY_METRIC: Record<TaskType, string> = {
  classification: "f1_macro",
  regression: "rmse",
};

const METRIC_LABELS: Record<string, string> = {
  accuracy: "Accuracy",
  f1_macro: "Macro F1",
  roc_auc: "ROC-AUC",
  log_loss: "Log loss",
  rmse: "RMSE",
  mae: "MAE",
  r2: "R²",
};

/** Metrics shown in the leaderboard besides the primary one. */
export const SECONDARY_METRICS: Record<TaskType, string[]> = {
  classification: ["accuracy", "roc_auc", "log_loss"],
  regression: ["mae", "r2"],
};

/** Lower is better for error-style metrics; higher is better otherwise. */
const LOWER_IS_BETTER = new Set(["log_loss", "rmse", "mae"]);

export function metricLabel(metric: string): string {
  return METRIC_LABELS[metric] ?? metric;
}

export function primaryMetric(task: TaskType): string {
  return PRIMARY_METRIC[task];
}

export function isHigherBetter(metric: string): boolean {
  return !LOWER_IS_BETTER.has(metric);
}

export function primaryMetricValue(
  model: ModelResult,
  task: TaskType,
): number | undefined {
  return model.metrics[primaryMetric(task)];
}

export function succeededModels(run: BenchmarkRun): ModelResult[] {
  return run.leaderboard.filter((model) => model.status === "succeeded");
}

/**
 * Order models for display: succeeded ones by `metric`, then failed ones at the
 * bottom. Dense ranks come from the backend.
 */
export function sortModels(
  leaderboard: ModelResult[],
  metric: string,
  direction?: "asc" | "desc",
): ModelResult[] {
  const higherBetter = isHigherBetter(metric);
  const descending = direction
    ? direction === "desc"
    : higherBetter;
  const succeeded = leaderboard.filter((model) => model.status === "succeeded");
  const failed = leaderboard.filter((model) => model.status !== "succeeded");
  const ordered = [...succeeded].sort((left, right) => {
    const a = left.metrics[metric] ?? Number.NEGATIVE_INFINITY;
    const b = right.metrics[metric] ?? Number.NEGATIVE_INFINITY;
    return descending ? b - a : a - b;
  });
  return [...ordered, ...failed];
}
