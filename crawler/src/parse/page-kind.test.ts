import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { CrawlError } from '../errors.js';
import { parseHtml } from './html.js';
import { assertExpectedKind, detectPageKind } from './page-kind.js';
import type { ParsedPageKind } from './types.js';

const URL_UNDER_TEST = 'https://www.cloudflare.com/products/';

function fixture(name: string): string {
  return readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');
}

function captureError(run: () => unknown): unknown {
  try {
    run();
  } catch (error) {
    return error;
  }
  return undefined;
}

interface DetectionCase {
  readonly fixtureName: string;
  readonly expected: ParsedPageKind;
}

const DETECTION_CASES: readonly DetectionCase[] = [
  { fixtureName: 'marketing-overview-products.html', expected: 'products-overview' },
  { fixtureName: 'marketing-overview-solutions.html', expected: 'solutions-overview' },
  { fixtureName: 'marketing-product-cdn.html', expected: 'marketing-product' },
  { fixtureName: 'marketing-solution-sase.html', expected: 'marketing-solution' },
  { fixtureName: 'developer-docs-directory.html', expected: 'developer-docs' },
];

describe('detectPageKind', () => {
  it.each(DETECTION_CASES)('detects $expected from $fixtureName', ({ fixtureName, expected }) => {
    const page = parseHtml(fixture(fixtureName));
    expect(detectPageKind(page, URL_UNDER_TEST)).toBe(expected);
  });

  it('errors at stage parse on an unrecognized structure', () => {
    const page = parseHtml('<html><body><p>hi</p></body></html>');
    const caught = captureError(() => detectPageKind(page, URL_UNDER_TEST));
    expect(caught).toBeInstanceOf(CrawlError);
    if (caught instanceof CrawlError) {
      expect(caught.stage).toBe('parse');
      expect(caught.url).toBe(URL_UNDER_TEST);
      expect(caught.message).toBe(`[parse ${URL_UNDER_TEST}] unrecognized page structure`);
    }
  });
});

describe('assertExpectedKind', () => {
  it('accepts kinds that fold into the configured source page kind', () => {
    expect(() => {
      assertExpectedKind('products-overview', 'marketing-overview', URL_UNDER_TEST);
      assertExpectedKind('solutions-overview', 'marketing-overview', URL_UNDER_TEST);
      assertExpectedKind('marketing-product', 'marketing-product', URL_UNDER_TEST);
      assertExpectedKind('marketing-solution', 'marketing-solution', URL_UNDER_TEST);
      assertExpectedKind('developer-docs', 'developer-docs', URL_UNDER_TEST);
    }).not.toThrow();
  });

  it('errors at stage parse naming both kinds on a mismatch', () => {
    const caught = captureError(() => {
      assertExpectedKind('products-overview', 'developer-docs', URL_UNDER_TEST);
    });
    expect(caught).toBeInstanceOf(CrawlError);
    if (caught instanceof CrawlError) {
      expect(caught.stage).toBe('parse');
      expect(caught.url).toBe(URL_UNDER_TEST);
      expect(caught.message).toContain("'products-overview'");
      expect(caught.message).toContain("'developer-docs'");
    }
  });
});
