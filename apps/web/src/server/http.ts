import { randomUUID } from "node:crypto";

import type { ZodTypeAny, output } from "zod";

/**
 * API envelope helpers (spec §13.1). Every error response uses the envelope;
 * details are always client-safe — raw provider/internal errors stay in logs.
 */

export interface ApiErrorOptions {
  status: number;
  code: string;
  message: string;
  retryable?: boolean;
  details?: Record<string, unknown>;
  headers?: HeadersInit;
}

export function apiError(options: ApiErrorOptions): Response {
  return Response.json(
    {
      error: {
        code: options.code,
        message: options.message,
        requestId: `req_${randomUUID()}`,
        retryable: options.retryable ?? false,
        details: options.details ?? {},
      },
    },
    { status: options.status, headers: options.headers },
  );
}

export const unauthorized = () =>
  apiError({ status: 401, code: "UNAUTHENTICATED", message: "Sign in to continue." });

export const notFound = () =>
  apiError({ status: 404, code: "NOT_FOUND", message: "The requested resource does not exist." });

export const badOrigin = () =>
  apiError({ status: 403, code: "INVALID_ORIGIN", message: "Cross-origin request rejected." });

export async function parseJsonBody<S extends ZodTypeAny>(
  request: Request,
  schema: S,
): Promise<output<S> | Response> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return apiError({ status: 400, code: "INVALID_JSON", message: "Request body must be valid JSON." });
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    return apiError({
      status: 400,
      code: "VALIDATION_FAILED",
      message: "Request validation failed.",
      details: {
        issues: parsed.error.issues.map((issue) => ({
          path: issue.path.join("."),
          message: issue.message,
        })),
      },
    });
  }
  return parsed.data;
}

/** Type guard: parseJsonBody returned an error response, not a value. */
export function isResponse(value: unknown): value is Response {
  return value instanceof Response;
}
