import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { CrawlError } from '../errors.js';
import { parseHtml } from './html.js';
import { parseProductsOverview } from './products-overview.js';
import type { PageMeta } from './types.js';

const URL_UNDER_TEST = 'https://www.cloudflare.com/products/';
const RETRIEVED_AT = '2026-07-01T00:00:00.000Z';

const META: PageMeta = {
  sourceId: 'www-products-overview',
  url: URL_UNDER_TEST,
  retrievedAt: RETRIEVED_AT,
};

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

describe('parseProductsOverview', () => {
  it('parses the valid fixture into the full expected page', () => {
    const page = parseHtml(fixture('marketing-overview-products.html'));
    expect(parseProductsOverview(page, META)).toEqual({
      sourceId: 'www-products-overview',
      canonicalUrl: 'https://www.cloudflare.com/products/',
      title: 'Products | Cloudflare',
      description:
        'Explore the full Cloudflare developer platform — compute, storage, AI, media, networking, and security products to build and scale any application.',
      retrievedAt: RETRIEVED_AT,
      kind: 'products-overview',
      families: [
        {
          heading: 'Compute',
          items: [
            {
              name: 'Workers',
              tagline: 'Global serverless functions',
              href: 'https://www.cloudflare.com/products/workers/',
            },
            {
              name: 'Cloudflare Pages',
              tagline: 'Build & deploy frontend sites',
              href: 'https://www.cloudflare.com/products/pages/',
            },
          ],
        },
        {
          heading: 'SASE / Zero Trust',
          items: [
            {
              name: 'Access',
              tagline: 'Zero trust access to private resources',
              href: 'https://www.cloudflare.com/products/access/',
            },
            {
              // Live anomaly: a genuine card with no tagline p parses with
              // tagline null instead of failing the crawl.
              name: 'DDoS for Web',
              tagline: null,
              href: 'https://www.cloudflare.com/products/ddos-for-web/',
            },
          ],
        },
        {
          heading: 'Application performance',
          items: [
            {
              name: 'CDN',
              tagline: 'Ultra-fast static and dynamic content delivery',
              href: 'https://www.cloudflare.com/products/cdn/',
            },
          ],
        },
      ],
    });
  });

  it('errors at stage parse naming the canonical selector when the canonical link is missing', () => {
    const page = parseHtml(fixture('marketing-overview-products-missing-canonical.html'));
    const caught = captureError(() => parseProductsOverview(page, META));
    expect(caught).toBeInstanceOf(CrawlError);
    if (caught instanceof CrawlError) {
      expect(caught.stage).toBe('parse');
      expect(caught.url).toBe(URL_UNDER_TEST);
      expect(caught.message).toContain('link[rel="canonical"]');
    }
  });

  it('errors at stage parse when the canonical URL identifies a different page', () => {
    const page = parseHtml(fixture('marketing-overview-products.html'));
    const drifted: PageMeta = { ...META, url: 'https://www.cloudflare.com/solutions/' };
    const caught = captureError(() => parseProductsOverview(page, drifted));
    expect(caught).toBeInstanceOf(CrawlError);
    if (caught instanceof CrawlError) {
      expect(caught.stage).toBe('parse');
      expect(caught.message).toContain('link[rel="canonical"]');
      expect(caught.message).toContain('different page');
    }
  });
});
