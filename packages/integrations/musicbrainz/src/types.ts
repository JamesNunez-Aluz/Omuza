import { z } from "zod";

/**
 * MusicBrainz WS/2 JSON response schemas (core data only — spec §11.2).
 * Supplementary datasets (tags, ratings, genres) are deliberately absent:
 * they carry a noncommercial license (`musicbrainz-supplementary@1`) and are
 * never requested. Validation happens before any field is used (spec §16.5).
 */

export const mbArtistSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1),
  "sort-name": z.string().optional(),
  disambiguation: z.string().optional(),
  country: z.string().optional(),
  "life-span": z
    .object({ begin: z.string().nullable().optional(), end: z.string().nullable().optional() })
    .optional(),
});

export const mbArtistSearchResponseSchema = z.object({
  count: z.number().int().nonnegative(),
  artists: z.array(mbArtistSchema),
});

export const mbArtistCreditSchema = z.object({
  name: z.string().min(1),
  joinphrase: z.string().optional(),
  artist: mbArtistSchema.pick({ id: true, name: true, "sort-name": true, disambiguation: true }),
});

export const mbRecordingSchema = z.object({
  id: z.string().uuid(),
  title: z.string().min(1),
  length: z.number().int().positive().optional(),
  disambiguation: z.string().optional(),
  "first-release-date": z.string().optional(),
  "artist-credit": z.array(mbArtistCreditSchema).min(1),
});

export const mbRecordingSearchResponseSchema = z.object({
  count: z.number().int().nonnegative(),
  recordings: z.array(mbRecordingSchema),
});

/** Normalized, provider-shaped-free DTOs the rest of the app consumes. */

export interface MusicBrainzArtist {
  mbid: string;
  name: string;
  sortName?: string;
  disambiguation?: string;
  countryCode?: string;
  beginDate?: string;
  endDate?: string;
}

export interface MusicBrainzRecordingCredit {
  artistMbid: string;
  artistName: string;
  creditName: string;
  joinPhrase?: string;
}

export interface MusicBrainzRecording {
  mbid: string;
  title: string;
  durationMs?: number;
  disambiguation?: string;
  firstReleaseDate?: string;
  credits: MusicBrainzRecordingCredit[];
}
