import { idSlugSchema } from '@cf-viz/catalog';
import { describe, expect, it } from 'vitest';

import { CrawlError } from './errors.js';
import { idFromPath, pathKeyOf, slugify } from './ids.js';

function captureError(run: () => unknown): unknown {
  try {
    run();
  } catch (error) {
    return error;
  }
  return undefined;
}

describe('slugify', () => {
  it('turns official names into kebab-case slugs', () => {
    expect(slugify('SASE / Zero Trust')).toBe('sase-zero-trust');
    expect(slugify('Build & deploy')).toBe('build-deploy');
    expect(slugify('  Workers  ')).toBe('workers');
  });

  it('folds diacritics via NFKD', () => {
    expect(slugify('Café')).toBe('cafe');
    expect(slugify('Sécurité Réseau')).toBe('securite-reseau');
  });

  it('caps at 64 characters and re-trims a trailing hyphen the cap exposed', () => {
    const input = `${'a'.repeat(63)} ${'b'.repeat(10)}`;
    const slug = slugify(input);
    expect(slug).toBe('a'.repeat(63));
    expect(slug.length).toBeLessThanOrEqual(64);
  });

  it('produces idSlugSchema-valid output for every case', () => {
    const produced = [
      slugify('SASE / Zero Trust'),
      slugify('Build & deploy'),
      slugify('Café'),
      slugify(`${'a'.repeat(63)} ${'b'.repeat(10)}`),
      slugify('R2 Object Storage'),
      slugify('1.1.1.1'),
    ];
    for (const slug of produced) {
      expect(idSlugSchema.safeParse(slug).success).toBe(true);
    }
  });

  it('throws a normalize-stage CrawlError for empty or symbol-only input', () => {
    for (const input of ['', '   ', '/ & !!']) {
      const caught = captureError(() => slugify(input));
      expect(caught).toBeInstanceOf(CrawlError);
      if (caught instanceof CrawlError) {
        expect(caught.stage).toBe('normalize');
        expect(caught.message).toContain('cannot derive a slug');
      }
    }
  });
});

describe('pathKeyOf', () => {
  it('strips the trailing slash and lowercases the pathname', () => {
    expect(pathKeyOf('https://www.cloudflare.com/products/workers/')).toBe('/products/workers');
    expect(pathKeyOf('https://www.cloudflare.com/Products/Workers')).toBe('/products/workers');
  });

  it('collapses the root path to /', () => {
    expect(pathKeyOf('https://www.cloudflare.com/')).toBe('/');
    expect(pathKeyOf('https://www.cloudflare.com')).toBe('/');
  });

  it('accepts bare paths', () => {
    expect(pathKeyOf('/products/CDN/')).toBe('/products/cdn');
  });
});

describe('idFromPath', () => {
  it('slugifies the last non-empty path segment', () => {
    expect(idFromPath('/products/cdn/')).toBe('cdn');
    expect(idFromPath('https://www.cloudflare.com/sase/')).toBe('sase');
    expect(idFromPath('https://www.cloudflare.com/products/Workers')).toBe('workers');
  });

  it('throws a normalize-stage CrawlError when the path has no segment', () => {
    for (const input of ['/', 'https://www.cloudflare.com/']) {
      const caught = captureError(() => idFromPath(input));
      expect(caught).toBeInstanceOf(CrawlError);
      if (caught instanceof CrawlError) {
        expect(caught.stage).toBe('normalize');
        expect(caught.url).toBe(input);
      }
    }
  });
});
