import { describe, expect, it } from 'vitest';

import { CrawlError } from '../errors.js';
import { optionalAttr, optionalText, parseHtml, requireAttr, requireText } from './html.js';

const URL_UNDER_TEST = 'https://www.cloudflare.com/products/cdn/';

/** Distinctive body copy used to prove error messages never echo page content. */
const BODY_MARKER = 'body-copy-marker-must-never-leak';

const PAGE_HTML = `
  <html>
    <head>
      <link rel="canonical" href=" https://www.cloudflare.com/products/cdn/ ">
      <meta name="description" content="  Speed up
        your site.  ">
    </head>
    <body>
      <h1>
        Content
        Delivery   Network
      </h1>
      <p>${BODY_MARKER}</p>
    </body>
  </html>
`;

function captureError(run: () => unknown): unknown {
  try {
    run();
  } catch (error) {
    return error;
  }
  return undefined;
}

describe('requireAttr', () => {
  it('returns the collapsed attribute value', () => {
    const page = parseHtml(PAGE_HTML);
    expect(requireAttr(page, 'link[rel="canonical"]', 'href', URL_UNDER_TEST)).toBe(
      'https://www.cloudflare.com/products/cdn/',
    );
    expect(requireAttr(page, 'meta[name="description"]', 'content', URL_UNDER_TEST)).toBe(
      'Speed up your site.',
    );
  });

  it('throws a parse-stage CrawlError naming the selector when the attribute is missing', () => {
    const page = parseHtml('<html><head></head><body><p>text</p></body></html>');
    const caught = captureError(() =>
      requireAttr(page, 'link[rel="canonical"]', 'href', URL_UNDER_TEST),
    );
    expect(caught).toBeInstanceOf(CrawlError);
    if (caught instanceof CrawlError) {
      expect(caught.stage).toBe('parse');
      expect(caught.url).toBe(URL_UNDER_TEST);
      expect(caught.message).toBe(
        `[parse ${URL_UNDER_TEST}] missing required link[rel="canonical"]@href`,
      );
    }
  });

  it('treats a whitespace-blank attribute as missing and never echoes body text', () => {
    const page = parseHtml(
      `<html><head><link rel="canonical" href="   "></head><body><p>${BODY_MARKER}</p></body></html>`,
    );
    const caught = captureError(() =>
      requireAttr(page, 'link[rel="canonical"]', 'href', URL_UNDER_TEST),
    );
    expect(caught).toBeInstanceOf(CrawlError);
    if (caught instanceof CrawlError) {
      expect(caught.stage).toBe('parse');
      expect(caught.message).toContain('link[rel="canonical"]@href');
      expect(caught.message).not.toContain(BODY_MARKER);
    }
  });
});

describe('requireText', () => {
  it('returns the collapsed text of the first match', () => {
    const page = parseHtml(PAGE_HTML);
    expect(requireText(page, 'h1', URL_UNDER_TEST)).toBe('Content Delivery Network');
  });

  it('throws a parse-stage CrawlError naming the selector when no element matches', () => {
    const page = parseHtml(`<html><body><p>${BODY_MARKER}</p></body></html>`);
    const caught = captureError(() => requireText(page, 'h1', URL_UNDER_TEST));
    expect(caught).toBeInstanceOf(CrawlError);
    if (caught instanceof CrawlError) {
      expect(caught.stage).toBe('parse');
      expect(caught.url).toBe(URL_UNDER_TEST);
      expect(caught.message).toBe(`[parse ${URL_UNDER_TEST}] missing required text for h1`);
      expect(caught.message).not.toContain(BODY_MARKER);
    }
  });

  it('treats whitespace-only element text as missing', () => {
    const page = parseHtml('<html><body><h1> \n\t </h1></body></html>');
    const caught = captureError(() => requireText(page, 'h1', URL_UNDER_TEST));
    expect(caught).toBeInstanceOf(CrawlError);
    if (caught instanceof CrawlError) {
      expect(caught.stage).toBe('parse');
      expect(caught.message).toContain('h1');
    }
  });
});

describe('optionalAttr / optionalText', () => {
  it('returns collapsed values when present', () => {
    const page = parseHtml(PAGE_HTML);
    expect(optionalAttr(page, 'meta[name="description"]', 'content')).toBe('Speed up your site.');
    expect(optionalText(page, 'h1')).toBe('Content Delivery Network');
  });

  it('returns undefined when the element or attribute is missing', () => {
    const page = parseHtml('<html><body></body></html>');
    expect(optionalAttr(page, 'meta[name="description"]', 'content')).toBeUndefined();
    expect(optionalText(page, 'h1')).toBeUndefined();
  });

  it('returns undefined for whitespace-blank values', () => {
    const page = parseHtml(
      '<html><head><meta name="description" content="  "></head><body><h1>  </h1></body></html>',
    );
    expect(optionalAttr(page, 'meta[name="description"]', 'content')).toBeUndefined();
    expect(optionalText(page, 'h1')).toBeUndefined();
  });
});

describe('malformed-HTML recovery', () => {
  it('parses crossed tags and unclosed elements without throwing', () => {
    const page = parseHtml(
      '<html><body><h1>Zero <b>Trust <i>Security</b> Suite</i></h1><p>unclosed paragraph</body></html>',
    );
    expect(requireText(page, 'h1', URL_UNDER_TEST)).toBe('Zero Trust Security Suite');
    expect(optionalText(page, 'p')).toBe('unclosed paragraph');
  });

  it('extracts collapsed text even when recovery absorbs trailing whitespace', () => {
    const page = parseHtml('<html><body><h1><b>Bold <i>both</b>\n   tail</i></h1></body></html>');
    expect(requireText(page, 'h1', URL_UNDER_TEST)).toBe('Bold both tail');
  });
});
