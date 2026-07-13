/**
 * Parser for the developers.cloudflare.com docs directory: entry anchor
 * cards inside the pagefind-indexed main (the docs site has no data-cms-path
 * attributes, so scoping to `main[data-pagefind-body]` plus the a > span/p
 * card shape is the durable anchor). Regression-tested against
 * fixtures/developer-docs-directory.html (valid) and
 * fixtures/developer-docs-directory-missing-name.html (broken).
 */
import { CrawlError } from '../errors.js';
import { parseBase, requireBounded, resolveHref } from './base.js';
import { cleanText, type HtmlPage } from './html.js';
import { collapseWhitespace, FIELD_CAPS, trimSummary } from '../text.js';
import type { PageMeta, ParsedPage, RawEntityCard } from './types.js';

/** The developer-docs variant of {@link ParsedPage}. */
type DeveloperDocsPage = Extract<ParsedPage, { kind: 'developer-docs' }>;

const ENTRY_CARD_SELECTOR = 'main[data-pagefind-body] a[href]';

/**
 * Parse the docs directory into entry cards, gating each anchor on its card
 * shape (live evidence, 2026-07-13: main[data-pagefind-body] on /directory/
 * contains 154 anchors — 127 genuine `a > span + p` cards plus 27
 * site-header nav links such as API, Fundamentals, GitHub, and System Status
 * that carry neither a span nor a p):
 * - name span AND description p present → a card (both must be non-blank, as
 *   before);
 * - NEITHER present → navigation chrome, skipped silently;
 * - exactly one present (or present but blank) → a half-shaped card, which is
 *   structure drift and errors at stage 'parse'.
 * At least one card-shaped entry is required; every card requires its href.
 */
export function parseDeveloperDocs(page: HtmlPage, meta: PageMeta): DeveloperDocsPage {
  const base = parseBase(page, meta, 'developer-docs');
  const url = meta.url;
  const cardElements = page(ENTRY_CARD_SELECTOR).toArray();
  const entries: RawEntityCard[] = [];
  for (const cardElement of cardElements) {
    const card = page(cardElement);
    const nameSpan = card.find('span').first();
    const descriptionP = card.find('p').first();
    if (nameSpan.length === 0 && descriptionP.length === 0) {
      // Neither card field exists: site-header nav chrome, not an entry.
      continue;
    }
    const name = requireBounded(
      cleanText(nameSpan),
      FIELD_CAPS.name,
      `span (entry name) inside ${ENTRY_CARD_SELECTOR}`,
      url,
    );
    const description = cleanText(descriptionP);
    if (description.length === 0) {
      throw new CrawlError(
        `[parse ${url}] missing required description p inside ${ENTRY_CARD_SELECTOR}`,
        { stage: 'parse', url },
      );
    }
    const href = card.attr('href');
    if (href === undefined || collapseWhitespace(href).length === 0) {
      throw new CrawlError(`[parse ${url}] missing required ${ENTRY_CARD_SELECTOR}@href`, {
        stage: 'parse',
        url,
      });
    }
    entries.push({
      name,
      summary: trimSummary(description),
      href: resolveHref(href, base.canonicalUrl, ENTRY_CARD_SELECTOR, url),
    });
  }
  if (entries.length === 0) {
    throw new CrawlError(`[parse ${url}] missing required entry cards ${ENTRY_CARD_SELECTOR}`, {
      stage: 'parse',
      url,
    });
  }
  return { ...base, kind: 'developer-docs', entries };
}
