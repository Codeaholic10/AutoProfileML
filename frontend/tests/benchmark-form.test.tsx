import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { BenchmarkForm } from "@/features/benchmarks/components/benchmark-form";
import type { ColumnProfile } from "@/types/api";

const { pushMock } = vi.hoisted(() => ({ pushMock: vi.fn() }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock, refresh: vi.fn() }),
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

const numericColumn: ColumnProfile = {
  name: "age",
  dtype: "Int64",
  semantic_type: "numeric",
  null_count: 0,
  null_percentage: 0,
  unique_count: 10,
  is_constant: false,
  mean: 40,
  std: 10,
  minimum: 20,
  maximum: 60,
  q1: 30,
  median: 40,
  q3: 50,
  skewness: 0,
  kurtosis: 0,
  top_values: [],
};

const constantColumn: ColumnProfile = {
  ...numericColumn,
  name: "constant_col",
  unique_count: 1,
  is_constant: true,
  std: 0,
  minimum: 1,
  maximum: 1,
  q1: 1,
  median: 1,
  q3: 1,
};

function renderForm() {
  const queryClient = new QueryClient({
    defaultOptions: { mutations: { retry: false } },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <BenchmarkForm
        datasetId="ds-0001"
        columns={[numericColumn, constantColumn]}
        collinearity={[]}
        rowCount={10}
      />
    </QueryClientProvider>,
  );
}

describe("BenchmarkForm", () => {
  beforeEach(() => {
    pushMock.mockReset();
  });

  it("requires a target column", async () => {
    renderForm();

    fireEvent.click(screen.getByRole("button", { name: /run benchmark/i }));

    expect(await screen.findByText("Choose a target column.")).toBeInTheDocument();
    expect(pushMock).not.toHaveBeenCalled();
  });

  it("submits the selected target and navigates to the run", async () => {
    renderForm();

    fireEvent.change(screen.getByLabelText("Target column"), {
      target: { value: "age" },
    });
    fireEvent.click(screen.getByRole("button", { name: /run benchmark/i }));

    await waitFor(() => {
      expect(pushMock).toHaveBeenCalledWith(
        "/benchmarks/bench-0001?job=job-bench",
      );
    });
  });

  it("recommends constant columns for exclusion", () => {
    renderForm();

    expect(
      screen.getByText(/recommended: constant value/),
    ).toBeInTheDocument();
  });
});
