/**
 * The single HTTP boundary for the frontend.
 *
 * Every request goes through `apiFetch`, which parses the payload with Zod and
 * normalizes failures into `ApiError`. No component or hook may call `fetch`.
 */

import type { ZodType } from "zod";

const DEFAULT_API_BASE_URL = "http://localhost:8000";
const REQUEST_ID_HEADER = "x-request-id";

/** A normalized API failure. `status` is 0 when the server was unreachable. */
export class ApiError extends Error {
  readonly status: number;
  readonly detail: string;
  readonly requestId: string | undefined;

  constructor(status: number, detail: string, requestId?: string) {
    super(detail);
    this.name = "ApiError";
    this.status = status;
    this.detail = detail;
    this.requestId = requestId;
  }
}

/** Resolve the backend base URL, trimming any trailing slashes. */
export function getApiBaseUrl(): string {
  const configured = process.env.NEXT_PUBLIC_API_BASE_URL;
  if (configured !== undefined && configured.trim().length > 0) {
    return configured.trim().replace(/\/+$/, "");
  }
  return DEFAULT_API_BASE_URL;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Turn FastAPI's `{ detail }` envelope into a displayable string. */
function detailFromBody(body: unknown): string | null {
  if (!isRecord(body)) {
    return null;
  }
  const { detail } = body;
  if (typeof detail === "string") {
    return detail;
  }
  if (Array.isArray(detail)) {
    const messages: string[] = [];
    for (const item of detail) {
      if (isRecord(item) && typeof item.msg === "string") {
        messages.push(item.msg);
      }
    }
    if (messages.length > 0) {
      return messages.join("; ");
    }
  }
  return null;
}

/**
 * Send a request and normalize transport/HTTP failures into `ApiError`.
 *
 * Callers that expect a body parse it themselves; `apiSend` uses this for
 * `204 No Content` responses.
 */
async function request(path: string, init?: RequestInit): Promise<Response> {
  const url = `${getApiBaseUrl()}${path.startsWith("/") ? path : `/${path}`}`;
  const headers = new Headers(init?.headers);
  if (!headers.has("Accept")) {
    headers.set("Accept", "application/json");
  }

  let response: Response;
  try {
    response = await fetch(url, { ...init, headers, cache: "no-store" });
  } catch {
    throw new ApiError(0, "Could not reach the API server.");
  }

  if (!response.ok) {
    let body: unknown = null;
    try {
      body = await response.json();
    } catch {
      body = null;
    }
    const detail = detailFromBody(body) ?? (response.statusText || "Request failed.");
    const requestId = response.headers.get(REQUEST_ID_HEADER) ?? undefined;
    throw new ApiError(response.status, detail, requestId);
  }

  return response;
}

/**
 * Fetch `path`, validate the JSON against `schema`, and return it.
 *
 * `cache: "no-store"` is forced because dataset state changes on every upload
 * and profile run; the Next.js Data Cache must never serve a stale response.
 */
export async function apiFetch<T>(
  path: string,
  schema: ZodType<T>,
  init?: RequestInit,
): Promise<T> {
  const response = await request(path, init);

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new ApiError(response.status, "The server returned a malformed JSON response.");
  }

  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    throw new ApiError(response.status, "The server returned an unexpected response shape.");
  }
  return parsed.data;
}

/** Send a request whose response has no body (for example `DELETE` → `204`). */
export async function apiSend(path: string, init?: RequestInit): Promise<void> {
  await request(path, init);
}

/**
 * Upload a multipart form with transfer progress.
 *
 * `XMLHttpRequest` is used because `fetch` does not expose upload progress in
 * browsers. Response validation and error normalization match `apiFetch`.
 */
export function apiUpload<T>(
  path: string,
  form: FormData,
  schema: ZodType<T>,
  onProgress?: (percent: number) => void,
): Promise<T> {
  const url = `${getApiBaseUrl()}${path.startsWith("/") ? path : `/${path}`}`;
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", url);
    xhr.setRequestHeader("Accept", "application/json");
    xhr.upload.addEventListener("progress", (event) => {
      if (event.lengthComputable && onProgress) {
        onProgress(
          Math.min(100, Math.round((event.loaded / event.total) * 100)),
        );
      }
    });
    xhr.addEventListener("error", () => {
      reject(new ApiError(0, "Could not reach the API server."));
    });
    xhr.addEventListener("load", () => {
      let body: unknown = null;
      try {
        body = JSON.parse(xhr.responseText);
      } catch {
        body = null;
      }
      if (xhr.status < 200 || xhr.status >= 300) {
        reject(
          new ApiError(
            xhr.status,
            detailFromBody(body) ?? (xhr.statusText || "Request failed."),
            xhr.getResponseHeader(REQUEST_ID_HEADER) ?? undefined,
          ),
        );
        return;
      }
      const parsed = schema.safeParse(body);
      if (!parsed.success) {
        reject(
          new ApiError(
            xhr.status,
            "The server returned an unexpected response shape.",
          ),
        );
        return;
      }
      resolve(parsed.data);
    });
    xhr.send(form);
  });
}
