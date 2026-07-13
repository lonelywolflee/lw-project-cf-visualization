/**
 * Parser for the /products/ overview: family figures (figcaption = family
 * name) grouping product card anchors (strong = name, following tagline p =
 * summary). Regression-tested against
 * fixtures/marketing-overview-products.html (valid) and
 * fixtures/marketing-overview-products-missing-canonical.html (broken).
 */
import { CrawlError } from '../errors.js';
import { parseBase, requireBounded, resolveHref } from './base.js';
import type { HtmlPage } from './html.js';
import { collapseWhitespace, FIELD_CAPS, trimSummary } from '../text.js';
import type { PageMeta, ParsedPage, RawEntityCard, RawTaxonomySection } from './types.js';

/** The products-overview variant of {@link ParsedPage}. */
type ProductsOverviewPage = Extract<ParsedPage, { kind: 'products-overview' }>;

/** Product card anchors live INSIDE family figures; footer nav has no anchors there. */
const PRODUCT_CARD_SELECTOR = 'a[href^="/products/"]';

/**
 * Parse the products overview into family sections. At least one family and
 * at least one product card per family are required; every family heading,
 * card name, tagline, and href is required.
 */
export function parseProductsOverview(page: HtmlPage, meta: PageMeta): ProductsOverviewPage {
  const base = parseBase(page, meta, 'products-overview');
  const url = meta.url;
  const figureElements = page('figure').toArray();
  if (figureElements.length === 0) {
    throw new CrawlError(`[parse ${url}] missing required figure (product family group)`, {
      stage: 'parse',
      url,
    });
  }
  const families: RawTaxonomySection[] = figureElements.map((figureElement) => {
    const figure = page(figureElement);
    const heading = requireBounded(
      figure.find('figcaption').first().text(),
      FIELD_CAPS.name,
      'text for figcaption (family name)',
      url,
    );
    const cardElements = figure.find(PRODUCT_CARD_SELECTOR).toArray();
    if (cardElements.length === 0) {
      throw new CrawlError(
        `[parse ${url}] missing required ${PRODUCT_CARD_SELECTOR} inside figure`,
        { stage: 'parse', url },
      );
    }
    const items: RawEntityCard[] = cardElements.map((cardElement) => {
      const card = page(cardElement);
      const strong = card.find('strong').first();
      const name = requireBounded(
        strong.text(),
        FIELD_CAPS.name,
        `strong (product name) inside ${PRODUCT_CARD_SELECTOR}`,
        url,
      );
      const tagline = collapseWhitespace(strong.parent().next('p').text());
      if (tagline.length === 0) {
        throw new CrawlError(
          `[parse ${url}] missing required tagline p following the strong parent inside ${PRODUCT_CARD_SELECTOR}`,
          { stage: 'parse', url },
        );
      }
      const href = card.attr('href');
      if (href === undefined || collapseWhitespace(href).length === 0) {
        throw new CrawlError(`[parse ${url}] missing required ${PRODUCT_CARD_SELECTOR}@href`, {
          stage: 'parse',
          url,
        });
      }
      return {
        name,
        summary: trimSummary(tagline),
        href: resolveHref(href, base.canonicalUrl, PRODUCT_CARD_SELECTOR, url),
      };
    });
    return { heading, items };
  });
  return { ...base, kind: 'products-overview', families };
}
