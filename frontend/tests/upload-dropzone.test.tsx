import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { UploadDropzone } from "@/features/datasets/components/upload-dropzone";
import { MAX_UPLOAD_BYTES, MAX_UPLOAD_MB } from "@/features/datasets/constants";
import { ApiError } from "@/lib/api/client";
import { uploadDataset } from "@/lib/api/endpoints";
import { uploadResponse } from "@/test/msw/fixtures";

const { pushMock } = vi.hoisted(() => ({ pushMock: vi.fn() }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock, refresh: vi.fn() }),
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock("@/lib/api/endpoints", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api/endpoints")>();
  return { ...actual, uploadDataset: vi.fn() };
});

const uploadDatasetMock = vi.mocked(uploadDataset);

function renderDropzone() {
  const queryClient = new QueryClient({
    defaultOptions: { mutations: { retry: false } },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <UploadDropzone />
    </QueryClientProvider>,
  );
}

function csvFile(name = "sample.csv"): File {
  return new File(["age,city\n34,delhi\n"], name, { type: "text/csv" });
}

function oversizedCsvFile(): File {
  const file = csvFile("huge.csv");
  Object.defineProperty(file, "size", { value: MAX_UPLOAD_BYTES + 1 });
  return file;
}

function drop(file: File) {
  fireEvent.change(screen.getByLabelText("Upload dataset file"), {
    target: { files: [file] },
  });
}

describe("UploadDropzone", () => {
  beforeEach(() => {
    uploadDatasetMock.mockReset();
    pushMock.mockReset();
  });

  it("opens the file picker when the choose button is clicked", () => {
    renderDropzone();
    const clickSpy = vi.spyOn(HTMLInputElement.prototype, "click");

    fireEvent.click(screen.getByRole("button", { name: "Choose file" }));

    expect(clickSpy).toHaveBeenCalled();
  });

  it("uploads a valid CSV and navigates to the dataset", async () => {
    uploadDatasetMock.mockResolvedValue(uploadResponse);
    renderDropzone();

    drop(csvFile());

    await waitFor(() => {
      expect(uploadDatasetMock).toHaveBeenCalledTimes(1);
    });
    await waitFor(() => {
      expect(pushMock).toHaveBeenCalledWith("/datasets/ds-0001");
    });
  });

  it("rejects an unsupported file type inline", async () => {
    renderDropzone();

    drop(new File(["hello"], "notes.txt", { type: "text/plain" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Only .csv, .parquet, .pq files are supported.",
    );
    expect(uploadDatasetMock).not.toHaveBeenCalled();
  });

  it("rejects a file larger than the client-side limit inline", async () => {
    renderDropzone();

    drop(oversizedCsvFile());

    expect(await screen.findByRole("alert")).toHaveTextContent(
      `File is larger than ${MAX_UPLOAD_MB} MB.`,
    );
    expect(uploadDatasetMock).not.toHaveBeenCalled();
  });

  it("shows upload progress while the file is transferring", async () => {
    uploadDatasetMock.mockImplementation((_file, onProgress) => {
      onProgress?.(42);
      return new Promise(() => {});
    });
    renderDropzone();

    drop(csvFile());

    expect(await screen.findByText("Uploading 42%")).toBeInTheDocument();
    expect(screen.getByLabelText("Upload progress")).toBeInTheDocument();
  });

  it("shows the backend error detail verbatim", async () => {
    uploadDatasetMock.mockRejectedValue(
      new ApiError(413, "Uploaded file is larger than the 200 MB limit."),
    );
    renderDropzone();

    drop(csvFile());

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Uploaded file is larger than the 200 MB limit.",
    );
    expect(pushMock).not.toHaveBeenCalled();
  });
});
