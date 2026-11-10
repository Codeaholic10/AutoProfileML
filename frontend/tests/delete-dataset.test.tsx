import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { DatasetTable } from "@/features/datasets/components/dataset-table";
import { deleteDataset } from "@/lib/api/endpoints";
import { datasetListItem } from "@/test/msw/fixtures";

const { refreshMock, successMock } = vi.hoisted(() => ({
  refreshMock: vi.fn(),
  successMock: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: refreshMock }),
}));

vi.mock("sonner", () => ({
  toast: { success: successMock, error: vi.fn() },
}));

vi.mock("@/lib/api/endpoints", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api/endpoints")>();
  return { ...actual, deleteDataset: vi.fn() };
});

const deleteDatasetMock = vi.mocked(deleteDataset);

function renderTable() {
  const queryClient = new QueryClient({
    defaultOptions: { mutations: { retry: false } },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <DatasetTable items={[datasetListItem]} />
    </QueryClientProvider>,
  );
}

describe("dataset deletion", () => {
  beforeEach(() => {
    deleteDatasetMock.mockReset();
    refreshMock.mockReset();
    successMock.mockReset();
  });

  it("deletes a dataset after confirmation and refreshes the list", async () => {
    deleteDatasetMock.mockResolvedValue(undefined);
    renderTable();

    fireEvent.click(screen.getByRole("button", { name: "Delete sample.csv" }));
    fireEvent.click(await screen.findByRole("button", { name: "Delete" }));

    await waitFor(() => {
      expect(deleteDatasetMock).toHaveBeenCalledWith("ds-0001");
    });
    expect(refreshMock).toHaveBeenCalledTimes(1);
    expect(successMock).toHaveBeenCalledWith("Deleted sample.csv");
  });

  it("does nothing when the confirmation is cancelled", async () => {
    renderTable();

    fireEvent.click(screen.getByRole("button", { name: "Delete sample.csv" }));
    fireEvent.click(await screen.findByRole("button", { name: "Cancel" }));

    await waitFor(() => {
      expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    });
    expect(deleteDatasetMock).not.toHaveBeenCalled();
  });
});
