import { formatPercent } from "@/lib/format";

interface MissingnessBarProps {
  /** Missing percentage (0–100). */
  percentage: number;
  label: string;
}

/** A thin meter for missing values; the text beside it carries the number. */
export function MissingnessBar({ percentage, label }: MissingnessBarProps) {
  const clamped = Math.min(100, Math.max(0, percentage));

  return (
    <div
      aria-label={`${label}: ${formatPercent(percentage, 2)} missing`}
      className="h-1.5 w-full overflow-hidden rounded-full bg-muted"
      role="img"
    >
      <div
        className="h-full rounded-full bg-destructive"
        style={{ width: `${clamped}%` }}
      />
    </div>
  );
}
