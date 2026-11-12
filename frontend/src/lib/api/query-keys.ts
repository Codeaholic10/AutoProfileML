/** Centralized TanStack Query keys. Hooks and mutations must use these. */

const datasetsKey = ["datasets"] as const;

export const queryKeys = {
  datasets: {
    all: datasetsKey,
    list: () => [...datasetsKey, "list"] as const,
    detail: (datasetId: string) => [...datasetsKey, "detail", datasetId] as const,
    profile: (datasetId: string) => [...datasetsKey, "profile", datasetId] as const,
    jobs: (datasetId: string) => [...datasetsKey, "jobs", datasetId] as const,
  },
  jobs: {
    detail: (jobId: string) => ["jobs", jobId] as const,
  },
  benchmarks: {
    all: ["benchmarks"] as const,
    list: (datasetId: string) => ["benchmarks", "list", datasetId] as const,
    detail: (benchmarkId: string) => ["benchmarks", "detail", benchmarkId] as const,
    predictions: (benchmarkId: string, modelId: string) =>
      ["benchmarks", "predictions", benchmarkId, modelId] as const,
  },
  explanations: {
    detail: (benchmarkId: string, modelId: string) =>
      ["explanations", benchmarkId, modelId] as const,
  },
  exports: {
    detail: (benchmarkId: string, modelId: string) =>
      ["exports", benchmarkId, modelId] as const,
  },
};
