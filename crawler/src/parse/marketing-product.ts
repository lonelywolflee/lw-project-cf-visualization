/**
 * Parser for dedicated product pages (e.g. /products/cdn/): base metadata
 * plus the explicit use-case section anchored on
 * `products.<slug>.sections.useCases.items.N.*` data-cms-paths. A product
 * page without a use-case section is valid (empty useCases); a present item
 * missing its title or description is structure drift and errors.
 * Regression-tested against fixtures/marketing-product-cdn.html (valid) and
 * fixtures/marketing-product-cdn-usecase-missing-title.html (broken).
 */
import { extractUseCaseCards, parseBase } from './base.js';
import type { HtmlPage } from './html.js';
import type { PageMeta, ParsedPage } from './types.js';

/** The marketing-product variant of {@link ParsedPage}. */
type MarketingProductPage = Extract<ParsedPage, { kind: 'marketing-product' }>;

const USE_CASE_ITEMS_SELECTOR =
  '[data-cms-path^="products."][data-cms-path*=".sections.useCases.items."]';

/** Parse a dedicated product page into base metadata plus use-case cards. */
export function parseMarketingProduct(page: HtmlPage, meta: PageMeta): MarketingProductPage {
  const base = parseBase(page, meta, 'marketing-product');
  const useCases = extractUseCaseCards(page, USE_CASE_ITEMS_SELECTOR, meta.url);
  return { ...base, kind: 'marketing-product', useCases };
}
