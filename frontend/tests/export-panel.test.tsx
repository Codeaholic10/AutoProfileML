import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";
import { HttpResponse, http } from "msw";

import { ExportPanel } from "@/features/exports/components/export-panel";
import { getApiBaseUrl } from "@/lib/api/client";
import { benchmarkRun, exportManifest } from "@/test/msw/fixtures";
import { server } from "@/test/msw/server";

function renderPanel() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
  }
  return render(<ExportPanel run={benchmarkRun} />, { wrapper: Wrapper });
}

describe("ExportPanel", () => {
  it("shows an empty state before a bundle is generated", async () => {
    renderPanel();

    expect(
      await screen.findByText(/no export bundle yet for this model/i),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /generate bundle/i }),
    ).toBeInTheDocument();
  });

  it("lists the bundle files and offers a download link", async () => {
    server.use(
      http.get(
        `${getApiBaseUrl()}/api/benchmarks/:benchmarkId/exports/:modelId`,
        () => HttpResponse.json(exportManifest),
      ),
    );

    renderPanel();

    expect(await screen.findByText("train_model.py")).toBeInTheDocument();
    expect(screen.getByText("train_model.ipynb")).toBeInTheDocument();
    expect(screen.getByText("model.joblib")).toBeInTheDocument();

    const download = screen.getByRole("link", { name: /download zip/i });
    expect(download).toHaveAttribute(
      "href",
      `${getApiBaseUrl()}/api/benchmarks/bench-0001/exports/model-forest/download`,
    );
    expect(download).toHaveAttribute("download");

    expect(screen.getByText(/onnx is not included/i)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /regenerate bundle/i }),
    ).toBeInTheDocument();
  });
});
