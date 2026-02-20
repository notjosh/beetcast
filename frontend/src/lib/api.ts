import type { z } from "zod/v4";

export class ApiError extends Error {
  body: unknown;
  status: number;

  constructor(status: number, body?: unknown) {
    const msg =
      body !== null && typeof body === "object" && "message" in body
        ? String(body.message)
        : `API error: ${status}`;
    super(msg);
    this.status = status;
    this.body = body;
  }
}

export class NotFoundError extends ApiError {
  constructor(body?: unknown) {
    super(404, body);
  }
}

/**
 * Creates a fetcher for `useSWR` that validates responses with a Zod schema.
 *
 *   const { data } = useSWR("/api/foo", zodFetcher(FooSchema));
 */
export function zodFetcher<T>(schema: z.ZodType<T>) {
  return (url: string): Promise<T> => apiRequest(url, schema);
}

/**
 * Creates a mutation fetcher for `useSWRMutation` that validates responses
 * with a Zod schema. Supports optional request bodies via `trigger(body)`.
 *
 *   const { trigger } = useSWRMutation("/api/foo", zodMutator(FooSchema));
 *   await trigger();              // POST with no body
 *   await trigger({ name: "x" }); // POST with JSON body
 */
export function zodMutator<TResponse, TBody = void>(
  schema: z.ZodType<TResponse>,
  method: string = "POST",
) {
  return async (url: string, options?: { arg: TBody }): Promise<TResponse> => {
    const init: RequestInit = { method };
    if (options?.arg !== undefined) {
      init.headers = { "Content-Type": "application/json" };
      init.body = JSON.stringify(options.arg);
    }
    return apiRequest(url, schema, init);
  };
}

/**
 * Core API request with Zod validation. All SWR fetchers/mutators funnel through here.
 */
async function apiRequest<T>(url: string, schema: z.ZodType<T>, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  if (!res.ok) {
    const body: unknown = await res.json().catch(() => null);
    if (res.status === 404) throw new NotFoundError(body);
    throw new ApiError(res.status, body);
  }
  const data: unknown = await res.json();
  return schema.parse(data);
}
