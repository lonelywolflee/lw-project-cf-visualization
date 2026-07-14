/**
 * Parser for the /solutions/ overview: benefit tiles anchored on
 * `pages.solutions-page.benefits.N.*` data-cms-paths (title strong = name,
 * sibling description's SSR astro-island text = summary) plus the tile's
 * overlay anchor for the href. Regression-tested against
 * fixtures/marketing-overview-solutions.html (valid) and
 * fixtures/marketing-overview-solutions-missing-title.html (broken).
 */
import { CrawlError } from '../errors.js';
import { parseBase, requireBounded, resolveHref } from './base.js';
import { cleanText, type HtmlPage } from './html.js';
import { collapseWhitespace, FIELD_CAPS, trimSummary } from '../text.js';
import type { PageMeta, ParsedPage, RawEntityCard } from './types.js';

/** The solutions-overview variant of {@link ParsedPage}. */
type SolutionsOverviewPage = Extract<ParsedPage, { kind: 'solutions-overview' }>;

const CARD_TITLE_SELECTOR =
  'p[data-cms-path^="pages.solutions-page.benefits."][data-cms-path$=".title"]';
const CARD_DESCRIPTION_SELECTOR =
  'p[data-cms-path^="pages.solutions-page.benefits."][data-cms-path$=".description"]';
const OVERLAY_ANCHOR_SELECTOR = 'a[aria-label^="See solution about"]';

/**
 * Parse the solutions overview into solution cards. At least one card is
 * required; every card requires its name strong, its SSR'd description text
 * (an empty astro-island is a parse error, never an empty success), and its
 * overlay anchor href.
 */
export function parseSolutionsOverview(page: HtmlPage, meta: PageMeta): SolutionsOverviewPage {
  const base = parseBase(page, meta, 'solutions-overview');
  const url = meta.url;
  const titleElements = page(CARD_TITLE_SELECTOR).toArray();
  if (titleElements.length === 0) {
    throw new CrawlError(`[parse ${url}] missing required solution cards ${CARD_TITLE_SELECTOR}`, {
      stage: 'parse',
      url,
    });
  }
  const solutions: RawEntityCard[] = titleElements.map((titleElement) => {
    const titleParagraph = page(titleElement);
    const name = requireBounded(
      cleanText(titleParagraph.find('strong').first()),
      FIELD_CAPS.name,
      `strong (solution name) inside ${CARD_TITLE_SELECTOR}`,
      url,
    );
    const description = cleanText(titleParagraph.nextAll(CARD_DESCRIPTION_SELECTOR).first());
    if (description.length === 0) {
      throw new CrawlError(
        `[parse ${url}] missing required text for ${CARD_DESCRIPTION_SELECTOR}`,
        { stage: 'parse', url },
      );
    }
    const wrapper = titleParagraph.parents(`:has(> ${OVERLAY_ANCHOR_SELECTOR})`).first();
    const href = wrapper.children(OVERLAY_ANCHOR_SELECTOR).first().attr('href');
    if (href === undefined || collapseWhitespace(href).length === 0) {
      throw new CrawlError(
        `[parse ${url}] missing required ${OVERLAY_ANCHOR_SELECTOR}@href in the card wrapper`,
        { stage: 'parse', url },
      );
    }
    return {
      name,
      summary: trimSummary(description),
      href: resolveHref(href, base.canonicalUrl, OVERLAY_ANCHOR_SELECTOR, url),
    };
  });
  return { ...base, kind: 'solutions-overview', solutions };
}
