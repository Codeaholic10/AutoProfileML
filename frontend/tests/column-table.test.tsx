import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ColumnTable } from "@/features/profiling/components/column-table";
import type { ColumnProfile } from "@/types/api";

function column(
  overrides: Partial<ColumnProfile> & { name: string },
): ColumnProfile {
  return {
    dtype: "Int64",
    semantic_type: "numeric",
    null_count: 0,
    null_percentage: 0,
    unique_count: 10,
    is_constant: false,
    mean: 1,
    std: 1,
    minimum: 0,
    maximum: 1,
    q1: 0.25,
    median: 0.5,
    q3: 0.75,
    skewness: 0,
    kurtosis: 0,
    top_values: [],
    ...overrides,
  };
}

const columns: ColumnProfile[] = [
  column({
    name: "age",
    null_count: 10,
    null_percentage: 10,
    unique_count: 9,
  }),
  column({
    name: "city",
    dtype: "String",
    semantic_type: "categorical",
    unique_count: 3,
    top_values: [{ value: "delhi", count: 5, percentage: 50 }],
  }),
  column({ name: "score", null_percentage: 25, unique_count: 20 }),
  column({
    name: "constant_col",
    dtype: "String",
    semantic_type: "categorical",
    null_percentage: 5,
    unique_count: 1,
    is_constant: true,
  }),
];

function visibleNames(): string[] {
  return screen
    .getAllByRole("row")
    .slice(1)
    .map((row) => row.textContent ?? "");
}

describe("ColumnTable", () => {
  it("filters columns by the search query", () => {
    render(<ColumnTable columns={columns} />);

    fireEvent.change(screen.getByLabelText("Search columns"), {
      target: { value: "cit" },
    });

    expect(visibleNames()).toHaveLength(1);
    expect(visibleNames()[0]).toContain("city");
  });

  it("filters columns by semantic type", () => {
    render(<ColumnTable columns={columns} />);

    fireEvent.click(screen.getByRole("button", { name: "categorical" }));

    expect(visibleNames()).toHaveLength(2);
    expect(visibleNames()[0]).toContain("city");
    expect(visibleNames()[1]).toContain("constant_col");
  });

  it("sorts by missing percentage and toggles direction", () => {
    render(<ColumnTable columns={columns} />);

    fireEvent.click(screen.getByRole("button", { name: "Missing %" }));
    expect(visibleNames()[0]).toContain("city");
    expect(visibleNames()[1]).toContain("constant_col");
    expect(visibleNames()[2]).toContain("age");
    expect(visibleNames()[3]).toContain("score");

    fireEvent.click(screen.getByRole("button", { name: "Missing %" }));
    expect(visibleNames()[0]).toContain("score");
    expect(visibleNames()[3]).toContain("city");
  });

  it("shows an empty state when no column matches", () => {
    render(<ColumnTable columns={columns} />);

    fireEvent.change(screen.getByLabelText("Search columns"), {
      target: { value: "no-such-column" },
    });

    expect(
      screen.getByText("No columns match the current filters."),
    ).toBeInTheDocument();
  });
});
