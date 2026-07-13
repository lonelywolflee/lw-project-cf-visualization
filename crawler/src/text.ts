/**
 * Text utilities for the parser layer.
 *
 * Policy:
 * - All extracted text is whitespace-collapsed first; HTML whitespace is not
 *   semantic and this makes output deterministic regardless of source
 *   indentation.
 * - name (<=120) and title (<=200) are official identifiers: overflow means we
 *   extracted the wrong node or the page structure changed, so it is an
 *   explicit error (AGENTS: structure drift is an explicit error, not silent
 *   success). `boundedField` returns undefined so the caller raises its
 *   stage-tagged CrawlError with the source URL.
 * - summary (<=500) is display copy sourced from meta descriptions, which
 *   marketing may lengthen at any time; failing the whole crawl over copy
 *   length would be brittle. It is deterministically trimmed at the last
 *   sentence boundary within the cap, falling back to the last word boundary.
 *   The result is never blank for a non-blank input.
 */

/** Collapse all whitespace runs to single spaces and trim the ends. */
export function collapseWhitespace(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/** Catalog field caps (mirror packages/catalog schema.ts). */
export const FIELD_CAPS = { name: 120, title: 200, summary: 500 } as const;

/**
 * Enforce a hard cap on an identifier-like field. Returns the collapsed text
 * or undefined when blank/over-cap so the caller can raise its stage-tagged
 * error with the source URL (this module stays error-type agnostic).
 */
export function boundedField(raw: string, cap: number): string | undefined {
  const text = collapseWhitespace(raw);
  if (text.length === 0 || text.length > cap) {
    return undefined;
  }
  return text;
}

/**
 * Deterministically trim display copy to `cap` characters:
 * 1. collapse whitespace;
 * 2. if within cap, return as is;
 * 3. otherwise cut at the last sentence end ('. ', '! ', '? ') within the cap
 *    (keeping the terminator);
 * 4. otherwise hard cut at the cap and trim the trailing whitespace.
 * The result is guaranteed non-blank for non-blank input. Blank input is a
 * caller precondition violation (a blank summary is a parse error upstream)
 * and throws.
 */
export function trimSummary(raw: string, cap: number = FIELD_CAPS.summary): string {
  const text = collapseWhitespace(raw);
  if (text.length === 0) {
    throw new Error('trimSummary requires non-blank input; callers must pre-check');
  }
  if (text.length <= cap) {
    return text;
  }
  const window = text.slice(0, cap);
  const sentenceEnd = Math.max(
    window.lastIndexOf('. '),
    window.lastIndexOf('! '),
    window.lastIndexOf('? '),
  );
  if (sentenceEnd > 0) {
    return window.slice(0, sentenceEnd + 1);
  }
  if (window.endsWith('.') || window.endsWith('!') || window.endsWith('?')) {
    return window;
  }
  return window.trimEnd();
}
