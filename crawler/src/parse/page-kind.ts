/**
 * Structural page-kind detection, separate from extraction: each approved
 * page shape has one fingerprint grounded in the live-page recon. An
 * unrecognized or ambiguous structure, or a detected kind that contradicts
 * the configured source pageKind, is explicit structure drift and errors at
 * stage 'parse' (never an empty success).
 */
import type { SourcePageKind } from '@cf-viz/catalog';

import { CrawlError } from '../errors.js';
import type { HtmlPage } from './html.js';
import { sourcePageKindOf, type ParsedPageKind } from './types.js';

/** One structural fingerprint: a kind plus its presence predicate. */
interface Fingerprint {
  readonly kind: ParsedPageKind;
  readonly matches: (page: HtmlPage) => boolean;
}

/**
 * Fingerprints per approved shape (selectors from recon; durable anchors are
 * data-cms-path attributes and structural shapes, never utility classes):
 * - products-overview: family figures with figcaptions containing product
 *   card anchors;
 * - solutions-overview: benefit tile title paragraphs;
 * - marketing-product: a `products.<slug>.sections.hero.title` element (the
 *   tag varies per page — cdn uses h2, workers h1 — so only the path matters);
 * - marketing-solution: a `pages.<slug>.hero.eyebrow` element (generalized
 *   from the recon'd `pages.sase.hero.eyebrow`);
 * - developer-docs: a pagefind-indexed main with at least one entry anchor.
 */
const FINGERPRINTS: readonly Fingerprint[] = [
  {
    kind: 'products-overview',
    matches: (page) =>
      page('figure:has(figcaption)').length > 0 && page('figure a[href^="/products/"]').length > 0,
  },
  {
    kind: 'solutions-overview',
    matches: (page) =>
      page('p[data-cms-path^="pages.solutions-page.benefits."][data-cms-path$=".title"]').length >
      0,
  },
  {
    kind: 'marketing-product',
    matches: (page) =>
      page('[data-cms-path^="products."][data-cms-path$=".sections.hero.title"]').length > 0,
  },
  {
    kind: 'marketing-solution',
    matches: (page) => page('[data-cms-path^="pages."][data-cms-path$=".hero.eyebrow"]').length > 0,
  },
  {
    kind: 'developer-docs',
    matches: (page) => page('main[data-pagefind-body] a[href]').length > 0,
  },
];

/**
 * Detect the page's kind by structural fingerprint. Exactly one fingerprint
 * must match; zero matches (unrecognized structure) and two-plus matches
 * (ambiguity — defensive, no approved page triggers it) both throw a
 * CrawlError at stage 'parse' with the source URL.
 */
export function detectPageKind(page: HtmlPage, url: string): ParsedPageKind {
  const matched = FINGERPRINTS.filter((fingerprint) => fingerprint.matches(page)).map(
    (fingerprint) => fingerprint.kind,
  );
  if (matched.length > 1) {
    throw new CrawlError(`[parse ${url}] ambiguous page structure: matches ${matched.join(', ')}`, {
      stage: 'parse',
      url,
    });
  }
  const detected = matched[0];
  if (detected === undefined) {
    throw new CrawlError(`[parse ${url}] unrecognized page structure`, { stage: 'parse', url });
  }
  return detected;
}

/**
 * Assert the detected kind satisfies the configured source pageKind (via
 * {@link sourcePageKindOf}); a mismatch means the seed URL no longer serves
 * the approved shape and throws a CrawlError at stage 'parse'.
 */
export function assertExpectedKind(
  detected: ParsedPageKind,
  configured: SourcePageKind,
  url: string,
): void {
  if (sourcePageKindOf(detected) !== configured) {
    throw new CrawlError(
      `[parse ${url}] detected page kind '${detected}' does not satisfy configured page kind '${configured}'`,
      { stage: 'parse', url },
    );
  }
}
