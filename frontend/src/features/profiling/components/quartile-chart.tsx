import { formatMetric } from "@/lib/format";
import type { ColumnProfile } from "@/types/api";

/** A compact min–Q1–median–Q3–max range for a numeric column. */
export function QuartileChart({ column }: { column: ColumnProfile }) {
  const minimum = column.minimum;
  const q1 = column.q1;
  const median = column.median;
  const q3 = column.q3;
  const maximum = column.maximum;

  if (
    minimum === null ||
    q1 === null ||
    median === null ||
    q3 === null ||
    maximum === null
  ) {
    return null;
  }

  const span = maximum - minimum;
  const position = (value: number) =>
    span > 0 ? ((value - minimum) / span) * 100 : 50;

  const boxStart = position(q1);
  const boxWidth = Math.max(position(q3) - boxStart, 1);

  const points = [
    { label: "Min", value: minimum },
    { label: "Q1", value: q1 },
    { label: "Median", value: median },
    { label: "Q3", value: q3 },
    { label: "Max", value: maximum },
  ];

  return (
    <figure className="space-y-2">
      <figcaption className="text-sm font-medium">
        Distribution of {column.name}
      </figcaption>

      <div aria-hidden="true" className="relative h-12">
        <div
          className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2"
          style={{ backgroundColor: "var(--viz-axis)" }}
        />
        <div
          className="absolute top-1/2 h-6 -translate-y-1/2 rounded-sm"
          style={{
            left: `${boxStart}%`,
            width: `${boxWidth}%`,
            backgroundColor:
              "color-mix(in oklab, var(--viz-series-1) 25%, transparent)",
          }}
        />
        <div
          className="absolute top-1/2 h-8 w-0.5 -translate-y-1/2 rounded-full"
          style={{
            left: `${position(median)}%`,
            backgroundColor: "var(--viz-series-1)",
          }}
        />
        <div
          className="absolute top-1/2 size-2 -translate-x-1/2 -translate-y-1/2 rounded-full"
          style={{
            left: "0%",
            backgroundColor: "var(--viz-series-1)",
          }}
        />
        <div
          className="absolute top-1/2 size-2 -translate-x-1/2 -translate-y-1/2 rounded-full"
          style={{
            left: "100%",
            backgroundColor: "var(--viz-series-1)",
          }}
        />
      </div>

      <dl className="grid grid-cols-5 gap-2 text-xs">
        {points.map((point) => (
          <div key={point.label}>
            <dt className="text-muted-foreground">{point.label}</dt>
            <dd className="tabular-nums">{formatMetric(point.value)}</dd>
          </div>
        ))}
      </dl>
    </figure>
  );
}
