import { stripMentionMarkdown } from "../utils/strip-mention-markdown";

const HTML_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  "#39": "'",
  "#x27": "'",
  nbsp: " ",
};

/**
 * One-line plain text for a run's trigger snapshot.
 *
 * The snapshot is the comment's raw Markdown cut at ~200 runes (with a
 * trailing "…"), so rendering it verbatim showed `&amp;` for an ampersand the
 * editor escaped, and a comment that opens with a screenshot as
 * `![CleanShot 2026-…` — the cut usually lands inside the image's URL. Images
 * become `imageLabel` (whole or cut), links become their text, mentions their
 * name, entities their character. Decoding is a single pass, so `&amp;lt;`
 * reads `&lt;` exactly as the author typed it.
 */
export function plainTriggerSummary(raw: string, imageLabel: string): string {
  return stripMentionMarkdown(raw)
    .replace(/!\[[^\]]*\]\([^)]*\)/g, imageLabel)
    .replace(/!\[[^\]]*(?:\]\([^)]*)?…?$/, imageLabel)
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]*)\]\([^)]*…$/, "$1…")
    .replace(/&(amp|lt|gt|quot|#39|#x27|nbsp);/g, (_, name: string) => HTML_ENTITIES[name] ?? "")
    .replace(/\s+/g, " ")
    .trim();
}
