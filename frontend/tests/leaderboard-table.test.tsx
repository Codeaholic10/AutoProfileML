import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { LeaderboardTable } from "@/features/benchmarks/components/leaderboard-table";
import { benchmarkRun, regressionRun } from "@/test/msw/fixtures";

function bodyRows() {
  return screen.getAllByRole("row").slice(1);
}

describe("LeaderboardTable", () => {
  it("lists succeeded models best-first with dense ranks and failures last", () => {
    render(<LeaderboardTable run={benchmarkRun} />);

    const rows = bodyRows();
    expect(rows).toHaveLength(4);

    expect(within(rows[0] as HTMLElement).getByText("Random Forest")).toBeVisible();
    expect(within(rows[0] as HTMLElement).getByText("1")).toBeInTheDocument();
    expect(within(rows[0] as HTMLElement).getByText("best")).toBeInTheDocument();

    expect(within(rows[1] as HTMLElement).getByText("LightGBM")).toBeVisible();
    expect(within(rows[1] as HTMLElement).getByText("2")).toBeInTheDocument();

    expect(
      within(rows[2] as HTMLElement).getByText("Logistic Regression"),
    ).toBeVisible();
    expect(within(rows[2] as HTMLElement).getByText("3")).toBeInTheDocument();

    const failed = rows[3] as HTMLElement;
    expect(within(failed).getByText("XGBoost")).toBeVisible();
    expect(within(failed).getByText("failed")).toBeInTheDocument();
    expect(
      within(failed).getByText("ValueError: Invalid classes inferred from unique values"),
    ).toBeInTheDocument();
  });

  it("re-sorts when a metric header is toggled", () => {
    render(<LeaderboardTable run={benchmarkRun} />);

    fireEvent.click(screen.getByRole("button", { name: /macro f1/i }));
    const ascending = bodyRows();
    expect(
      within(ascending[0] as HTMLElement).getByText("Logistic Regression"),
    ).toBeVisible();
  });

  it("shows regression metrics for regression runs", () => {
    render(<LeaderboardTable run={regressionRun} />);

    expect(screen.getByRole("button", { name: /rmse/i })).toBeInTheDocument();
    expect(screen.getByText("R²")).toBeInTheDocument();
    const rows = bodyRows();
    expect(within(rows[0] as HTMLElement).getByText("Ridge")).toBeVisible();
    expect(within(rows[0] as HTMLElement).getByText("812.5")).toBeInTheDocument();
  });

  it("renders sortable headers without React key warnings", () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      render(<LeaderboardTable run={benchmarkRun} />);
      const keyWarnings = errorSpy.mock.calls.filter((args) =>
        args.some((arg) => String(arg).includes('unique "key"')),
      );
      expect(keyWarnings).toHaveLength(0);
    } finally {
      errorSpy.mockRestore();
    }
  });
});
