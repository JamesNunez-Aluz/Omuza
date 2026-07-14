/**
 * Service-neutral playlist file exports (spec §13.10). Pure builders so the
 * formats are unit-testable. CSV columns per spec; no personal preference
 * values are ever included.
 */

export interface ExportItem {
  position: number;
  title: string;
  artists: string[];
  recordingMbid: string | null;
  isrc: string | null;
  releaseYear: string | null;
  noveltyState: string | null;
  explanation: string | null;
  durationMs: number | null;
}

const CSV_HEADER = "position,title,artist,recording_mbid,isrc,release_year,novelty_state,explanation";

export function buildCsv(items: ExportItem[]): string {
  const lines = [CSV_HEADER];
  for (const item of items) {
    lines.push(
      [
        String(item.position),
        csvEscape(item.title),
        csvEscape(item.artists.join("; ")),
        csvEscape(item.recordingMbid ?? ""),
        csvEscape(item.isrc ?? ""),
        csvEscape(item.releaseYear ?? ""),
        csvEscape(item.noveltyState ?? ""),
        csvEscape(item.explanation ?? ""),
      ].join(","),
    );
  }
  return `${lines.join("\r\n")}\r\n`;
}

export function csvEscape(value: string): string {
  if (/[",\r\n]/.test(value)) {
    return `"${value.replaceAll('"', '""')}"`;
  }
  return value;
}

/**
 * M3U8 with EXTINF metadata. There is no service-neutral streamable URL for
 * canonical recordings, so entries carry the MusicBrainz permalink where
 * available (an approved, service-neutral reference) — players treat
 * unreachable entries as informational.
 */
export function buildM3u(playlistName: string, items: ExportItem[]): string {
  const lines = ["#EXTM3U", `#PLAYLIST:${sanitizeM3uText(playlistName)}`];
  for (const item of items) {
    const seconds = item.durationMs ? Math.round(item.durationMs / 1000) : -1;
    const artist = sanitizeM3uText(item.artists.join(", ") || "Unknown Artist");
    const title = sanitizeM3uText(item.title);
    lines.push(`#EXTINF:${seconds},${artist} - ${title}`);
    lines.push(
      item.recordingMbid
        ? `https://musicbrainz.org/recording/${item.recordingMbid}`
        : `resonance:recording:${item.position}`,
    );
  }
  return `${lines.join("\n")}\n`;
}

function sanitizeM3uText(value: string): string {
  return value.replaceAll(/[\r\n]/g, " ").trim();
}
