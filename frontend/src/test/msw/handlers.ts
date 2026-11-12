/**
 * MSW handlers for the dataset and job API.
 *
 * Specific paths are registered before the `:param` routes so they win the
 * match. Tests override any handler with `server.use(...)`.
 */

import { http, HttpResponse, type HttpHandler } from "msw";

import { getApiBaseUrl } from "@/lib/api/client";
import type { JobRecord } from "@/types/api";

import {
  benchmarkEnqueueResponse,
  benchmarkRun,
  benchmarkSummary,
  datasetListItem,
  datasetSummary,
  explanationEnqueueResponse,
  explanationReport,
  exportEnqueueResponse,
  exportManifest,
  failedJob,
  outOfFoldPredictions,
  profileReport,
  queuedJob,
  runningJob,
  succeededJob,
  uploadResponse,
} from "./fixtures";

const api = `${getApiBaseUrl()}/api`;

export const handlers: HttpHandler[] = [
  // Error envelopes.
  http.get(`${api}/datasets/missing-dataset`, () =>
    HttpResponse.json({ detail: "Dataset not found." }, { status: 404 }),
  ),
  http.get(`${api}/datasets/pending-dataset/profile`, () =>
    HttpResponse.json(
      { detail: "Profile not available yet. Poll the job status endpoint." },
      { status: 409 },
    ),
  ),
  http.post(`${api}/datasets/oversized-dataset/profile`, () =>
    HttpResponse.json(
      { detail: "Uploaded file is larger than the 200 MB limit." },
      { status: 413 },
    ),
  ),

  // Datasets.
  http.get(`${api}/datasets`, () => HttpResponse.json([datasetListItem])),
  http.post(`${api}/datasets`, () => HttpResponse.json(uploadResponse, { status: 202 })),
  http.get(`${api}/datasets/:datasetId`, () => HttpResponse.json(datasetSummary)),
  http.get(`${api}/datasets/:datasetId/profile`, () => HttpResponse.json(profileReport)),
  http.post(`${api}/datasets/:datasetId/profile`, () =>
    HttpResponse.json(queuedJob, { status: 202 }),
  ),
  http.get(`${api}/datasets/:datasetId/jobs`, () => HttpResponse.json([succeededJob])),

  // Benchmarks.
  http.post(`${api}/datasets/:datasetId/benchmarks`, () =>
    HttpResponse.json(benchmarkEnqueueResponse, { status: 202 }),
  ),
  http.get(`${api}/datasets/:datasetId/benchmarks`, () =>
    HttpResponse.json([benchmarkSummary]),
  ),
  http.post(`${api}/benchmarks/:benchmarkId/explanations`, () =>
    HttpResponse.json(explanationEnqueueResponse, { status: 202 }),
  ),
  http.get(`${api}/benchmarks/:benchmarkId/explanations/:modelId`, () =>
    HttpResponse.json({ detail: "Explanation not found." }, { status: 404 }),
  ),
  http.post(`${api}/benchmarks/:benchmarkId/exports`, () =>
    HttpResponse.json(exportEnqueueResponse, { status: 202 }),
  ),
  http.get(`${api}/benchmarks/:benchmarkId/exports/:modelId`, () =>
    HttpResponse.json({ detail: "Export not found." }, { status: 404 }),
  ),
  http.get(`${api}/benchmarks/:benchmarkId/models/:modelId/predictions`, () =>
    HttpResponse.json(outOfFoldPredictions),
  ),
  http.get(`${api}/benchmarks/:benchmarkId`, () => HttpResponse.json(benchmarkRun)),

  // Jobs.
  http.get(`${api}/jobs/:jobId`, () => HttpResponse.json(succeededJob)),
];

/**
 * Build a handler that advances through `jobs` on each request and then keeps
 * returning the last one. Use it to exercise polling without real delays.
 */
export function createJobProgressionHandler(jobs: JobRecord[]): HttpHandler {
  let index = 0;
  return http.get(`${api}/jobs/:jobId`, () => {
    const current = jobs[Math.min(index, jobs.length - 1)];
    index += 1;
    if (current === undefined) {
      return new HttpResponse(null, { status: 500 });
    }
    return HttpResponse.json(current);
  });
}

export {
  benchmarkEnqueueResponse,
  benchmarkRun,
  benchmarkSummary,
  explanationEnqueueResponse,
  explanationReport,
  exportEnqueueResponse,
  exportManifest,
  failedJob,
  outOfFoldPredictions,
  queuedJob,
  runningJob,
  succeededJob,
};
