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
    throw new ApiError(response.status, detail, response.headers.get(REQUEST_ID_HEADER) ?? undefined);
  }

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
