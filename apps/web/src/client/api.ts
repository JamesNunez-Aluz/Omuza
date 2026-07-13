"use client";

/** Minimal client for /api/v1: JSON in/out, error-envelope aware. */

export interface ApiErrorShape {
  code: string;
  message: string;
  retryable: boolean;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export async function api<T>(
  path: string,
  init: { method?: string; body?: unknown; idempotencyKey?: string } = {},
): Promise<T> {
  const headers: Record<string, string> = {};
  if (init.body !== undefined) headers["content-type"] = "application/json";
  if (init.idempotencyKey) headers["idempotency-key"] = init.idempotencyKey;

  const response = await fetch(path, {
    method: init.method ?? (init.body !== undefined ? "POST" : "GET"),
    headers,
    body: init.body !== undefined ? JSON.stringify(init.body) : null,
  });

  if (!response.ok) {
    let shape: ApiErrorShape = {
      code: "UNKNOWN",
      message: "Something went wrong. Please try again.",
      retryable: response.status >= 500,
    };
    try {
      const parsed = (await response.json()) as { error?: ApiErrorShape };
      if (parsed.error) shape = parsed.error;
    } catch {
      // keep the generic shape
    }
    throw new ApiError(response.status, shape.code, shape.message, shape.retryable);
  }
  return (await response.json()) as T;
}
