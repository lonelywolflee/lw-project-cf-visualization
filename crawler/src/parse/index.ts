/**
 * Dispatcher and barrel for parse/: the ONLY public surface of this
 * directory to the rest of the crawler. {@link parsePage} runs the full
 * pipeline body → detected kind → configured-kind assertion → per-kind
 * parser.
 */
import type { SourcePageKind } from '@cf-viz/catalog';

import type { FetchResult } from '../http-client.js';
import { parseDeveloperDocs } from './developer-docs.js';
import { parseHtml } from './html.js';
import { parseMarketingProduct } from './marketing-product.js';
import { parseMarketingSolution } from './marketing-solution.js';
import { assertExpectedKind, detectPageKind } from './page-kind.js';
import { parseProductsOverview } from './products-overview.js';
import { parseSolutionsOverview } from './solutions-overview.js';
import type { PageMeta, ParsedPage } from './types.js';

/**
 * Parse one fetched page: load the body, detect the structural page kind,
 * assert it satisfies the configured source pageKind, and dispatch to the
 * per-kind parser. Every failure is a CrawlError at stage 'parse' carrying
 * the final URL.
 */
export function parsePage(fetch: FetchResult, configuredKind: SourcePageKind): ParsedPage {
  const page = parseHtml(fetch.bodyText);
  const url = fetch.finalUrl;
  const detected = detectPageKind(page, url);
  assertExpectedKind(detected, configuredKind, url);
  const meta: PageMeta = {
    sourceId: fetch.sourceId,
    url,
    retrievedAt: fetch.retrievedAt,
  };
  switch (detected) {
    case 'products-overview':
      return parseProductsOverview(page, meta);
    case 'solutions-overview':
      return parseSolutionsOverview(page, meta);
    case 'marketing-product':
      return parseMarketingProduct(page, meta);
    case 'marketing-solution':
      return parseMarketingSolution(page, meta);
    case 'developer-docs':
      return parseDeveloperDocs(page, meta);
  }
}

export { assertExpectedKind, detectPageKind } from './page-kind.js';
export { sourcePageKindOf } from './types.js';
export type {
  PageMeta,
  ParsedPage,
  ParsedPageBase,
  ParsedPageKind,
  RawEntityCard,
  RawLink,
  RawTaxonomySection,
} from './types.js';
