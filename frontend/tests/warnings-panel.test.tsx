import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { WarningsPanel } from "@/features/profiling/components/warnings-panel";
import type { ProfilingWarning } from "@/types/api";

const warnings: ProfilingWarning[] = [
  {
    code: "multicollinearity",
    severity: "critical",
    column: "income_copy",
    message: "2 feature(s) show severe multicollinearity (worst: 'income_copy').",
  },
  {
    code: "missing_values",
    severity: "warning",
    column: "age",
    message: "Column 'age' has 40 missing values (10.00%).",
  },
  {
    code: "high_cardinality",
    severity: "warning",
    column: "city",
    message: "Column 'city' has 400 distinct values.",
  },
  {
    code: "skewed_distribution",
    severity: "info",
    column: "income",
    message: "Column 'income' is heavily skewed (skew=2.10).",
  },
];

describe("WarningsPanel", () => {
  it("groups warnings by severity and shows their codes and messages", () => {
    render(<WarningsPanel warnings={warnings} />);

    expect(screen.getByText("critical")).toBeInTheDocument();
    expect(screen.getByText("warning")).toBeInTheDocument();
    expect(screen.getByText("info")).toBeInTheDocument();

    expect(screen.getByText("2 warnings")).toBeInTheDocument();
    expect(screen.getAllByText("1 warning")).toHaveLength(2);

    for (const warning of warnings) {
      expect(screen.getByText(warning.code)).toBeInTheDocument();
      expect(screen.getByText(warning.message)).toBeInTheDocument();
    }
  });

  it("shows an empty state when there are no warnings", () => {
    render(<WarningsPanel warnings={[]} />);

    expect(
      screen.getByText("No data-quality warnings detected."),
    ).toBeInTheDocument();
  });
});
