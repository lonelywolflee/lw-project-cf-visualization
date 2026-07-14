import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { CrawlError } from '../errors.js';
import { parseHtml } from './html.js';
import { parseMarketingProduct } from './marketing-product.js';
import type { PageMeta } from './types.js';

const URL_UNDER_TEST = 'https://www.cloudflare.com/products/cdn/';
const RETRIEVED_AT = '2026-07-01T00:00:00.000Z';

const META: PageMeta = {
  sourceId: 'www-product-cdn',
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

describe('parseMarketingProduct', () => {
  it('parses the valid fixture into the full expected page (title trailing space collapsed)', () => {
    const page = parseHtml(fixture('marketing-product-cdn.html'));
    expect(parseMarketingProduct(page, META)).toEqual({
      sourceId: 'www-product-cdn',
      canonicalUrl: 'https://www.cloudflare.com/products/cdn/',
      title: 'Cloudflare CDN - Global Content Delivery Network',
      description:
        'Make your site faster and stop paying for bandwidth. CDN caches content in 330+ cities worldwide with zero-configuration setup and predictable pricing.',
      retrievedAt: RETRIEVED_AT,
      kind: 'marketing-product',
      useCases: [
        {
          name: 'Static Asset Acceleration',
          summary:
            'Accelerating the delivery of static assets like images, CSS, and JavaScript to improve site speed and Core Web Vitals.',
          href: null,
        },
        {
          name: 'API Response Caching',
          summary: 'Caching anonymous API GET responses.',
          href: null,
        },
      ],
    });
  });

  it('errors at stage parse naming the missing item title data-cms-path', () => {
    const page = parseHtml(fixture('marketing-product-cdn-usecase-missing-title.html'));
    const caught = captureError(() => parseMarketingProduct(page, META));
    expect(caught).toBeInstanceOf(CrawlError);
    if (caught instanceof CrawlError) {
      expect(caught.stage).toBe('parse');
      expect(caught.url).toBe(URL_UNDER_TEST);
      expect(caught.message).toContain('products.cdn.sections.useCases.items.0.title');
    }
  });

  it('accepts an entirely absent use-case section as zero use cases', () => {
    const withoutUseCases = fixture('marketing-product-cdn.html')
      .split('\n')
      .filter((line) => !line.includes('useCases'))
      .join('\n');
    const page = parseHtml(withoutUseCases);
    expect(parseMarketingProduct(page, META).useCases).toEqual([]);
  });
});
