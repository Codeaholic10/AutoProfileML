import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { BenchmarkComparison } from "@/features/benchmarks/components/benchmark-comparison";
import { familyRows } from "@/features/benchmarks/comparison";
import type { BenchmarkRun } from "@/types/api";
import { benchmarkRun, regressionRun } from "@/test/msw/fixtures";

function improvedRun(): BenchmarkRun {
  return {
    ...benchmarkRun,
    benchmark_id: "bench-0002",
    created_at: "2026-10-23T09:00:00Z",
    folds: 3,
    sample_rows: 120,
    excluded_features: ["income_copy"],
    best_model_id: "model-boost",
    leaderboard: benchmarkRun.leaderboard.map((model) => {
      if (model.model_id === "model-boost") {
        return {
          ...model,
          rank: 1,
          metrics: { ...model.metrics, f1_macro: 0.8, accuracy: 0.81 },
        };
      }
      if (model.model_id === "model-forest") {
        return {
          ...model,
          rank: 2,
          metrics: { ...model.metrics, f1_macro: 0.75, accuracy: 0.76 },
        };
      }
      return model;
    }),
  };
}

function improvedRegressionRun(): BenchmarkRun {
  return {
    ...regressionRun,
    benchmark_id: "bench-0003",
    best_model_id: "model-ridge",
    leaderboard: regressionRun.leaderboard.map((model) =>
      model.model_id === "model-ridge"
        ? { ...model, metrics: { ...model.metrics, rmse: 700 } }
        : model,
    ),
  };
}

function modelRow(label: string): HTMLElement {
  for (const row of screen.getAllByRole("row")) {
    const cells = within(row).queryAllByRole("cell");
    if (cells[0]?.textContent?.trim() === label) {
      return row;
    }
  }
  throw new Error(`row not found: ${label}`);
}

describe("BenchmarkComparison", () => {
  it("shows configuration caveats and per-family metric deltas", () => {
    render(<BenchmarkComparison left={benchmarkRun} right={improvedRun()} />);

    expect(screen.getByText(/fold counts differ/i)).toBeInTheDocument();
    expect(screen.getByText(/training data differs/i)).toBeInTheDocument();
    expect(screen.getByText(/excluded features differ/i)).toBeInTheDocument();
    expect(screen.getByText(/higher-better/i)).toBeInTheDocument();

    expect(screen.getAllByText(/0\.69/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/0\.8/).length).toBeGreaterThan(0);
    expect(screen.getByText("+0.11")).toBeInTheDocument();

    const boost = modelRow("LightGBM");
    expect(within(boost).getByText("+0.16")).toBeInTheDocument();
    expect(within(boost).getByText("better")).toBeInTheDocument();

    const xgb = modelRow("XGBoost");
    expect(within(xgb).getAllByText("failed")).toHaveLength(2);
  });

  it("treats a lower RMSE as an improvement", () => {
    render(
      <BenchmarkComparison left={regressionRun} right={improvedRegressionRun()} />,
    );

    expect(screen.getByText(/lower-better/i)).toBeInTheDocument();
    const ridge = modelRow("Linear");
    expect(within(ridge).getByText("-112.5")).toBeInTheDocument();
    expect(within(ridge).getByText("better")).toBeInTheDocument();
  });

  it("withholds deltas when the task types differ", () => {
    const other: BenchmarkRun = {
      ...benchmarkRun,
      task_type: "regression",
      target: "income",
      leaderboard: benchmarkRun.leaderboard.map((model) => ({
        ...model,
        metrics: { rmse: 10, mae: 5, r2: 0.5 },
      })),
    };

    const rows = familyRows(benchmarkRun, other);
    expect(rows.every((row) => row.delta === null)).toBe(true);
    expect(rows.every((row) => row.leftValue === null)).toBe(true);
  });
});
