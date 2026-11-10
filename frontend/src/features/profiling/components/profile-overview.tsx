import {
  formatBytes,
  formatCount,
  formatDuration,
  formatPercent,
} from "@/lib/format";
import type { ProfileReport } from "@/types/api";

export function ProfileOverview({ profile }: { profile: ProfileReport }) {
  const tiles = [
    { label: "Rows", value: formatCount(profile.row_count) },
    { label: "Columns", value: formatCount(profile.column_count) },
    { label: "Memory", value: formatBytes(profile.memory_bytes) },
    {
      label: "Duplicate rows",
      value: `${formatCount(profile.duplicate_rows)} (${formatPercent(
        profile.duplicate_percentage,
        2,
      )})`,
    },
    { label: "Numeric columns", value: formatCount(profile.numeric_columns) },
    {
      label: "Categorical columns",
      value: formatCount(profile.categorical_columns),
    },
    { label: "Profile duration", value: formatDuration(profile.duration_ms) },
  ];

  return (
    <section aria-labelledby="overview-heading" className="space-y-3">
      <h2 id="overview-heading" className="text-lg font-semibold">
        Overview
      </h2>
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {tiles.map((tile) => (
          <div key={tile.label} className="rounded-xl border p-4">
            <dt className="text-xs text-muted-foreground">{tile.label}</dt>
            <dd className="mt-1 text-lg font-semibold">{tile.value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
