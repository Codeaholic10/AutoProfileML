import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";
import { HttpResponse, http } from "msw";

import { ExplanationPanel } from "@/features/explanations/components/explanation-panel";
import { getApiBaseUrl } from "@/lib/api/client";
import { benchmarkRun, explanationReport } from "@/test/msw/fixtures";
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
  return render(<ExplanationPanel run={benchmarkRun} />, { wrapper: Wrapper });
}

describe("ExplanationPanel", () => {
  it("shows an empty state when no explanation exists yet", async () => {
    renderPanel();

    expect(
      await screen.findByText(/no explanation yet for this model/i),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /explain model/i }),
    ).toBeInTheDocument();
  });

  it("renders the persisted report when one exists", async () => {
    server.use(
      http.get(
        `${getApiBaseUrl()}/api/benchmarks/:benchmarkId/explanations/:modelId`,
        () => HttpResponse.json(explanationReport),
      ),
    );

    renderPanel();

    expect(
      await screen.findByText(/global feature importance \(mean \|SHAP\|\)/i),
    ).toBeInTheDocument();
    expect(screen.getByText(/Tree SHAP/)).toBeInTheDocument();
    expect(screen.getByText("Per-row explanation")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /re-explain model/i }),
    ).toBeInTheDocument();
  });
});
