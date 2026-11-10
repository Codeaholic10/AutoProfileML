import type { CorrelationMatrix } from "@/types/api";

const MAX_MIX_PERCENT = 60;

function cellBackground(value: number): string {
  const clamped = Math.max(-1, Math.min(1, value));
  const percent = Math.round(Math.abs(clamped) * MAX_MIX_PERCENT);
  const pole = clamped >= 0 ? "var(--viz-positive)" : "var(--viz-negative)";
  return `color-mix(in oklab, ${pole} ${percent}%, var(--viz-neutral))`;
}

/**
 * Pearson correlation matrix.
 *
 * Diverging blue↔red with a neutral midpoint; every value is reachable in the
 * table (with screen-reader text) and via the native tooltip, so color is never
 * the only channel.
 */
export function CorrelationHeatmap({
  correlation,
}: {
  correlation: CorrelationMatrix | null;
}) {
  return (
    <section aria-labelledby="correlation-heading" className="space-y-3">
      <h2 id="correlation-heading" className="text-lg font-semibold">
        Correlation
      </h2>

      {correlation === null ? (
        <p className="rounded-xl border border-dashed px-4 py-6 text-sm text-muted-foreground">
          A correlation matrix needs at least two numeric features.
        </p>
      ) : (
        <div className="space-y-3">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span>-1</span>
            <span
              aria-hidden="true"
              className="h-2 w-40 rounded-full"
              style={{
                background:
                  "linear-gradient(to right, var(--viz-negative), var(--viz-neutral), var(--viz-positive))",
              }}
            />
            <span>+1</span>
            <span className="sr-only">
              Blue shows negative correlation, gray shows no correlation, and red
              shows positive correlation.
            </span>
          </div>

          <div className="overflow-x-auto rounded-xl border">
            <table className="w-full border-collapse text-xs">
              <caption className="sr-only">
                Pearson correlation between numeric features
              </caption>
              <thead>
                <tr>
                  <th scope="col" className="p-2 text-left font-medium text-muted-foreground">
                    Feature
                  </th>
                  {correlation.features.map((feature) => (
                    <th
                      key={feature}
                      scope="col"
                      className="p-2 text-center font-medium text-muted-foreground"
                    >
                      <span className="block max-w-24 truncate" title={feature}>
                        {feature}
                      </span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {correlation.features.map((rowFeature, rowIndex) => (
                  <tr key={rowFeature}>
                    <th
                      scope="row"
                      className="p-2 text-left font-medium text-muted-foreground"
                    >
                      <span className="block max-w-32 truncate" title={rowFeature}>
                        {rowFeature}
                      </span>
                    </th>
                    {correlation.features.map((columnFeature, columnIndex) => {
                      const value =
                        correlation.values[rowIndex]?.[columnIndex] ?? 0;
                      return (
                        <td key={columnFeature} className="p-[1px]">
                          <div
                            aria-label={`${rowFeature} and ${columnFeature}: ${value.toFixed(2)}`}
                            className="grid size-8 place-items-center rounded-sm"
                            style={{ backgroundColor: cellBackground(value) }}
                            title={`${rowFeature} × ${columnFeature}: ${value.toFixed(2)}`}
                          >
                            <span className="sr-only">{value.toFixed(2)}</span>
                          </div>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </section>
  );
}
