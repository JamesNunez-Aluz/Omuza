import { and, eq, isNull } from "drizzle-orm";

import type { Database } from "../client.js";
import { contextProfiles } from "../schema.js";

export type ContextProfileRow = typeof contextProfiles.$inferSelect;

export interface ContextProfileInput {
  name: string;
  systemKey?: string | null;
  discoveryLevel?: number;
  explicitContentPolicy?: string;
  familiarityPreference?: string;
  popularityPreference?: string;
  vocalPreference?: string;
  languageAllowlist?: string[];
  languageBlocklist?: string[];
  eraStartYear?: number | null;
  eraEndYear?: number | null;
  structuredIntent?: unknown;
}

export async function createContextProfile(
  db: Database,
  userId: string,
  input: ContextProfileInput,
): Promise<ContextProfileRow> {
  const rows = await db
    .insert(contextProfiles)
    .values({ userId, name: input.name, ...normalize(input) })
    .returning();
  return rows[0]!;
}

export async function listContextProfiles(db: Database, userId: string): Promise<ContextProfileRow[]> {
  return db
    .select()
    .from(contextProfiles)
    .where(and(eq(contextProfiles.userId, userId), isNull(contextProfiles.deletedAt)))
    .orderBy(contextProfiles.createdAt);
}

export async function getContextProfile(
  db: Database,
  userId: string,
  contextId: string,
): Promise<ContextProfileRow | undefined> {
  const rows = await db
    .select()
    .from(contextProfiles)
    .where(
      and(
        eq(contextProfiles.id, contextId),
        eq(contextProfiles.userId, userId),
        isNull(contextProfiles.deletedAt),
      ),
    )
    .limit(1);
  return rows[0];
}

export async function updateContextProfile(
  db: Database,
  userId: string,
  contextId: string,
  input: Partial<ContextProfileInput>,
): Promise<ContextProfileRow | undefined> {
  const rows = await db
    .update(contextProfiles)
    .set({ ...normalize(input), updatedAt: new Date() })
    .where(
      and(
        eq(contextProfiles.id, contextId),
        eq(contextProfiles.userId, userId),
        isNull(contextProfiles.deletedAt),
      ),
    )
    .returning();
  return rows[0];
}

export async function softDeleteContextProfile(
  db: Database,
  userId: string,
  contextId: string,
): Promise<boolean> {
  const rows = await db
    .update(contextProfiles)
    .set({ deletedAt: new Date() })
    .where(
      and(
        eq(contextProfiles.id, contextId),
        eq(contextProfiles.userId, userId),
        isNull(contextProfiles.deletedAt),
      ),
    )
    .returning({ id: contextProfiles.id });
  return rows.length > 0;
}

type ContextPatch = Partial<{
  name: string;
  systemKey: string | null;
  discoveryLevel: number;
  explicitContentPolicy: string;
  familiarityPreference: string;
  popularityPreference: string;
  vocalPreference: string;
  languageAllowlist: string[];
  languageBlocklist: string[];
  eraStartYear: number | null;
  eraEndYear: number | null;
  structuredIntent: unknown;
}>;

function normalize(input: Partial<ContextProfileInput>): ContextPatch {
  const out: ContextPatch = {};
  if (input.name !== undefined) out.name = input.name;
  if (input.systemKey !== undefined) out.systemKey = input.systemKey;
  if (input.discoveryLevel !== undefined) out.discoveryLevel = input.discoveryLevel;
  if (input.explicitContentPolicy !== undefined) out.explicitContentPolicy = input.explicitContentPolicy;
  if (input.familiarityPreference !== undefined) out.familiarityPreference = input.familiarityPreference;
  if (input.popularityPreference !== undefined) out.popularityPreference = input.popularityPreference;
  if (input.vocalPreference !== undefined) out.vocalPreference = input.vocalPreference;
  if (input.languageAllowlist !== undefined) out.languageAllowlist = input.languageAllowlist;
  if (input.languageBlocklist !== undefined) out.languageBlocklist = input.languageBlocklist;
  if (input.eraStartYear !== undefined) out.eraStartYear = input.eraStartYear;
  if (input.eraEndYear !== undefined) out.eraEndYear = input.eraEndYear;
  if (input.structuredIntent !== undefined) out.structuredIntent = input.structuredIntent;
  return out;
}
