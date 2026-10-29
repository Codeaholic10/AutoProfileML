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
};
