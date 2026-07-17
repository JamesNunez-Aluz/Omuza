import { and, eq, gt, isNull, lt } from "drizzle-orm";

import type { Database } from "../client.js";
import {
  encryptedOauthCredentials,
  exportItemResolutions,
  exports,
  oauthTransactions,
  serviceConnections,
} from "../schema.js";

/**
 * Destination connections (Zone C). Credentials are stored only as
 * ciphertext produced by the destination package's TokenCipher; this module
 * never sees plaintext.
 */

export interface EncryptedBlob {
  ciphertext: Buffer;
  nonce: Buffer;
  authTag: Buffer;
  keyVersion: string;
}

export async function createOauthTransaction(
  db: Database,
  input: {
    userId: string;
    service: "spotify";
    stateHash: string;
    encryptedVerifier: EncryptedBlob;
    ttlMinutes?: number;
  },
): Promise<void> {
  await db.insert(oauthTransactions).values({
    userId: input.userId,
    service: input.service,
    stateHash: input.stateHash,
    encryptedCodeVerifier: input.encryptedVerifier.ciphertext,
    verifierNonce: input.encryptedVerifier.nonce,
    verifierAuthTag: input.encryptedVerifier.authTag,
    keyVersion: input.encryptedVerifier.keyVersion,
    expiresAt: new Date(Date.now() + (input.ttlMinutes ?? 10) * 60_000),
  });
}

/** One-time consumption: expired, consumed, or unknown states all fail closed. */
export async function consumeOauthTransaction(
  db: Database,
  stateHash: string,
): Promise<
  | { userId: string; service: string; encryptedVerifier: EncryptedBlob }
  | undefined
> {
  const rows = await db
    .update(oauthTransactions)
    .set({ consumedAt: new Date() })
    .where(
      and(
        eq(oauthTransactions.stateHash, stateHash),
        isNull(oauthTransactions.consumedAt),
        gt(oauthTransactions.expiresAt, new Date()),
      ),
    )
    .returning();
  const row = rows[0];
  if (!row) return undefined;
  return {
    userId: row.userId,
    service: row.service,
    encryptedVerifier: {
      ciphertext: row.encryptedCodeVerifier,
      nonce: row.verifierNonce,
      authTag: row.verifierAuthTag,
      keyVersion: row.keyVersion,
    },
  };
}

export type ServiceConnectionRow = typeof serviceConnections.$inferSelect;

export async function getActiveConnection(
  db: Database,
  userId: string,
  service: "spotify",
): Promise<ServiceConnectionRow | undefined> {
  const rows = await db
    .select()
    .from(serviceConnections)
    .where(
      and(
        eq(serviceConnections.userId, userId),
        eq(serviceConnections.service, service),
        eq(serviceConnections.status, "active"),
      ),
    )
    .limit(1);
  return rows[0];
}

export async function listConnections(db: Database, userId: string): Promise<ServiceConnectionRow[]> {
  return db.select().from(serviceConnections).where(eq(serviceConnections.userId, userId));
}

export async function getOwnConnection(
  db: Database,
  userId: string,
  connectionId: string,
): Promise<ServiceConnectionRow | undefined> {
  const rows = await db
    .select()
    .from(serviceConnections)
    .where(and(eq(serviceConnections.id, connectionId), eq(serviceConnections.userId, userId)))
    .limit(1);
  return rows[0];
}

/** Activate a connection with encrypted credentials, replacing any prior one. */
export async function activateConnection(
  db: Database,
  input: {
    userId: string;
    service: "spotify";
    scopeSet: string[];
    accessToken: EncryptedBlob;
    refreshToken: EncryptedBlob | null;
    accessTokenExpiresAt: Date;
    reauthorizationDueAt: Date;
  },
): Promise<ServiceConnectionRow> {
  return db.transaction(async (tx) => {
    // Revoke any existing active connection first (unique active per service).
    await tx
      .update(serviceConnections)
      .set({ status: "revoked", disconnectedAt: new Date(), updatedAt: new Date() })
      .where(
        and(
          eq(serviceConnections.userId, input.userId),
          eq(serviceConnections.service, input.service),
          eq(serviceConnections.status, "active"),
        ),
      );

    const rows = await tx
      .insert(serviceConnections)
      .values({
        userId: input.userId,
        service: input.service,
        scopeSet: input.scopeSet,
        expiresAt: input.accessTokenExpiresAt,
        reauthorizationDueAt: input.reauthorizationDueAt,
      })
      .returning();
    const connection = rows[0]!;

    await tx.insert(encryptedOauthCredentials).values({
      connectionId: connection.id,
      encryptedAccessToken: input.accessToken.ciphertext,
      accessNonce: input.accessToken.nonce,
      accessAuthTag: input.accessToken.authTag,
      encryptedRefreshToken: input.refreshToken?.ciphertext ?? null,
      refreshNonce: input.refreshToken?.nonce ?? null,
      refreshAuthTag: input.refreshToken?.authTag ?? null,
      keyVersion: input.accessToken.keyVersion,
      accessTokenExpiresAt: input.accessTokenExpiresAt,
    });

    return connection;
  });
}

export interface StoredCredentials {
  accessToken: EncryptedBlob;
  refreshToken: EncryptedBlob | null;
  accessTokenExpiresAt: Date;
}

export async function getCredentials(
  db: Database,
  connectionId: string,
): Promise<StoredCredentials | undefined> {
  const rows = await db
    .select()
    .from(encryptedOauthCredentials)
    .where(eq(encryptedOauthCredentials.connectionId, connectionId))
    .limit(1);
  const row = rows[0];
  if (!row) return undefined;
  return {
    accessToken: {
      ciphertext: row.encryptedAccessToken,
      nonce: row.accessNonce,
      authTag: row.accessAuthTag,
      keyVersion: row.keyVersion,
    },
    refreshToken:
      row.encryptedRefreshToken && row.refreshNonce && row.refreshAuthTag
        ? {
            ciphertext: row.encryptedRefreshToken,
            nonce: row.refreshNonce,
            authTag: row.refreshAuthTag,
            keyVersion: row.keyVersion,
          }
        : null,
    accessTokenExpiresAt: row.accessTokenExpiresAt,
  };
}

export async function updateAccessToken(
  db: Database,
  connectionId: string,
  accessToken: EncryptedBlob,
  refreshToken: EncryptedBlob | null,
  accessTokenExpiresAt: Date,
): Promise<void> {
  await db
    .update(encryptedOauthCredentials)
    .set({
      encryptedAccessToken: accessToken.ciphertext,
      accessNonce: accessToken.nonce,
      accessAuthTag: accessToken.authTag,
      ...(refreshToken
        ? {
            encryptedRefreshToken: refreshToken.ciphertext,
            refreshNonce: refreshToken.nonce,
            refreshAuthTag: refreshToken.authTag,
          }
        : {}),
      keyVersion: accessToken.keyVersion,
      accessTokenExpiresAt,
      rotatedAt: new Date(),
    })
    .where(eq(encryptedOauthCredentials.connectionId, connectionId));
  await db
    .update(serviceConnections)
    .set({ expiresAt: accessTokenExpiresAt, lastUsedAt: new Date(), updatedAt: new Date() })
    .where(eq(serviceConnections.id, connectionId));
}

export async function markConnectionExpired(db: Database, connectionId: string): Promise<void> {
  await db
    .update(serviceConnections)
    .set({ status: "expired", updatedAt: new Date() })
    .where(eq(serviceConnections.id, connectionId));
}

/**
 * Disconnect + purge (spec §12.10): revoke, delete credentials, expire all
 * temporary destination mappings. Service-neutral playlists are untouched.
 */
export async function disconnectAndPurge(
  db: Database,
  userId: string,
  connectionId: string,
): Promise<boolean> {
  const connection = await getOwnConnection(db, userId, connectionId);
  if (!connection) return false;
  await db.transaction(async (tx) => {
    await tx
      .update(serviceConnections)
      .set({ status: "revoked", disconnectedAt: new Date(), updatedAt: new Date() })
      .where(eq(serviceConnections.id, connectionId));
    await tx
      .delete(encryptedOauthCredentials)
      .where(eq(encryptedOauthCredentials.connectionId, connectionId));
    // Expire (rather than orphan) destination mappings for this user's exports.
    const userExports = await tx
      .select({ id: exports.id })
      .from(exports)
      .where(eq(exports.userId, userId));
    for (const row of userExports) {
      await tx
        .update(exportItemResolutions)
        .set({ expiresAt: new Date(), updatedAt: new Date() })
        .where(eq(exportItemResolutions.exportId, row.id));
    }
    // Stop queued export jobs for this connection at the export level.
    await tx
      .update(exports)
      .set({ status: "cancelled", errorCode: "connection_disconnected", updatedAt: new Date() })
      .where(
        and(
          eq(exports.connectionId, connectionId),
          lt(exports.requestedAt, new Date()),
          eq(exports.status, "requested"),
        ),
      );
  });
  return true;
}
