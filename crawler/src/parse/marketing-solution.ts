/**
 * Parser for dedicated solution pages (e.g. /sase/): the official solution
 * name from the hero eyebrow plus the explicit use-case section anchored on
 * `pages.<slug>.useCases.items.N.*` data-cms-paths (same pairing rule as
 * product pages; item CTA hrefs are provenance detail and ignored).
 * Regression-tested against fixtures/marketing-solution-sase.html (valid)
 * and fixtures/marketing-solution-sase-missing-eyebrow.html (broken).
 */
import { extractUseCaseCards, parseBase, requireBounded } from './base.js';
import { requireText, type HtmlPage } from './html.js';
import { FIELD_CAPS } from '../text.js';
import type { PageMeta, ParsedPage } from './types.js';

/** The marketing-solution variant of {@link ParsedPage}. */
type MarketingSolutionPage = Extract<ParsedPage, { kind: 'marketing-solution' }>;

const EYEBROW_SELECTOR = '[data-cms-path^="pages."][data-cms-path$=".hero.eyebrow"]';
const USE_CASE_ITEMS_SELECTOR = '[data-cms-path^="pages."][data-cms-path*=".useCases.items."]';

/**
 * Parse a dedicated solution page: solutionName from the required hero
 * eyebrow, use-case cards under the section-presence rule (absent section is
 * valid, incomplete items error).
 */
export function parseMarketingSolution(page: HtmlPage, meta: PageMeta): MarketingSolutionPage {
  const base = parseBase(page, meta, 'marketing-solution');
  const solutionName = requireBounded(
    requireText(page, EYEBROW_SELECTOR, meta.url),
    FIELD_CAPS.name,
    `text for ${EYEBROW_SELECTOR}`,
    meta.url,
  );
  const useCases = extractUseCaseCards(page, USE_CASE_ITEMS_SELECTOR, meta.url);
  return { ...base, kind: 'marketing-solution', solutionName, useCases };
}
