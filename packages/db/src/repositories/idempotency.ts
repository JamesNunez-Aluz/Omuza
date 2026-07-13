import { createHash } from "node:crypto";

import { and, eq } from "drizzle-orm";

import type { Database } from "../client.js";
import { idempotencyKeys } from "../schema.js";

/**
 * Idempotency for retryable mutations (spec §13.2): same key + same body
 * replays the stored response; same key + different body is a conflict.
 */

export function hashRequestBody(body: unknown): string {
  return createHash("sha256").update(JSON.stringify(body ?? null)).digest("hex");
}

export interface StoredIdempotentResponse {
  status: number;
  response: unknown;
  requestHash: string;
}

export async function findIdempotentResponse(
  db: Database,
  key: string,
  userId: string,
  route: string,
): Promise<StoredIdempotentResponse | undefined> {
  const rows = await db
    .select({
      status: idempotencyKeys.status,
      response: idempotencyKeys.response,
      requestHash: idempotencyKeys.requestHash,
    })
    .from(idempotencyKeys)
    .where(
      and(
        eq(idempotencyKeys.key, key),
        eq(idempotencyKeys.userId, userId),
        eq(idempotencyKeys.route, route),
      ),
    )
    .limit(1);
  return rows[0];
}

export async function storeIdempotentResponse(
  db: Database,
  input: {
    key: string;
    userId: string;
    route: string;
    requestHash: string;
    status: number;
    response: unknown;
  },
): Promise<void> {
  await db.insert(idempotencyKeys).values(input).onConflictDoNothing();
}
