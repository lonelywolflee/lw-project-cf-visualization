/**
 * Parser for the /products/ overview: family figures (figcaption = family
 * name) grouping product card anchors (strong = name, following tagline p =
 * tagline). Regression-tested against
 * fixtures/marketing-overview-products.html (valid) and
 * fixtures/marketing-overview-products-missing-canonical.html (broken).
 */
import { CrawlError } from '../errors.js';
import { parseBase, requireBounded, resolveHref } from './base.js';
import { cleanText, type HtmlPage } from './html.js';
import { collapseWhitespace, FIELD_CAPS, trimSummary } from '../text.js';
import type { PageMeta, ParsedPage, ProductCard, ProductTaxonomySection } from './types.js';

/** The products-overview variant of {@link ParsedPage}. */
type ProductsOverviewPage = Extract<ParsedPage, { kind: 'products-overview' }>;

/** Product card anchors live INSIDE family figures; footer nav has no anchors there. */
const PRODUCT_CARD_SELECTOR = 'a[href^="/products/"]';

/**
 * Parse the products overview into family sections. At least one family and
 * at least one product card per family are required; every family heading,
 * card name, and href is required.
 *
 * The tagline is deliberately asymmetric: the live overview ships a genuine
 * product card with a strong name but an EMPTY tagline paragraph (observed
 * 2026-07-13 on the 'DDoS for Web' card, /products/ddos-for-web/), so an
 * absent or blank tagline yields `tagline: null` — while a missing or blank
 * strong name is still structure drift and errors.
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
  const families: ProductTaxonomySection[] = figureElements.map((figureElement) => {
    const figure = page(figureElement);
    const heading = requireBounded(
      cleanText(figure.find('figcaption').first()),
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
    const items: ProductCard[] = cardElements.map((cardElement) => {
      const card = page(cardElement);
      const strong = card.find('strong').first();
      const name = requireBounded(
        cleanText(strong),
        FIELD_CAPS.name,
        `strong (product name) inside ${PRODUCT_CARD_SELECTOR}`,
        url,
      );
      // Absent or blank tagline p → null, never an error: see the TSDoc
      // asymmetry note above (live evidence: ddos-for-web).
      const tagline = cleanText(strong.parent().next('p'));
      const href = card.attr('href');
      if (href === undefined || collapseWhitespace(href).length === 0) {
        throw new CrawlError(`[parse ${url}] missing required ${PRODUCT_CARD_SELECTOR}@href`, {
          stage: 'parse',
          url,
        });
      }
      return {
        name,
        tagline: tagline.length === 0 ? null : trimSummary(tagline),
        href: resolveHref(href, base.canonicalUrl, PRODUCT_CARD_SELECTOR, url),
      };
    });
    return { heading, items };
  });
  return { ...base, kind: 'products-overview', families };
}
