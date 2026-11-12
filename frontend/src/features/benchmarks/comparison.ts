/** Pure helpers for comparing two benchmark runs of the same dataset. */

import type { BenchmarkRun, ModelFamily, ModelResult, TaskType } from "@/types/api";

import {
  isHigherBetter,
  metricLabel,
  primaryMetric,
  primaryMetricValue,
} from "./metrics";

export const FAMILY_ORDER: readonly ModelFamily[] = [
  "linear",
  "random_forest",
  "lightgbm",
  "xgboost",
] as const;

export const FAMILY_LABELS: Record<ModelFamily, string> = {
  linear: "Linear",
  random_forest: "Random Forest",
  lightgbm: "LightGBM",
  xgboost: "XGBoost",
};

export type Verdict = "better" | "worse" | "same";

export interface FamilyComparisonRow {
  family: ModelFamily;
  label: string;
  left: ModelResult | null;
  right: ModelResult | null;
  leftValue: number | null;
  rightValue: number | null;
  delta: number | null;
  verdict: Verdict | null;
}

export function bestModel(run: BenchmarkRun): ModelResult | null {
  return (
    run.leaderboard.find((model) => model.model_id === run.best_model_id) ?? null
  );
}

function familyModel(
  run: BenchmarkRun,
  family: ModelFamily,
): ModelResult | null {
  return run.leaderboard.find((model) => model.family === family) ?? null;
}

function metricValue(
  model: ModelResult | null,
  task: TaskType,
): number | null {
  if (model === null || model.status !== "succeeded") {
    return null;
  }
  return primaryMetricValue(model, task) ?? null;
}

export function verdictFor(
  delta: number,
  metric: string,
): Verdict {
  if (delta === 0) {
    return "same";
  }
  const better = isHigherBetter(metric) ? delta > 0 : delta < 0;
  return better ? "better" : "worse";
}

/**
 * Match the four registry families across two runs.
 *
 * Deltas are only meaningful when both runs share a task type; otherwise the
 * primary metric differs and every delta is left null.
 */
export function familyRows(
  left: BenchmarkRun,
  right: BenchmarkRun,
): FamilyComparisonRow[] {
  const comparable = left.task_type === right.task_type;
  const metric = primaryMetric(left.task_type);
  return FAMILY_ORDER.map((family) => {
    const leftModel = familyModel(left, family);
    const rightModel = familyModel(right, family);
    const leftValue = comparable ? metricValue(leftModel, left.task_type) : null;
    const rightValue = comparable
      ? metricValue(rightModel, right.task_type)
      : null;
    const delta =
      leftValue !== null && rightValue !== null ? rightValue - leftValue : null;
    return {
      family,
      label: FAMILY_LABELS[family],
      left: leftModel,
      right: rightModel,
      leftValue,
      rightValue,
      delta,
      verdict: delta === null ? null : verdictFor(delta, metric),
    };
  });
}

export interface BestModelDelta {
  metric: string;
  leftValue: number | null;
  rightValue: number | null;
  delta: number | null;
  verdict: Verdict | null;
}

export function bestModelDelta(
  left: BenchmarkRun,
  right: BenchmarkRun,
): BestModelDelta {
  const metric = primaryMetric(left.task_type);
  const comparable = left.task_type === right.task_type;
  const leftValue = comparable
    ? metricValue(bestModel(left), left.task_type)
    : null;
  const rightValue = comparable
    ? metricValue(bestModel(right), right.task_type)
    : null;
  const delta =
    leftValue !== null && rightValue !== null ? rightValue - leftValue : null;
  return {
    metric,
    leftValue,
    rightValue,
    delta,
    verdict: delta === null ? null : verdictFor(delta, metric),
  };
}

/** Human-readable caveats that qualify any metric difference. */
export function comparabilityWarnings(
  left: BenchmarkRun,
  right: BenchmarkRun,
): string[] {
  const warnings: string[] = [];
  if (left.task_type !== right.task_type) {
    warnings.push(
      `The runs optimize different tasks (${left.task_type} vs ${right.task_type}); metric deltas are not comparable.`,
    );
  }
  if (left.target !== right.target) {
    warnings.push(
      `Targets differ ('${left.target}' vs '${right.target}'); compare the workflow, not the scores.`,
    );
  }
  if (left.folds !== right.folds) {
    warnings.push(
      `Fold counts differ (${left.folds} vs ${right.folds}); metric differences include fold noise.`,
    );
  }
  const leftRows = left.sample_rows === null ? "full dataset" : `${left.sample_rows} sampled rows`;
  const rightRows =
    right.sample_rows === null ? "full dataset" : `${right.sample_rows} sampled rows`;
  if (left.sample_rows !== right.sample_rows) {
    warnings.push(
      `Training data differs (${leftRows} vs ${rightRows}); differences may reflect the sample rather than the features.`,
    );
  }
  const leftExcluded = left.excluded_features.join(", ") || "none";
  const rightExcluded = right.excluded_features.join(", ") || "none";
  if (leftExcluded !== rightExcluded) {
    warnings.push(
      `Excluded features differ (${leftExcluded} vs ${rightExcluded}).`,
    );
  }
  for (const [label, run] of [
    ["Run A", left],
    ["Run B", right],
  ] as const) {
    if (run.status !== "succeeded") {
      warnings.push(`${label} is ${run.status}; its metrics are incomplete.`);
    }
  }
  return warnings;
}

export function metricHeading(task: TaskType): string {
  return metricLabel(primaryMetric(task));
}
