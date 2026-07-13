import { desc, eq } from "drizzle-orm";

import type { Database } from "../client.js";
import { consentRecords } from "../schema.js";

export interface ConsentRecordRow {
  id: string;
  purpose: string;
  policyVersion: string;
  status: string;
  occurredAt: Date;
  source: string;
}

/** Append-only by construction; the DB trigger rejects UPDATE/DELETE. */
export async function appendConsentRecord(
  db: Database,
  input: {
    userId: string;
    purpose: string;
    policyVersion: string;
    status: "granted" | "withdrawn";
    source?: string;
  },
): Promise<ConsentRecordRow> {
  const rows = await db
    .insert(consentRecords)
    .values(input)
    .returning({
      id: consentRecords.id,
      purpose: consentRecords.purpose,
      policyVersion: consentRecords.policyVersion,
      status: consentRecords.status,
      occurredAt: consentRecords.occurredAt,
      source: consentRecords.source,
    });
  return rows[0]!;
}

export async function listConsentRecords(db: Database, userId: string): Promise<ConsentRecordRow[]> {
  return db
    .select({
      id: consentRecords.id,
      purpose: consentRecords.purpose,
      policyVersion: consentRecords.policyVersion,
      status: consentRecords.status,
      occurredAt: consentRecords.occurredAt,
      source: consentRecords.source,
    })
    .from(consentRecords)
    .where(eq(consentRecords.userId, userId))
    .orderBy(desc(consentRecords.occurredAt));
}
