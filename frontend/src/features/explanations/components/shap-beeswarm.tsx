import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatMetric } from "@/lib/format";
import type { ShapSummaryPoint } from "@/types/api";

const FEATURE_LIMIT = 10;
const WIDTH = 720;
const ROW_HEIGHT = 26;
const PAD_TOP = 16;
const PAD_BOTTOM = 40;
const PAD_LEFT = 180;
const PAD_RIGHT = 24;
const TABLE_LIMIT = 300;

interface FeatureBand {
  feature: string;
  points: ShapSummaryPoint[];
}

function groupByFeature(points: ShapSummaryPoint[]): FeatureBand[] {
  const order: string[] = [];
  const grouped = new Map<string, ShapSummaryPoint[]>();
  for (const point of points) {
    const existing = grouped.get(point.feature);
    if (existing) {
      existing.push(point);
    } else {
      order.push(point.feature);
      grouped.set(point.feature, [point]);
    }
  }
  return order
    .slice(0, FEATURE_LIMIT)
    .map((feature) => ({ feature, points: grouped.get(feature) ?? [] }));
}

function fractionOf(value: ShapSummaryPoint["feature_value"], band: FeatureBand): number {
  const numbers = band.points
    .map((point) => point.feature_value)
    .filter((item): item is number => typeof item === "number");
  if (typeof value === "number" && numbers.length === band.points.length) {
    const minimum = Math.min(...numbers);
    const maximum = Math.max(...numbers);
    return maximum > minimum ? (value - minimum) / (maximum - minimum) : 0.5;
  }
  const categories = [
    ...new Set(band.points.map((point) => String(point.feature_value ?? "—"))),
  ].sort();
  if (categories.length <= 1) {
    return 0.5;
  }
  const index = categories.indexOf(String(value ?? "—"));
  return index < 0 ? 0.5 : index / (categories.length - 1);
}

function jitter(position: number): number {
  const value = Math.sin(position * 12.9898) * 43758.5453;
  return (value - Math.floor(value)) * 2 - 1;
}

/** Per-feature SHAP value spread, colored by the feature's value. */
export function ShapBeeswarm({ points }: { points: ShapSummaryPoint[] }) {
  const bands = groupByFeature(points);

  if (bands.length === 0) {
    return (
      <p className="rounded-xl border border-dashed px-4 py-6 text-sm text-muted-foreground">
        No beeswarm points were stored for this explanation.
      </p>
    );
  }

  const height = PAD_TOP + bands.length * ROW_HEIGHT + PAD_BOTTOM;
  const plotWidth = WIDTH - PAD_LEFT - PAD_RIGHT;
  const maxAbs = Math.max(
    1e-9,
    ...bands.flatMap((band) => band.points.map((point) => Math.abs(point.shap_value))),
  );
  const xZero = PAD_LEFT + (plotWidth * maxAbs) / (2 * maxAbs);
  const scaleX = (shapValue: number) =>
    PAD_LEFT + ((shapValue + maxAbs) / (2 * maxAbs)) * plotWidth;

  const shownPoints = points.slice(0, TABLE_LIMIT);

  return (
    <figure className="space-y-2">
      <figcaption className="space-y-1">
        <span className="block text-sm font-medium">
          SHAP distribution by feature
        </span>
        <span className="block text-xs text-muted-foreground">
          Each dot is one sampled row. The horizontal position is the signed SHAP
          value; color intensity shows the feature value (light = low, dark = high).
        </span>
      </figcaption>

      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <span>low</span>
        <span
          aria-hidden="true"
          className="h-2 w-32 rounded-full"
          style={{
            background:
              "linear-gradient(to right, color-mix(in oklab, var(--viz-series-1) 18%, var(--viz-neutral)), var(--viz-series-1))",
          }}
        />
        <span>high</span>
      </div>

      <div className="overflow-x-auto">
        <svg
          role="img"
          aria-label="Beeswarm plot of SHAP values by feature"
          className="h-auto w-full min-w-[640px]"
          viewBox={`0 0 ${WIDTH} ${height}`}
        >
          <line
            stroke="var(--viz-axis)"
            strokeDasharray="4 4"
            x1={xZero}
            x2={xZero}
            y1={PAD_TOP - 6}
            y2={height - PAD_BOTTOM + 4}
          />
          {bands.map((band, bandIndex) => {
            const center = PAD_TOP + bandIndex * ROW_HEIGHT + ROW_HEIGHT / 2;
            const label =
              band.feature.length > 26
                ? `${band.feature.slice(0, 25)}…`
                : band.feature;
            return (
              <g key={band.feature}>
                <text
                  fill="var(--viz-muted)"
                  fontSize={11}
                  textAnchor="end"
                  x={PAD_LEFT - 12}
                  y={center + 4}
                >
                  {label}
                </text>
                {band.points.map((point, pointIndex) => {
                  const fraction = fractionOf(point.feature_value, band);
                  const share = Math.round(18 + fraction * 78);
                  const y =
                    center +
                    jitter(bandIndex * 10_000 + pointIndex) * (ROW_HEIGHT * 0.3);
                  return (
                    <circle
                      key={`${band.feature}-${pointIndex}`}
                      cx={scaleX(point.shap_value)}
                      cy={y}
                      fill={`color-mix(in oklab, var(--viz-series-1) ${share}%, var(--viz-neutral))`}
                      r={2.6}
                      stroke="var(--background)"
                      strokeWidth={0.5}
                    >
                      <title>
                        {`${band.feature} = ${String(point.feature_value ?? "—")} · SHAP ${formatMetric(
                          point.shap_value,
                        )}`}
                      </title>
                    </circle>
                  );
                })}
              </g>
            );
          })}
          <line
            stroke="var(--viz-axis)"
            x1={PAD_LEFT}
            x2={WIDTH - PAD_RIGHT}
            y1={height - PAD_BOTTOM + 8}
            y2={height - PAD_BOTTOM + 8}
          />
          {[-maxAbs, 0, maxAbs].map((tick) => (
            <text
              key={tick}
              fill="var(--viz-muted)"
              fontSize={11}
              textAnchor="middle"
              x={scaleX(tick)}
              y={height - PAD_BOTTOM + 24}
            >
              {formatMetric(tick)}
            </text>
          ))}
          <text
            fill="var(--viz-muted)"
            fontSize={11}
            textAnchor="middle"
            x={PAD_LEFT + plotWidth / 2}
            y={height - 6}
          >
            SHAP value (impact on the model output)
          </text>
        </svg>
      </div>

      <details className="text-sm">
        <summary className="cursor-pointer text-muted-foreground">
          View as table
        </summary>
        <Table>
          <TableCaption className="sr-only">
            SHAP values for the sampled rows, showing the first {shownPoints.length}
            {points.length > shownPoints.length
              ? ` of ${points.length} stored points`
              : " points"}
          </TableCaption>
          <TableHeader>
            <TableRow>
              <TableHead>Feature</TableHead>
              <TableHead>Feature value</TableHead>
              <TableHead className="text-right">SHAP value</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {shownPoints.map((point, index) => (
              <TableRow key={`${point.feature}-${index}`}>
                <TableCell className="font-mono text-xs">{point.feature}</TableCell>
                <TableCell>{String(point.feature_value ?? "—")}</TableCell>
                <TableCell className="text-right font-mono tabular-nums">
                  {formatMetric(point.shap_value)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        {points.length > shownPoints.length ? (
          <p className="text-xs text-muted-foreground">
            Showing the first {shownPoints.length} of {points.length} points in the
            table; the chart draws all of them.
          </p>
        ) : null}
      </details>
    </figure>
  );
}
