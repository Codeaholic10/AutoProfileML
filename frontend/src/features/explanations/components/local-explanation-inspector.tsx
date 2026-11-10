"use client";

import { useState } from "react";

import { formatMetric } from "@/lib/format";
import type { LocalExplanation } from "@/types/api";

function displayFeature(feature: string): string {
  const separator = feature.indexOf("__");
  return separator >= 0 ? feature.slice(separator + 2) : feature;
}

function formatValue(value: string | number | null): string {
  if (value === null) {
    return "—";
  }
  return typeof value === "number" ? formatMetric(value) : value;
}

/** Row-by-row SHAP contributions with a signed bar per feature. */
export function LocalExplanationInspector({
  explanations,
}: {
  explanations: LocalExplanation[];
}) {
  const [rowIndex, setRowIndex] = useState(0);

  if (explanations.length === 0) {
    return (
      <p className="rounded-xl border border-dashed px-4 py-6 text-sm text-muted-foreground">
        No per-row explanations were stored.
      </p>
    );
  }

  const selected = explanations[rowIndex] ?? explanations[0];
  if (!selected) {
    return null;
  }
  const maxAbs = Math.max(
    1e-9,
    ...selected.contributions.map((item) => Math.abs(item.contribution)),
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="space-y-1">
          <h4 className="text-sm font-medium">Per-row explanation</h4>
          <p className="text-xs text-muted-foreground">
            Signed contributions in the model&apos;s output space. Red pushes the
            prediction up, blue pushes it down.
          </p>
        </div>
        <div className="space-y-1">
          <label htmlFor="explanation-row" className="text-xs text-muted-foreground">
            Sampled row
          </label>
          <select
            id="explanation-row"
            className="h-8 w-full max-w-xs rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
            value={rowIndex}
            onChange={(event) => setRowIndex(Number(event.target.value))}
          >
            {explanations.map((explanation, index) => (
              <option key={explanation.row_index} value={index}>
                Row {explanation.row_index} · prediction{" "}
                {formatMetric(explanation.prediction)}
              </option>
            ))}
          </select>
        </div>
      </div>

      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <div className="rounded-lg border px-3 py-2">
          <dt className="text-xs text-muted-foreground">Prediction</dt>
          <dd className="font-mono text-lg tabular-nums">
            {formatMetric(selected.prediction)}
          </dd>
        </div>
        <div className="rounded-lg border px-3 py-2">
          <dt className="text-xs text-muted-foreground">Base value</dt>
          <dd className="font-mono text-lg tabular-nums">
            {formatMetric(selected.base_value)}
          </dd>
        </div>
        <div className="rounded-lg border px-3 py-2">
          <dt className="text-xs text-muted-foreground">Contributions</dt>
          <dd className="font-mono text-lg tabular-nums">
            {selected.contributions.length}
          </dd>
        </div>
      </dl>

      <ul className="space-y-2">
        {selected.contributions.map((item) => {
          const share = (Math.abs(item.contribution) / maxAbs) * 50;
          const positive = item.contribution >= 0;
          return (
            <li
              key={item.feature}
              className="flex flex-wrap items-center gap-2 text-sm"
            >
              <span
                className="w-40 shrink-0 truncate font-mono text-xs"
                title={item.feature}
              >
                {displayFeature(item.feature)}
              </span>
              <span className="w-24 shrink-0 truncate text-xs text-muted-foreground">
                {formatValue(item.value)}
              </span>
              <div className="relative h-2 min-w-32 flex-1 rounded-full bg-muted">
                <span
                  aria-hidden="true"
                  className="absolute top-0 bottom-0 w-px bg-border"
                  style={{ left: "50%" }}
                />
                <span
                  aria-hidden="true"
                  className="absolute top-0 bottom-0 rounded-full"
                  style={{
                    left: positive ? "50%" : `${50 - share}%`,
                    width: `${share}%`,
                    background: positive
                      ? "var(--viz-positive)"
                      : "var(--viz-negative)",
                  }}
                />
              </div>
              <span className="w-20 shrink-0 text-right font-mono text-xs tabular-nums">
                {item.contribution > 0 ? "+" : ""}
                {formatMetric(item.contribution)}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
