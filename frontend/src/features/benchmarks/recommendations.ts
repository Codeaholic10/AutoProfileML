/** Heuristics that suggest feature exclusions before a benchmark run. */

import type { CollinearityFinding, ColumnProfile } from "@/types/api";

export interface ExclusionSuggestion {
  column: string;
  reason: string;
}

const IDENTIFIER_UNIQUE_RATIO = 0.95;
const IDENTIFIER_MIN_ROWS = 20;

/** Constant, highly collinear, and identifier-like columns are poor features. */
export function suggestExclusions(
  columns: ColumnProfile[],
  collinearity: CollinearityFinding[],
  rowCount: number,
): ExclusionSuggestion[] {
  const suggestions = new Map<string, ExclusionSuggestion>();

  for (const column of columns) {
    if (column.is_constant) {
      suggestions.set(column.name, {
        column: column.name,
        reason: "constant value",
      });
    }
  }

  for (const finding of collinearity) {
    if (finding.severity !== "severe" || finding.correlated_with === null) {
      continue;
    }
    if (suggestions.has(finding.feature)) {
      continue;
    }
    suggestions.set(finding.feature, {
      column: finding.feature,
      reason: `highly collinear with ${finding.correlated_with}`,
    });
  }

  if (rowCount >= IDENTIFIER_MIN_ROWS) {
    for (const column of columns) {
      if (column.semantic_type !== "categorical" && column.semantic_type !== "boolean") {
        continue;
      }
      if (column.unique_count < rowCount * IDENTIFIER_UNIQUE_RATIO) {
        continue;
      }
      if (suggestions.has(column.name)) {
        continue;
      }
      suggestions.set(column.name, {
        column: column.name,
        reason: "identifier-like (nearly unique)",
      });
    }
  }

  return [...suggestions.values()];
}
