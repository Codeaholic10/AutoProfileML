import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";

import { ApiError, apiFetch, getApiBaseUrl } from "@/lib/api/client";
import { getJob } from "@/lib/api/endpoints";
import { datasetSummarySchema } from "@/lib/api/schemas";
import { datasetSummary, runningJob, succeededJob } from "@/test/msw/fixtures";
import { createJobProgressionHandler } from "@/test/msw/handlers";
import { server } from "@/test/msw/server";

const api = `${getApiBaseUrl()}/api`;

async function captureError(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(
    () => null,
    (error: unknown) => error,
  );
}

describe("apiFetch", () => {
  it("returns the schema-parsed payload for a successful response", async () => {
    const result = await apiFetch("/api/datasets/ds-0001", datasetSummarySchema);

    expect(result).toEqual(datasetSummary);
  });

  it("maps a non-2xx JSON detail to ApiError", async () => {
    server.use(
      http.get(`${api}/datasets/broken`, () =>
        HttpResponse.json({ detail: "Dataset not found." }, { status: 404 }),
      ),
    );

    const error = await captureError(apiFetch("/api/datasets/broken", datasetSummarySchema));

    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 404, detail: "Dataset not found." });
  });

  it("joins FastAPI validation messages into one detail", async () => {
    server.use(
      http.get(`${api}/datasets/invalid`, () =>
        HttpResponse.json(
          { detail: [{ msg: "Field required" }, { msg: "Invalid file" }] },
          { status: 422 },
        ),
      ),
    );

    const error = await captureError(apiFetch("/api/datasets/invalid", datasetSummarySchema));

    expect(error).toMatchObject({
      status: 422,
      detail: "Field required; Invalid file",
    });
  });

  it("rejects a malformed JSON body", async () => {
    server.use(
      http.get(
        `${api}/datasets/malformed`,
        () =>
          new HttpResponse("not json", {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
      ),
    );

    const error = await captureError(apiFetch("/api/datasets/malformed", datasetSummarySchema));

    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({
      status: 200,
      detail: "The server returned a malformed JSON response.",
    });
  });

  it("rejects a payload that does not match the schema", async () => {
    server.use(
      http.get(`${api}/datasets/wrong-shape`, () =>
        HttpResponse.json({ dataset_id: 42 }),
      ),
    );

    const error = await captureError(
      apiFetch("/api/datasets/wrong-shape", datasetSummarySchema),
    );

    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({
      status: 200,
      detail: "The server returned an unexpected response shape.",
    });
  });

  it("reads a job through the progression handler", async () => {
    server.use(createJobProgressionHandler([runningJob, succeededJob]));

    const first = await getJob("job-progress");
    const second = await getJob("job-progress");
    const third = await getJob("job-progress");

    expect(first.status).toBe("running");
    expect(second.status).toBe("succeeded");
    expect(third.status).toBe("succeeded");
  });
});
