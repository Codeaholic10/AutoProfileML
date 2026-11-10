import { formatCount, formatPercent } from "@/lib/format";
import type { OutOfFoldPredictions } from "@/types/api";

import { buildConfusionMatrix } from "../analysis";

const MAX_MIX_PERCENT = 55;

function cellBackground(share: number): string {
  if (share <= 0) {
    return "var(--viz-neutral)";
  }
  const percent = Math.max(8, Math.round(share * MAX_MIX_PERCENT));
  return `color-mix(in oklab, var(--viz-series-1) ${percent}%, var(--viz-neutral))`;
}

/**
 * Out-of-fold confusion matrix: true classes as rows, predicted as columns.
 *
 * Color encodes the row-normalized share; every cell also carries its count,
 * a native tooltip with the percentage, and screen-reader text.
 */
export function ConfusionMatrixView({
  predictions,
}: {
  predictions: OutOfFoldPredictions;
}) {
  const matrix = buildConfusionMatrix(predictions);

  if (matrix.total === 0 || matrix.classes.length === 0) {
    return (
      <p className="rounded-xl border border-dashed px-4 py-6 text-sm text-muted-foreground">
        No out-of-fold predictions were stored for this model.
      </p>
    );
  }

  return (
    <div className="space-y-2">
      <div className="overflow-x-auto rounded-xl border">
        <table className="w-full border-collapse text-sm">
          <caption className="sr-only">
            Confusion matrix from out-of-fold predictions. Rows are true classes,
            columns are predicted classes, values are row counts.
          </caption>
          <thead>
            <tr>
              <th
                scope="col"
                className="p-2 text-left text-xs font-medium text-muted-foreground"
              >
                True ↓ / Predicted →
              </th>
              {matrix.classes.map((label) => (
                <th
                  key={label}
                  scope="col"
                  className="p-2 text-center text-xs font-medium text-muted-foreground"
                >
                  <span className="block max-w-28 truncate" title={label}>
                    {label}
                  </span>
                </th>
              ))}
              <th
                scope="col"
                className="p-2 text-right text-xs font-medium text-muted-foreground"
              >
                Support
              </th>
            </tr>
          </thead>
          <tbody>
            {matrix.classes.map((trueLabel, rowIndex) => {
              const row = matrix.counts[rowIndex] ?? [];
              const support = row.reduce((sum, value) => sum + value, 0);
              return (
                <tr key={trueLabel}>
                  <th
                    scope="row"
                    className="p-2 text-left text-xs font-medium text-muted-foreground"
                  >
                    <span className="block max-w-28 truncate" title={trueLabel}>
                      {trueLabel}
                    </span>
                  </th>
                  {matrix.classes.map((predictedLabel, columnIndex) => {
                    const count = row[columnIndex] ?? 0;
                    const share = support > 0 ? count / support : 0;
                    return (
                      <td
                        key={predictedLabel}
                        title={`True ${trueLabel} · predicted ${predictedLabel}: ${formatCount(
                          count,
                        )} rows (${formatPercent(share * 100, 1)} of ${trueLabel})`}
                        className="border-t p-2 text-center font-mono tabular-nums"
                        style={{ background: cellBackground(share) }}
                      >
                        {formatCount(count)}
                        <span className="block text-[0.68rem] text-muted-foreground">
                          {formatPercent(share * 100, 0)}
                        </span>
                      </td>
                    );
                  })}
                  <td className="border-t p-2 text-right tabular-nums text-muted-foreground">
                    {formatCount(support)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-muted-foreground">
        Darker blue means a larger share of that true class. Hover a cell for the
        exact count and percentage.
      </p>
    </div>
  );
}
