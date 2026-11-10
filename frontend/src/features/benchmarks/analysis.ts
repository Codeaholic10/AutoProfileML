/** Derived views of the stored out-of-fold predictions. */

import type { OutOfFoldPrediction, OutOfFoldPredictions } from "@/types/api";

export interface ConfusionMatrixData {
  classes: string[];
  /** counts[trueIndex][predictedIndex] */
  counts: number[][];
  total: number;
}

export function buildConfusionMatrix(
  payload: OutOfFoldPredictions,
): ConfusionMatrixData {
  const classes = payload.classes;
  const index = new Map(classes.map((label, position) => [label, position]));
  const counts = classes.map(() => classes.map(() => 0));

  for (const prediction of payload.predictions) {
    const trueIndex = index.get(String(prediction.y_true));
    const predictedIndex = index.get(String(prediction.y_pred));
    if (trueIndex === undefined || predictedIndex === undefined) {
      continue;
    }
    const row = counts[trueIndex];
    if (row !== undefined) {
      row[predictedIndex] = (row[predictedIndex] ?? 0) + 1;
    }
  }

  return { classes, counts, total: payload.prediction_count };
}

export interface RocPoint {
  fpr: number;
  tpr: number;
}

export interface RocCurve {
  label: string;
  auc: number;
  points: RocPoint[];
}

export interface RocCurves {
  curves: RocCurve[];
  hiddenClasses: number;
}

/** Common false-positive-rate grid so every curve shares one x axis. */
export const ROC_GRID = Array.from({ length: 51 }, (_unused, position) => position / 50);

/** Merge curves onto `ROC_GRID` as `series0`, `series1`, … keys. */
export function rocChartData(curves: RocCurve[]): Record<string, number>[] {
  return ROC_GRID.map((fpr) => {
    const row: Record<string, number> = { fpr };
    curves.forEach((curve, index) => {
      row[`series${index}`] = interpolateTpr(curve.points, fpr);
    });
    return row;
  });
}

const MAX_POINTS_PER_CURVE = 200;

function probabilityFor(
  prediction: OutOfFoldPrediction,
  label: string,
): number | null {
  const value = prediction.probabilities?.[label];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function rocPoints(scores: number[], positives: boolean[]): RocPoint[] {
  const pairs = scores
    .map((score, position) => ({ score, positive: positives[position] ?? false }))
    .sort((left, right) => right.score - left.score);

  const positivesTotal = pairs.filter((pair) => pair.positive).length;
  const negativesTotal = pairs.length - positivesTotal;
  if (positivesTotal === 0 || negativesTotal === 0) {
    return [];
  }

  const points: RocPoint[] = [{ fpr: 0, tpr: 0 }];
  let truePositives = 0;
  let falsePositives = 0;
  let previousScore: number | null = null;
  for (const pair of pairs) {
    if (previousScore !== null && pair.score !== previousScore) {
      points.push({
        fpr: falsePositives / negativesTotal,
        tpr: truePositives / positivesTotal,
      });
    }
    previousScore = pair.score;
    if (pair.positive) {
      truePositives += 1;
    } else {
      falsePositives += 1;
    }
  }
  points.push({ fpr: 1, tpr: 1 });

  const stride = Math.max(1, Math.ceil(points.length / MAX_POINTS_PER_CURVE));
  return points.filter(
    (_point, position) => position % stride === 0 || position === points.length - 1,
  );
}

function areaUnderCurve(points: RocPoint[]): number {
  let area = 0;
  for (let position = 1; position < points.length; position += 1) {
    const previous = points[position - 1];
    const current = points[position];
    if (previous === undefined || current === undefined) {
      continue;
    }
    area += ((current.fpr - previous.fpr) * (current.tpr + previous.tpr)) / 2;
  }
  return area;
}

function interpolateTpr(points: RocPoint[], fpr: number): number {
  let previous = points[0] ?? { fpr: 0, tpr: 0 };
  for (const point of points) {
    if (point.fpr >= fpr) {
      const span = point.fpr - previous.fpr;
      if (span <= 0) {
        return point.tpr;
      }
      const weight = (fpr - previous.fpr) / span;
      return previous.tpr + weight * (point.tpr - previous.tpr);
    }
    previous = point;
  }
  return 1;
}

/**
 * Per-class one-vs-rest ROC curves plus a macro average.
 *
 * Only classes with stored probabilities are plotted, and at most four classes
 * keep the categorical palette readable; the macro curve always comes first.
 */
export function buildRocCurves(
  payload: OutOfFoldPredictions,
  maxClasses = 4,
): RocCurves {
  const rows = payload.predictions.filter(
    (prediction) => prediction.probabilities !== null,
  );
  if (rows.length === 0 || payload.classes.length === 0) {
    return { curves: [], hiddenClasses: 0 };
  }

  const support = new Map<string, number>();
  for (const prediction of rows) {
    const label = String(prediction.y_true);
    support.set(label, (support.get(label) ?? 0) + 1);
  }
  const ranked = [...payload.classes].sort(
    (left, right) => (support.get(right) ?? 0) - (support.get(left) ?? 0),
  );
  const displayed = ranked.slice(0, maxClasses);

  const perClass: RocCurve[] = [];
  for (const label of displayed) {
    const scores: number[] = [];
    const positives: boolean[] = [];
    let complete = true;
    for (const prediction of rows) {
      const score = probabilityFor(prediction, label);
      if (score === null) {
        complete = false;
        break;
      }
      scores.push(score);
      positives.push(String(prediction.y_true) === label);
    }
    if (!complete) {
      continue;
    }
    const points = rocPoints(scores, positives);
    if (points.length === 0) {
      continue;
    }
    perClass.push({ label, points, auc: areaUnderCurve(points) });
  }

  if (perClass.length === 0) {
    return { curves: [], hiddenClasses: payload.classes.length };
  }

  const grid = Array.from({ length: 51 }, (_unused, position) => position / 50);
  const macroPoints: RocPoint[] = grid.map((fpr) => ({
    fpr,
    tpr:
      perClass.reduce((sum, curve) => sum + interpolateTpr(curve.points, fpr), 0) /
      perClass.length,
  }));
  const macroAuc =
    perClass.reduce((sum, curve) => sum + curve.auc, 0) / perClass.length;

  return {
    curves: [{ label: "Macro average", auc: macroAuc, points: macroPoints }, ...perClass],
    hiddenClasses: payload.classes.length - displayed.length,
  };
}

export interface Mistake {
  rowIndex: number;
  yTrue: string;
  yPred: string;
  confidence: number;
}

/** The most confident misclassifications in the out-of-fold sample. */
export function highestConfidenceMistakes(
  payload: OutOfFoldPredictions,
  limit = 10,
): Mistake[] {
  const mistakes: Mistake[] = [];
  for (const prediction of payload.predictions) {
    if (String(prediction.y_true) === String(prediction.y_pred)) {
      continue;
    }
    const probabilities = Object.values(prediction.probabilities ?? {});
    const confidence =
      probabilities.length > 0 ? Math.max(...probabilities) : 0;
    mistakes.push({
      rowIndex: prediction.row_index,
      yTrue: String(prediction.y_true),
      yPred: String(prediction.y_pred),
      confidence,
    });
  }
  return mistakes
    .sort((left, right) => right.confidence - left.confidence)
    .slice(0, limit);
}
