/**
 * DOM access boundary: the ONLY module that imports the third-party HTML
 * parser. Everything downstream of these helpers is plain strings, so the
 * parser stays swappable without touching selector code.
 *
 * cheerio semantics this module papers over (empirically verified):
 * - A no-match selector NEVER throws: `.attr()` is undefined and `.text()` is
 *   `''`, so "required" must be enforced here with a stage-tagged CrawlError.
 * - `cheerio.load()` never throws on malformed HTML — parse5 error-recovers
 *   (mis-nested elements stay open and absorb trailing whitespace), which is
 *   why every extracted string is whitespace-collapsed before use.
 * - Syntactically INVALID selector strings DO throw at query time, so
 *   selectors at call sites must always be static string literals, never
 *   built from page data (a bad literal is a programmer error, not a runtime
 *   crawl concern).
 */
import * as cheerio from 'cheerio';

import { CrawlError } from '../errors.js';
import { collapseWhitespace } from '../text.js';

/** Opaque handle for a loaded HTML document. */
export type HtmlPage = ReturnType<typeof cheerio.load>;

/** Parse an HTML body into a queryable page (parse5 error recovery; never throws). */
export function parseHtml(html: string): HtmlPage {
  return cheerio.load(html);
}

/**
 * Required-attribute helper: missing or whitespace-blank values throw a
 * CrawlError at stage 'parse' naming the selector and attribute — never any
 * page content. Returns the collapsed attribute value.
 */
export function requireAttr(
  page: HtmlPage,
  selector: string,
  attribute: string,
  url: string,
): string {
  const value = page(selector).attr(attribute);
  if (value === undefined || collapseWhitespace(value).length === 0) {
    throw new CrawlError(`[parse ${url}] missing required ${selector}@${attribute}`, {
      stage: 'parse',
      url,
    });
  }
  return collapseWhitespace(value);
}

/** One selection out of an {@link HtmlPage} query. */
export type HtmlSelection = ReturnType<HtmlPage>;

/**
 * Collapsed text of a selection with embedded script/style content removed.
 * Live pages inline framework loaders inside SSR'd copy nodes (found in the
 * wild on the solutions overview by the issue #5 data audit), and a plain
 * `.text()` would concatenate that JavaScript into extracted summaries.
 */
export function cleanText(selection: HtmlSelection): string {
  const cloned = selection.clone();
  cloned.find('script, style').remove();
  return collapseWhitespace(cloned.text());
}

/**
 * Required-text variant of {@link requireAttr}: first match wins, collapsed;
 * blank (including no match) throws a CrawlError at stage 'parse' naming the
 * selector.
 */
export function requireText(page: HtmlPage, selector: string, url: string): string {
  const text = cleanText(page(selector).first());
  if (text.length === 0) {
    throw new CrawlError(`[parse ${url}] missing required text for ${selector}`, {
      stage: 'parse',
      url,
    });
  }
  return text;
}

/** Optional attribute: collapsed value, or undefined when missing or blank. */
export function optionalAttr(
  page: HtmlPage,
  selector: string,
  attribute: string,
): string | undefined {
  const value = page(selector).attr(attribute);
  if (value === undefined) {
    return undefined;
  }
  const collapsed = collapseWhitespace(value);
  return collapsed.length === 0 ? undefined : collapsed;
}

/** Optional text: collapsed first-match text, or undefined when blank. */
export function optionalText(page: HtmlPage, selector: string): string | undefined {
  const text = cleanText(page(selector).first());
  return text.length === 0 ? undefined : text;
}
