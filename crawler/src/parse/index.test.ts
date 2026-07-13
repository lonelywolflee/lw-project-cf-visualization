import { readFileSync } from 'node:fs';

import type { SourcePageKind } from '@cf-viz/catalog';
import { describe, expect, it } from 'vitest';

import { CrawlError } from '../errors.js';
import type { FetchResult } from '../http-client.js';
import { parsePage } from './index.js';
import type { ParsedPageKind } from './types.js';

const RETRIEVED_AT = '2026-07-01T00:00:00.000Z';

function fixture(name: string): string {
  return readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');
}

function makeFetchResult(sourceId: string, url: string, bodyText: string): FetchResult {
  return {
    sourceId,
    requestedUrl: url,
    finalUrl: url,
    status: 200,
    contentType: 'text/html; charset=utf-8',
    retrievedAt: RETRIEVED_AT,
    redirectCount: 0,
    bodyText,
  };
}

function captureError(run: () => unknown): unknown {
  try {
    run();
  } catch (error) {
    return error;
  }
  return undefined;
}

interface DispatchCase {
  readonly fixtureName: string;
  readonly sourceId: string;
  readonly url: string;
  readonly configured: SourcePageKind;
  readonly expectedKind: ParsedPageKind;
}

const DISPATCH_CASES: readonly DispatchCase[] = [
  {
    fixtureName: 'marketing-overview-products.html',
    sourceId: 'www-products-overview',
    url: 'https://www.cloudflare.com/products/',
    configured: 'marketing-overview',
    expectedKind: 'products-overview',
  },
  {
    fixtureName: 'marketing-overview-solutions.html',
    sourceId: 'www-solutions-overview',
    url: 'https://www.cloudflare.com/solutions/',
    configured: 'marketing-overview',
    expectedKind: 'solutions-overview',
  },
  {
    fixtureName: 'marketing-product-cdn.html',
    sourceId: 'www-product-cdn',
    url: 'https://www.cloudflare.com/products/cdn/',
    configured: 'marketing-product',
    expectedKind: 'marketing-product',
  },
  {
    fixtureName: 'marketing-solution-sase.html',
    sourceId: 'www-solution-sase',
    url: 'https://www.cloudflare.com/sase/',
    configured: 'marketing-solution',
    expectedKind: 'marketing-solution',
  },
  {
    fixtureName: 'developer-docs-directory.html',
    sourceId: 'developers-docs-directory',
    url: 'https://developers.cloudflare.com/directory/',
    configured: 'developer-docs',
    expectedKind: 'developer-docs',
  },
];

describe('parsePage', () => {
  it.each(DISPATCH_CASES)(
    'dispatches $fixtureName to the $expectedKind parser',
    ({ fixtureName, sourceId, url, configured, expectedKind }) => {
      const result = parsePage(makeFetchResult(sourceId, url, fixture(fixtureName)), configured);
      expect(result.kind).toBe(expectedKind);
      expect(result.sourceId).toBe(sourceId);
      expect(result.canonicalUrl).toBe(url);
      expect(result.retrievedAt).toBe(RETRIEVED_AT);
    },
  );

  it('carries PageMeta from the FetchResult through to the parsed payload', () => {
    const result = parsePage(
      makeFetchResult(
        'www-products-overview',
        'https://www.cloudflare.com/products/',
        fixture('marketing-overview-products.html'),
      ),
      'marketing-overview',
    );
    expect(result.kind).toBe('products-overview');
    if (result.kind === 'products-overview') {
      expect(result.families).toHaveLength(3);
    }
  });

  it('errors at stage parse when the detected kind contradicts the configured kind', () => {
    const caught = captureError(() =>
      parsePage(
        makeFetchResult(
          'www-products-overview',
          'https://www.cloudflare.com/products/',
          fixture('marketing-overview-products.html'),
        ),
        'developer-docs',
      ),
    );
    expect(caught).toBeInstanceOf(CrawlError);
    if (caught instanceof CrawlError) {
      expect(caught.stage).toBe('parse');
      expect(caught.url).toBe('https://www.cloudflare.com/products/');
      expect(caught.message).toContain("'products-overview'");
      expect(caught.message).toContain("'developer-docs'");
    }
  });
});
