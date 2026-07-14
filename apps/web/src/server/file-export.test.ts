import { describe, expect, it } from "vitest";

import { buildCsv, buildM3u, csvEscape } from "./file-export";
import type { ExportItem } from "./file-export";

const items: ExportItem[] = [
  {
    position: 1,
    title: 'Comma, "Quote"',
    artists: ["Artist A", "Artist B"],
    recordingMbid: "11111111-1111-4111-8111-111111111111",
    isrc: "QZTST2600001",
    releaseYear: "2021",
    noveltyState: "probably_new",
    explanation: "Shares the dream pop tag\nwith music you love",
    durationMs: 214000,
  },
  {
    position: 2,
    title: "Plain",
    artists: [],
    recordingMbid: null,
    isrc: null,
    releaseYear: null,
    noveltyState: null,
    explanation: null,
    durationMs: null,
  },
];

describe("CSV export (spec §13.10)", () => {
  it("emits the spec header and properly escaped rows", () => {
    const csv = buildCsv(items);
    const lines = csv.trimEnd().split("\r\n");
    expect(lines[0]).toBe(
      "position,title,artist,recording_mbid,isrc,release_year,novelty_state,explanation",
    );
    expect(lines).toHaveLength(3);
    expect(lines[1]).toContain('"Comma, ""Quote"""');
    expect(lines[1]).toContain("QZTST2600001");
    expect(lines[1]).toContain('"Shares the dream pop tag\nwith music you love"');
    expect(lines[2]).toBe("2,Plain,,,,,,");
  });

  it("escapes only when needed", () => {
    expect(csvEscape("plain")).toBe("plain");
    expect(csvEscape("a,b")).toBe('"a,b"');
    expect(csvEscape('say "hi"')).toBe('"say ""hi"""');
  });
});

describe("M3U export", () => {
  it("emits EXTM3U with EXTINF metadata and service-neutral references", () => {
    const m3u = buildM3u("Late Night\nList", items);
    const lines = m3u.trimEnd().split("\n");
    expect(lines[0]).toBe("#EXTM3U");
    expect(lines[1]).toBe("#PLAYLIST:Late Night List");
    expect(lines[2]).toBe('#EXTINF:214,Artist A, Artist B - Comma, "Quote"');
    expect(lines[3]).toBe("https://musicbrainz.org/recording/11111111-1111-4111-8111-111111111111");
    expect(lines[4]).toBe("#EXTINF:-1,Unknown Artist - Plain");
    expect(m3u).not.toContain("spotify");
  });
});
