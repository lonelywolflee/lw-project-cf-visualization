/**
 * Shared extraction helpers for the per-kind parsers: the common
 * {@link ParsedPageBase} fields, href resolution, bounded required text, and
 * the data-cms-path use-case card pairing used by both dedicated-page kinds.
 *
 * Every failure is a CrawlError at stage 'parse' carrying the source URL and
 * the missing selector's name — never page content.
 */
import { CrawlError } from '../errors.js';
import { pathKeyOf } from '../ids.js';
import { requireAttr, requireText, type HtmlPage } from './html.js';
import { boundedField, collapseWhitespace, FIELD_CAPS, trimSummary } from './text.js';
import type { PageMeta, ParsedPageBase, ParsedPageKind, RawEntityCard } from './types.js';

/**
 * Extract the fields every parsed page shares:
 * - canonicalUrl: required `link[rel="canonical"]@href`, resolved absolute; it
 *   must identify the fetched page (host + path, trailing-slash insensitive)
 *   or the seed has drifted and parsing errors out;
 * - title: required `<title>` text, bounded to 200 chars;
 * - description: required `meta[name="description"]@content`, trimmed to 500.
 */
export function parseBase(page: HtmlPage, meta: PageMeta, kind: ParsedPageKind): ParsedPageBase {
  const url = meta.url;
  const canonicalRaw = requireAttr(page, 'link[rel="canonical"]', 'href', url);
  const canonicalUrl = resolveHref(canonicalRaw, url, 'link[rel="canonical"]', url);
  if (comparableUrlKey(canonicalUrl) !== comparableUrlKey(url)) {
    throw new CrawlError(
      `[parse ${url}] link[rel="canonical"] resolves to a different page than the fetched URL on a ${kind} page`,
      { stage: 'parse', url },
    );
  }
  const title = requireBounded(requireText(page, 'title', url), FIELD_CAPS.title, '<title>', url);
  const description = trimSummary(requireAttr(page, 'meta[name="description"]', 'content', url));
  return {
    sourceId: meta.sourceId,
    canonicalUrl,
    title,
    description,
    retrievedAt: meta.retrievedAt,
  };
}

/**
 * Resolve an extracted href absolute against `baseUrl`; an unresolvable value
 * is a parse-stage error naming the owning selector.
 */
export function resolveHref(href: string, baseUrl: string, selector: string, url: string): string {
  try {
    return new URL(href, baseUrl).toString();
  } catch {
    throw new CrawlError(`[parse ${url}] unresolvable href on ${selector}`, {
      stage: 'parse',
      url,
    });
  }
}

/**
 * Collapse `raw` and require it non-blank and within `cap` characters;
 * violation throws a parse-stage error naming `what` (a selector description,
 * never page content).
 */
export function requireBounded(raw: string, cap: number, what: string, url: string): string {
  const value = boundedField(raw, cap);
  if (value === undefined) {
    throw new CrawlError(
      `[parse ${url}] missing required ${what} (non-blank, <= ${String(cap)} chars)`,
      { stage: 'parse', url },
    );
  }
  return value;
}

/** Slots collected for one `…items.N` data-cms-path prefix. */
interface UseCaseSlots {
  titleText?: string;
  descriptionText?: string;
}

/**
 * Extract explicit use-case cards from data-cms-path annotated title and
 * description elements, paired by their shared `…items.N` path prefix
 * (indices pair fields within one page only — they never become ids).
 *
 * Zero matching elements means the section is absent, which is valid (empty
 * result). A present item missing its title or its description is structure
 * drift and errors naming the missing `data-cms-path`. Suffixes other than
 * `title`/`description` (e.g. `href` CTAs) are ignored. Cards carry no hrefs.
 */
export function extractUseCaseCards(
  page: HtmlPage,
  itemsSelector: string,
  url: string,
): readonly RawEntityCard[] {
  const groups = new Map<string, UseCaseSlots>();
  for (const element of page(itemsSelector).toArray()) {
    const path = page(element).attr('data-cms-path');
    if (path === undefined) {
      continue;
    }
    const lastDot = path.lastIndexOf('.');
    const field = path.slice(lastDot + 1);
    if (field !== 'title' && field !== 'description') {
      continue;
    }
    const itemPath = path.slice(0, lastDot);
    const slots = groups.get(itemPath) ?? {};
    if (field === 'title') {
      slots.titleText = collapseWhitespace(page(element).text());
    } else {
      slots.descriptionText = collapseWhitespace(page(element).text());
    }
    groups.set(itemPath, slots);
  }
  const cards: RawEntityCard[] = [];
  for (const [itemPath, slots] of groups) {
    if (slots.titleText === undefined) {
      throw new CrawlError(
        `[parse ${url}] missing required use-case title data-cms-path="${itemPath}.title"`,
        { stage: 'parse', url },
      );
    }
    if (slots.descriptionText === undefined || slots.descriptionText.length === 0) {
      throw new CrawlError(
        `[parse ${url}] missing required use-case description data-cms-path="${itemPath}.description"`,
        { stage: 'parse', url },
      );
    }
    const name = requireBounded(
      slots.titleText,
      FIELD_CAPS.name,
      `use-case title data-cms-path="${itemPath}.title"`,
      url,
    );
    cards.push({ name, summary: trimSummary(slots.descriptionText), href: null });
  }
  return cards;
}

/** pathKey-style comparison key: lowercased host + trailing-slash-insensitive path. */
function comparableUrlKey(url: string): string {
  return `${new URL(url).host.toLowerCase()}${pathKeyOf(url)}`;
}
