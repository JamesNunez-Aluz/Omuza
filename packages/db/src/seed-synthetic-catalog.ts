import type { Database } from "./client.js";
import { artists, recordingArtists, recordingFeatures, recordings } from "./schema.js";

/**
 * Idempotently load a synthetic catalog snapshot (from @resonance/testkit)
 * into the database — used by demo seeding and integration tests. Data shape
 * is structural so this package stays independent of the testkit.
 */
export interface SyntheticCatalogInput {
  artists: { id: string; name: string }[];
  recordings: {
    id: string;
    title: string;
    primaryArtistId: string;
    isExplicit: boolean | null;
    languageCode: string | null;
    firstReleaseDate: string | null;
    licensePolicyId: string;
    provenanceProvider: string;
    features: {
      feature: string;
      value: number;
      licensePolicyId: string;
      provenanceProvider: string;
      recommendationEligible: boolean;
    }[];
  }[];
}

export async function seedSyntheticCatalog(db: Database, input: SyntheticCatalogInput): Promise<void> {
  for (const artist of input.artists) {
    await db
      .insert(artists)
      .values({
        id: artist.id,
        name: artist.name,
        provenanceProvider: "synthetic",
        licensePolicyId: "synthetic-fixtures@1",
      })
      .onConflictDoNothing({ target: artists.id });
  }

  for (const recording of input.recordings) {
    await db
      .insert(recordings)
      .values({
        id: recording.id,
        title: recording.title,
        primaryArtistId: recording.primaryArtistId,
        isExplicit: recording.isExplicit,
        languageCode: recording.languageCode,
        firstReleaseDate: recording.firstReleaseDate,
        provenanceProvider: recording.provenanceProvider,
        licensePolicyId: recording.licensePolicyId,
      })
      .onConflictDoNothing({ target: recordings.id });

    await db
      .insert(recordingArtists)
      .values({
        recordingId: recording.id,
        artistId: recording.primaryArtistId,
        creditName: input.artists.find((artist) => artist.id === recording.primaryArtistId)?.name ?? "Unknown",
        position: 0,
      })
      .onConflictDoNothing();

    for (const feature of recording.features) {
      await db
        .insert(recordingFeatures)
        .values({
          recordingId: recording.id,
          feature: feature.feature,
          value: feature.value,
          provenanceProvider: feature.provenanceProvider,
          provenanceDataset: "fixtures",
          licensePolicyId: feature.licensePolicyId,
          recommendationEligible: feature.recommendationEligible,
        })
        .onConflictDoNothing();
    }
  }
}
