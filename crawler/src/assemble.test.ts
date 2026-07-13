import { readFileSync } from 'node:fs';

import { CatalogValidationError, type Source, type SourcePageKind } from '@cf-viz/catalog';
import { describe, expect, it } from 'vitest';

import { assembleCatalog } from './assemble.js';
import { CrawlError } from './errors.js';
import type { FetchResult } from './http-client.js';
import { normalizePage, type CatalogFragment } from './normalize.js';
import { parsePage } from './parse/index.js';

const RETRIEVED_AT = '2026-07-01T00:00:00.000Z';
const GENERATED_AT = '2026-07-02T12:00:00.000Z';

function fixture(name: string): string {
  return readFileSync(new URL(`./parse/fixtures/${name}`, import.meta.url), 'utf8');
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

function normalizeFixture(
  fixtureName: string,
  sourceId: string,
  url: string,
  configuredKind: SourcePageKind,
): CatalogFragment {
  const page = parsePage(makeFetchResult(sourceId, url, fixture(fixtureName)), configuredKind);
  return normalizePage(page, configuredKind);
}

/** The full pipeline (parse → normalize) over every valid fixture. */
function fixtureFragments(): readonly CatalogFragment[] {
  return [
    normalizeFixture(
      'marketing-overview-products.html',
      'www-products-overview',
      'https://www.cloudflare.com/products/',
      'marketing-overview',
    ),
    normalizeFixture(
      'marketing-overview-solutions.html',
      'www-solutions-overview',
      'https://www.cloudflare.com/solutions/',
      'marketing-overview',
    ),
    normalizeFixture(
      'marketing-product-cdn.html',
      'www-product-cdn',
      'https://www.cloudflare.com/products/cdn/',
      'marketing-product',
    ),
    normalizeFixture(
      'marketing-solution-sase.html',
      'www-solution-sase',
      'https://www.cloudflare.com/sase/',
      'marketing-solution',
    ),
    normalizeFixture(
      'developer-docs-directory.html',
      'developers-docs-directory',
      'https://developers.cloudflare.com/directory/',
      'developer-docs',
    ),
  ];
}

function makeSource(id: string, url: string, pageKind: SourcePageKind, title: string): Source {
  return { id, url, pageKind, title, retrievedAt: RETRIEVED_AT };
}

function makeFragment(
  source: Source,
  parts: Partial<Omit<CatalogFragment, 'source'>>,
): CatalogFragment {
  return {
    source,
    familyClaims: parts.familyClaims ?? [],
    productClaims: parts.productClaims ?? [],
    solutionClaims: parts.solutionClaims ?? [],
    useCaseClaims: parts.useCaseClaims ?? [],
    edgeClaims: parts.edgeClaims ?? [],
    docsEntryClaims: parts.docsEntryClaims ?? [],
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

describe('assembleCatalog', () => {
  it('assembles all five fixture fragments into the expected validated catalog', () => {
    const catalog = assembleCatalog(fixtureFragments(), { generatedAt: GENERATED_AT });
    expect(catalog).toEqual({
      schemaVersion: '1',
      generatedAt: GENERATED_AT,
      sources: [
        {
          id: 'developers-docs-directory',
          url: 'https://developers.cloudflare.com/directory/',
          pageKind: 'developer-docs',
          title: 'Docs directory | Cloudflare Docs',
          retrievedAt: RETRIEVED_AT,
        },
        {
          id: 'www-product-cdn',
          url: 'https://www.cloudflare.com/products/cdn/',
          pageKind: 'marketing-product',
          title: 'Cloudflare CDN - Global Content Delivery Network',
          retrievedAt: RETRIEVED_AT,
        },
        {
          id: 'www-products-overview',
          url: 'https://www.cloudflare.com/products/',
          pageKind: 'marketing-overview',
          title: 'Products | Cloudflare',
          retrievedAt: RETRIEVED_AT,
        },
        {
          id: 'www-solution-sase',
          url: 'https://www.cloudflare.com/sase/',
          pageKind: 'marketing-solution',
          title: 'Cloudflare One | The agile SASE platform | Cloudflare',
          retrievedAt: RETRIEVED_AT,
        },
        {
          id: 'www-solutions-overview',
          url: 'https://www.cloudflare.com/solutions/',
          pageKind: 'marketing-overview',
          title: 'Solutions | Cloudflare',
          retrievedAt: RETRIEVED_AT,
        },
      ],
      productFamilies: [
        {
          id: 'application-performance',
          name: 'Application performance',
          summary:
            'Cloudflare product family "Application performance" as grouped on the official products overview.',
          sourceIds: ['www-products-overview'],
        },
        {
          id: 'compute',
          name: 'Compute',
          summary:
            'Cloudflare product family "Compute" as grouped on the official products overview.',
          sourceIds: ['www-products-overview'],
        },
        {
          id: 'sase-zero-trust',
          name: 'SASE / Zero Trust',
          summary:
            'Cloudflare product family "SASE / Zero Trust" as grouped on the official products overview.',
          sourceIds: ['www-products-overview'],
        },
      ],
      products: [
        {
          id: 'access',
          name: 'Access',
          summary: 'Zero trust access to private resources',
          familyId: 'sase-zero-trust',
          sourceIds: ['www-products-overview'],
        },
        {
          // The overview owns the name and family; the dedicated page's
          // description outranks the overview tagline; sourceIds union both.
          id: 'cdn',
          name: 'CDN',
          summary:
            'Make your site faster and stop paying for bandwidth. CDN caches content in 330+ cities worldwide with zero-configuration setup and predictable pricing.',
          familyId: 'application-performance',
          sourceIds: ['www-product-cdn', 'www-products-overview'],
        },
        {
          id: 'pages',
          name: 'Cloudflare Pages',
          summary: 'Build & deploy frontend sites',
          familyId: 'compute',
          sourceIds: ['www-products-overview'],
        },
        {
          // Docs enrichment: the single-segment /workers/ docs entry matches
          // this product id exactly, so the docs source joins the union. The
          // /cache/ entry matches no product and contributes nothing.
          id: 'workers',
          name: 'Workers',
          summary: 'Global serverless functions',
          familyId: 'compute',
          sourceIds: ['developers-docs-directory', 'www-products-overview'],
        },
      ],
      solutions: [
        {
          id: 'ai',
          name: 'AI',
          summary: 'Build intelligent applications with AI at the edge',
          sourceIds: ['www-solutions-overview'],
        },
        {
          id: 'frontends',
          name: 'Frontends',
          summary: 'Deploy frontend applications globally in seconds',
          sourceIds: ['www-solutions-overview'],
        },
        {
          id: 'sase',
          name: 'Cloudflare One',
          summary:
            'Connect and protect your workforce, AI agents, and infrastructure with Cloudflare One — the unified SASE platform built for safe AI adoption and zero trust access.',
          sourceIds: ['www-solution-sase'],
        },
      ],
      useCases: [
        {
          id: 'api-response-caching',
          name: 'API Response Caching',
          summary: 'Caching anonymous API GET responses.',
          sourceIds: ['www-product-cdn'],
        },
        {
          id: 'modernize-remote-access',
          name: 'Modernize remote access',
          summary: 'Stop relying on clunky, insecure VPNs.',
          sourceIds: ['www-solution-sase'],
        },
        {
          id: 'safely-adopt-ai',
          name: 'Safely adopt AI',
          summary: 'Move beyond AI blocking to securing AI adoption at scale.',
          sourceIds: ['www-solution-sase'],
        },
        {
          id: 'static-asset-acceleration',
          name: 'Static Asset Acceleration',
          summary:
            'Accelerating the delivery of static assets like images, CSS, and JavaScript to improve site speed and Core Web Vitals.',
          sourceIds: ['www-product-cdn'],
        },
      ],
      relationships: [
        {
          type: 'product-use-case',
          fromId: 'cdn',
          toId: 'api-response-caching',
          sourceIds: ['www-product-cdn'],
        },
        {
          type: 'product-use-case',
          fromId: 'cdn',
          toId: 'static-asset-acceleration',
          sourceIds: ['www-product-cdn'],
        },
        {
          type: 'solution-use-case',
          fromId: 'sase',
          toId: 'modernize-remote-access',
          sourceIds: ['www-solution-sase'],
        },
        {
          type: 'solution-use-case',
          fromId: 'sase',
          toId: 'safely-adopt-ai',
          sourceIds: ['www-solution-sase'],
        },
      ],
    });
    expect(Object.keys(catalog)).toEqual([
      'schemaVersion',
      'generatedAt',
      'sources',
      'productFamilies',
      'products',
      'solutions',
      'useCases',
      'relationships',
    ]);
  });

  it('is byte-identical regardless of fragment input order', () => {
    const fragments = fixtureFragments();
    const shuffled = [...fragments].reverse();
    const one = assembleCatalog(fragments, { generatedAt: GENERATED_AT });
    const other = assembleCatalog(shuffled, { generatedAt: GENERATED_AT });
    expect(JSON.stringify(other)).toBe(JSON.stringify(one));
  });

  it('is byte-identical across two full parse → normalize → assemble runs', () => {
    const first = assembleCatalog(fixtureFragments(), { generatedAt: GENERATED_AT });
    const second = assembleCatalog(fixtureFragments(), { generatedAt: GENERATED_AT });
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
  });

  it('errors at stage normalize when a product page is missing from the products overview', () => {
    const cdnOnly = normalizeFixture(
      'marketing-product-cdn.html',
      'www-product-cdn',
      'https://www.cloudflare.com/products/cdn/',
      'marketing-product',
    );
    const caught = captureError(() => assembleCatalog([cdnOnly], { generatedAt: GENERATED_AT }));
    expect(caught).toBeInstanceOf(CrawlError);
    if (caught instanceof CrawlError) {
      expect(caught.stage).toBe('normalize');
      expect(caught.url).toBe('https://www.cloudflare.com/products/cdn/');
      expect(caught.message).toContain("product 'cdn' is missing from the products overview");
    }
  });

  it('errors at stage normalize on conflicting family names for one slug', () => {
    const fragments: readonly CatalogFragment[] = [
      makeFragment(
        makeSource('hand-a', 'https://www.cloudflare.com/products/', 'marketing-overview', 'A'),
        { familyClaims: [{ id: 'compute', name: 'Compute', sourceId: 'hand-a' }] },
      ),
      makeFragment(
        makeSource('hand-b', 'https://www.cloudflare.com/products-b/', 'marketing-overview', 'B'),
        { familyClaims: [{ id: 'compute', name: 'Compute Platform', sourceId: 'hand-b' }] },
      ),
    ];
    const caught = captureError(() => assembleCatalog(fragments, { generatedAt: GENERATED_AT }));
    expect(caught).toBeInstanceOf(CrawlError);
    if (caught instanceof CrawlError) {
      expect(caught.stage).toBe('normalize');
      expect(caught.message).toContain("conflicting name for product family 'compute'");
      expect(caught.message).toContain('https://www.cloudflare.com/products/');
      expect(caught.message).toContain('https://www.cloudflare.com/products-b/');
    }
  });

  it('errors at stage normalize on conflicting use-case copy at equal precedence', () => {
    const fragments: readonly CatalogFragment[] = [
      makeFragment(
        makeSource('hand-a', 'https://www.cloudflare.com/products/a/', 'marketing-product', 'A'),
        {
          useCaseClaims: [
            { id: 'shared-case', name: 'Shared Case', summary: 'One copy.', sourceId: 'hand-a' },
          ],
        },
      ),
      makeFragment(
        makeSource('hand-b', 'https://www.cloudflare.com/products/b/', 'marketing-product', 'B'),
        {
          useCaseClaims: [
            { id: 'shared-case', name: 'Shared Case', summary: 'Other copy.', sourceId: 'hand-b' },
          ],
        },
      ),
    ];
    const caught = captureError(() => assembleCatalog(fragments, { generatedAt: GENERATED_AT }));
    expect(caught).toBeInstanceOf(CrawlError);
    if (caught instanceof CrawlError) {
      expect(caught.stage).toBe('normalize');
      expect(caught.message).toContain("conflicting summary for use case 'shared-case'");
    }
  });

  it('errors at stage normalize on a dangling edge endpoint', () => {
    const fragments: readonly CatalogFragment[] = [
      makeFragment(
        makeSource('hand-a', 'https://www.cloudflare.com/products/a/', 'marketing-product', 'A'),
        {
          edgeClaims: [
            { type: 'product-use-case', fromId: 'ghost', toId: 'nowhere', sourceId: 'hand-a' },
          ],
        },
      ),
    ];
    const caught = captureError(() => assembleCatalog(fragments, { generatedAt: GENERATED_AT }));
    expect(caught).toBeInstanceOf(CrawlError);
    if (caught instanceof CrawlError) {
      expect(caught.stage).toBe('normalize');
      expect(caught.url).toBe('https://www.cloudflare.com/products/a/');
      expect(caught.message).toContain("'product-use-case'");
      expect(caught.message).toContain("'ghost'");
    }
  });

  it('errors at stage normalize on duplicate source ids', () => {
    const fragments: readonly CatalogFragment[] = [
      makeFragment(
        makeSource('hand-a', 'https://www.cloudflare.com/products/a/', 'marketing-product', 'A'),
        {},
      ),
      makeFragment(
        makeSource('hand-a', 'https://www.cloudflare.com/products/b/', 'marketing-product', 'B'),
        {},
      ),
    ];
    const caught = captureError(() => assembleCatalog(fragments, { generatedAt: GENERATED_AT }));
    expect(caught).toBeInstanceOf(CrawlError);
    if (caught instanceof CrawlError) {
      expect(caught.stage).toBe('normalize');
      expect(caught.message).toContain("duplicate source id 'hand-a'");
    }
  });

  it('gates the merged candidate: an over-cap summary fails at stage validate', () => {
    const fragments: readonly CatalogFragment[] = [
      makeFragment(
        makeSource('hand-a', 'https://www.cloudflare.com/products/a/', 'marketing-product', 'A'),
        {
          useCaseClaims: [
            {
              id: 'padded-case',
              name: 'Padded Case',
              summary: 'x'.repeat(501),
              sourceId: 'hand-a',
            },
          ],
        },
      ),
    ];
    const caught = captureError(() => assembleCatalog(fragments, { generatedAt: GENERATED_AT }));
    expect(caught).toBeInstanceOf(CrawlError);
    if (caught instanceof CrawlError) {
      expect(caught.stage).toBe('validate');
      expect(caught.message).toContain('useCases[0].summary');
      expect(caught.cause).toBeInstanceOf(CatalogValidationError);
    }
  });
});
