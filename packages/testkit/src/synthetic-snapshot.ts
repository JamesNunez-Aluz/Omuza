/**
 * Deterministic synthetic catalog snapshot for engine golden tests, offline
 * evaluation, and demo seeding. Entirely invented content — no real artists,
 * recordings, or provider data. Structurally compatible with the recommender
 * engine's CatalogSnapshot without importing it (dependency direction).
 */

export interface SyntheticFeature {
  feature: string;
  value: number;
  licensePolicyId: string;
  provenanceProvider: string;
  recommendationEligible: boolean;
}

export interface SyntheticRecording {
  id: string;
  title: string;
  primaryArtistId: string;
  primaryArtistName: string;
  isExplicit: boolean | null;
  languageCode: string | null;
  firstReleaseDate: string | null;
  licensePolicyId: string;
  provenanceProvider: string;
  features: SyntheticFeature[];
}

export interface SyntheticArtist {
  id: string;
  name: string;
}

export interface SyntheticSnapshot {
  artists: SyntheticArtist[];
  recordings: SyntheticRecording[];
}

const TAGS = ["dream_pop", "post_rock", "jazz_fusion", "techno", "folk"] as const;
const POLICY = "synthetic-fixtures@1";

export function artistUuid(index: number): string {
  return `000000aa-0000-4000-8000-${String(index).padStart(12, "0")}`;
}

export function recordingUuid(artistIndex: number, track: number): string {
  return `000000bb-0000-4000-8000-${String(artistIndex * 100 + track).padStart(12, "0")}`;
}

/**
 * 20 artists × 3 recordings = 60 recordings.
 * Special cases baked in (spec §18.2 golden fixture shapes):
 *  - artist 18's recordings have language "xx" (language blocklist case);
 *  - artist 19's recordings have NO features (sparse metadata case);
 *  - recording (0, 2) is explicit; recording (1, 2) has unknown explicitness.
 */
export function buildSyntheticSnapshot(): SyntheticSnapshot {
  const artists: SyntheticArtist[] = [];
  const recordings: SyntheticRecording[] = [];

  for (let artistIndex = 0; artistIndex < 20; artistIndex += 1) {
    const artist = {
      id: artistUuid(artistIndex),
      name: `Synthetic Artist ${String(artistIndex).padStart(2, "0")}`,
    };
    artists.push(artist);
    const tag = TAGS[artistIndex % TAGS.length]!;

    for (let track = 0; track < 3; track += 1) {
      const sparse = artistIndex === 19;
      const features: SyntheticFeature[] = sparse
        ? []
        : [
            {
              feature: `tag:${tag}`,
              value: 1,
              licensePolicyId: POLICY,
              provenanceProvider: "synthetic",
              recommendationEligible: true,
            },
            {
              feature: "energy_estimate",
              value: Math.round(((artistIndex * 7 + track * 13) % 100)) / 100,
              licensePolicyId: POLICY,
              provenanceProvider: "synthetic",
              recommendationEligible: true,
            },
            {
              feature: "tempo_bucket",
              value: Math.round(((artistIndex * 11 + track * 17) % 100)) / 100,
              licensePolicyId: POLICY,
              provenanceProvider: "synthetic",
              recommendationEligible: true,
            },
          ];

      recordings.push({
        id: recordingUuid(artistIndex, track),
        title: `Synthetic ${tag.replaceAll("_", " ")} ${artistIndex}-${track}`,
        primaryArtistId: artist.id,
        primaryArtistName: artist.name,
        isExplicit: artistIndex === 0 && track === 2 ? true : artistIndex === 1 && track === 2 ? null : false,
        languageCode: artistIndex === 18 ? "xx" : "en",
        firstReleaseDate: `20${String(10 + (artistIndex % 15)).padStart(2, "0")}-01-01`,
        licensePolicyId: POLICY,
        provenanceProvider: "synthetic",
        features,
      });
    }
  }

  return { artists, recordings };
}
