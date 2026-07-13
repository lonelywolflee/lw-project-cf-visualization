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
import type { HtmlPage } from './html.js';
import { collapseWhitespace, FIELD_CAPS, trimSummary } from '../text.js';
import type { PageMeta, ParsedPage, RawEntityCard } from './types.js';

/** The developer-docs variant of {@link ParsedPage}. */
type DeveloperDocsPage = Extract<ParsedPage, { kind: 'developer-docs' }>;

const ENTRY_CARD_SELECTOR = 'main[data-pagefind-body] a[href]';

/**
 * Parse the docs directory into entry cards. At least one entry is required;
 * every entry requires its name span, its description p, and its href.
 */
export function parseDeveloperDocs(page: HtmlPage, meta: PageMeta): DeveloperDocsPage {
  const base = parseBase(page, meta, 'developer-docs');
  const url = meta.url;
  const cardElements = page(ENTRY_CARD_SELECTOR).toArray();
  if (cardElements.length === 0) {
    throw new CrawlError(`[parse ${url}] missing required entry cards ${ENTRY_CARD_SELECTOR}`, {
      stage: 'parse',
      url,
    });
  }
  const entries: RawEntityCard[] = cardElements.map((cardElement) => {
    const card = page(cardElement);
    const name = requireBounded(
      card.find('span').first().text(),
      FIELD_CAPS.name,
      `span (entry name) inside ${ENTRY_CARD_SELECTOR}`,
      url,
    );
    const description = collapseWhitespace(card.find('p').first().text());
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
    return {
      name,
      summary: trimSummary(description),
      href: resolveHref(href, base.canonicalUrl, ENTRY_CARD_SELECTOR, url),
    };
  });
  return { ...base, kind: 'developer-docs', entries };
}
