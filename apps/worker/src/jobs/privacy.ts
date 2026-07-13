import {
  buildUserExport,
  markPrivacyRequest,
  performAccountDeletion,
  revokeAllSessions,
} from "@resonance/db";
import type { Database } from "@resonance/db";
import type { Logger } from "@resonance/observability";

/** Assemble a first-party data export and attach it to the request row. */
export async function processExportRequest(
  db: Database,
  logger: Logger,
  input: { userId: string; requestId: string },
): Promise<void> {
  await markPrivacyRequest(db, input.requestId, { status: "processing" });
  try {
    const payload = await buildUserExport(db, input.userId);
    await markPrivacyRequest(db, input.requestId, { status: "completed", payload });
    logger.info({ requestId: input.requestId }, "privacy export completed");
  } catch (error) {
    await markPrivacyRequest(db, input.requestId, {
      status: "failed",
      failureReason: "export_failed",
    });
    logger.error({ requestId: input.requestId, err: String(error) }, "privacy export failed");
    throw error;
  }
}

/** Delete personal data and anonymize the account; sessions die first. */
export async function processDeleteRequest(
  db: Database,
  logger: Logger,
  input: { userId: string; requestId: string },
): Promise<void> {
  await markPrivacyRequest(db, input.requestId, { status: "processing" });
  try {
    await revokeAllSessions(db, input.userId);
    await performAccountDeletion(db, input.userId);
    await markPrivacyRequest(db, input.requestId, { status: "completed" });
    logger.info({ requestId: input.requestId }, "account deletion completed");
  } catch (error) {
    await markPrivacyRequest(db, input.requestId, {
      status: "failed",
      failureReason: "deletion_failed",
    });
    logger.error({ requestId: input.requestId, err: String(error) }, "account deletion failed");
    throw error;
  }
}
