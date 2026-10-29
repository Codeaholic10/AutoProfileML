import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { getJob } from "@/lib/api/endpoints";
import { JOB_POLL_INTERVAL_MS, useJob } from "@/lib/api/hooks";
import type { JobStatus } from "@/types/api";

import { failedJob, runningJob, succeededJob } from "@/test/msw/fixtures";

vi.mock("@/lib/api/endpoints", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api/endpoints")>();
  return { ...actual, getJob: vi.fn() };
});

const getJobMock = vi.mocked(getJob);

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  }

  return Wrapper;
}

async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

async function waitForStatus(
  readStatus: () => JobStatus | undefined,
  expected: JobStatus,
) {
  await act(async () => {
    await vi.waitFor(() => {
      expect(readStatus()).toBe(expected);
    });
  });
}

describe("useJob", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    getJobMock.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("polls until the job succeeds and then stops", async () => {
    getJobMock.mockResolvedValueOnce(runningJob).mockResolvedValue(succeededJob);

    const { result } = renderHook(() => useJob("job-0001"), {
      wrapper: createWrapper(),
    });

    await advance(0);
    await waitForStatus(() => result.current.data?.status, "running");

    await advance(JOB_POLL_INTERVAL_MS);
    await waitForStatus(() => result.current.data?.status, "succeeded");

    await advance(JOB_POLL_INTERVAL_MS * 5);
    expect(getJobMock).toHaveBeenCalledTimes(2);
  });

  it("stops polling after the job fails", async () => {
    getJobMock.mockResolvedValueOnce(runningJob).mockResolvedValue(failedJob);

    const { result } = renderHook(() => useJob("job-0002"), {
      wrapper: createWrapper(),
    });

    await advance(0);
    await waitForStatus(() => result.current.data?.status, "running");

    await advance(JOB_POLL_INTERVAL_MS);
    await waitForStatus(() => result.current.data?.status, "failed");

    await advance(JOB_POLL_INTERVAL_MS * 5);
    expect(getJobMock).toHaveBeenCalledTimes(2);
  });

  it("does not fetch without a job id", () => {
    const { result } = renderHook(() => useJob(undefined), {
      wrapper: createWrapper(),
    });

    expect(result.current.fetchStatus).toBe("idle");
    expect(getJobMock).not.toHaveBeenCalled();
  });
});
