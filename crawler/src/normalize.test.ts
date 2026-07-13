import { readFileSync } from 'node:fs';

import type { SourcePageKind } from '@cf-viz/catalog';
import { describe, expect, it } from 'vitest';

import type { FetchResult } from './http-client.js';
import { CrawlError } from './errors.js';
import { normalizePage, type CatalogFragment } from './normalize.js';
import { parsePage, type ParsedPage } from './parse/index.js';

const RETRIEVED_AT = '2026-07-01T00:00:00.000Z';

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

/** parse → normalize one fixture, exactly as the real pipeline will. */
function normalizeFixture(
  fixtureName: string,
  sourceId: string,
  url: string,
  configuredKind: SourcePageKind,
): CatalogFragment {
  const page = parsePage(makeFetchResult(sourceId, url, fixture(fixtureName)), configuredKind);
  return normalizePage(page, configuredKind);
}

describe('normalizePage', () => {
  it('maps the products overview to family and product claims and no edges', () => {
    const fragment = normalizeFixture(
      'marketing-overview-products.html',
      'www-products-overview',
      'https://www.cloudflare.com/products/',
      'marketing-overview',
    );
    expect(fragment).toEqual({
      source: {
        id: 'www-products-overview',
        url: 'https://www.cloudflare.com/products/',
        pageKind: 'marketing-overview',
        title: 'Products | Cloudflare',
        retrievedAt: RETRIEVED_AT,
      },
      familyClaims: [
        { id: 'compute', name: 'Compute', sourceId: 'www-products-overview' },
        { id: 'sase-zero-trust', name: 'SASE / Zero Trust', sourceId: 'www-products-overview' },
        {
          id: 'application-performance',
          name: 'Application performance',
          sourceId: 'www-products-overview',
        },
      ],
      productClaims: [
        {
          key: '/products/workers',
          id: 'workers',
          name: 'Workers',
          summary: 'Global serverless functions',
          familyId: 'compute',
          sourceId: 'www-products-overview',
        },
        {
          key: '/products/pages',
          id: 'pages',
          name: 'Cloudflare Pages',
          summary: 'Build & deploy frontend sites',
          familyId: 'compute',
          sourceId: 'www-products-overview',
        },
        {
          key: '/products/access',
          id: 'access',
          name: 'Access',
          summary: 'Zero trust access to private resources',
          familyId: 'sase-zero-trust',
          sourceId: 'www-products-overview',
        },
        {
          // The tagline-less live-anomaly card claims summary null: the
          // overview states no display copy for it.
          key: '/products/ddos-for-web',
          id: 'ddos-for-web',
          name: 'DDoS for Web',
          summary: null,
          familyId: 'sase-zero-trust',
          sourceId: 'www-products-overview',
        },
        {
          key: '/products/cdn',
          id: 'cdn',
          name: 'CDN',
          summary: 'Ultra-fast static and dynamic content delivery',
          familyId: 'application-performance',
          sourceId: 'www-products-overview',
        },
      ],
      solutionClaims: [],
      useCaseClaims: [],
      edgeClaims: [],
      docsEntryClaims: [],
    });
  });

  it('maps the solutions overview to solution claims only', () => {
    const fragment = normalizeFixture(
      'marketing-overview-solutions.html',
      'www-solutions-overview',
      'https://www.cloudflare.com/solutions/',
      'marketing-overview',
    );
    expect(fragment).toEqual({
      source: {
        id: 'www-solutions-overview',
        url: 'https://www.cloudflare.com/solutions/',
        pageKind: 'marketing-overview',
        title: 'Solutions | Cloudflare',
        retrievedAt: RETRIEVED_AT,
      },
      familyClaims: [],
      productClaims: [],
      solutionClaims: [
        {
          key: '/solutions/ai',
          id: 'ai',
          name: 'AI',
          summary: 'Build intelligent applications with AI at the edge',
          sourceId: 'www-solutions-overview',
        },
        {
          key: '/solutions/frontends',
          id: 'frontends',
          name: 'Frontends',
          summary: 'Deploy frontend applications globally in seconds',
          sourceId: 'www-solutions-overview',
        },
      ],
      useCaseClaims: [],
      edgeClaims: [],
      docsEntryClaims: [],
    });
  });

  it('maps a product page to a nameless product claim, use cases, and edges', () => {
    const fragment = normalizeFixture(
      'marketing-product-cdn.html',
      'www-product-cdn',
      'https://www.cloudflare.com/products/cdn/',
      'marketing-product',
    );
    expect(fragment).toEqual({
      source: {
        id: 'www-product-cdn',
        url: 'https://www.cloudflare.com/products/cdn/',
        pageKind: 'marketing-product',
        title: 'Cloudflare CDN - Global Content Delivery Network',
        retrievedAt: RETRIEVED_AT,
      },
      familyClaims: [],
      productClaims: [
        {
          key: '/products/cdn',
          id: 'cdn',
          name: null,
          summary:
            'Make your site faster and stop paying for bandwidth. CDN caches content in 330+ cities worldwide with zero-configuration setup and predictable pricing.',
          familyId: null,
          sourceId: 'www-product-cdn',
        },
      ],
      solutionClaims: [],
      useCaseClaims: [
        {
          id: 'static-asset-acceleration',
          name: 'Static Asset Acceleration',
          summary:
            'Accelerating the delivery of static assets like images, CSS, and JavaScript to improve site speed and Core Web Vitals.',
          sourceId: 'www-product-cdn',
        },
        {
          id: 'api-response-caching',
          name: 'API Response Caching',
          summary: 'Caching anonymous API GET responses.',
          sourceId: 'www-product-cdn',
        },
      ],
      edgeClaims: [
        {
          type: 'product-use-case',
          fromId: 'cdn',
          toId: 'static-asset-acceleration',
          sourceId: 'www-product-cdn',
        },
        {
          type: 'product-use-case',
          fromId: 'cdn',
          toId: 'api-response-caching',
          sourceId: 'www-product-cdn',
        },
      ],
      docsEntryClaims: [],
    });
  });

  it('maps a solution page to a named solution claim, use cases, and edges', () => {
    const fragment = normalizeFixture(
      'marketing-solution-sase.html',
      'www-solution-sase',
      'https://www.cloudflare.com/sase/',
      'marketing-solution',
    );
    expect(fragment).toEqual({
      source: {
        id: 'www-solution-sase',
        url: 'https://www.cloudflare.com/sase/',
        pageKind: 'marketing-solution',
        title: 'Cloudflare One | The agile SASE platform | Cloudflare',
        retrievedAt: RETRIEVED_AT,
      },
      familyClaims: [],
      productClaims: [],
      solutionClaims: [
        {
          key: '/sase',
          id: 'sase',
          name: 'Cloudflare One',
          summary:
            'Connect and protect your workforce, AI agents, and infrastructure with Cloudflare One — the unified SASE platform built for safe AI adoption and zero trust access.',
          sourceId: 'www-solution-sase',
        },
      ],
      useCaseClaims: [
        {
          id: 'safely-adopt-ai',
          name: 'Safely adopt AI',
          summary: 'Move beyond AI blocking to securing AI adoption at scale.',
          sourceId: 'www-solution-sase',
        },
        {
          id: 'modernize-remote-access',
          name: 'Modernize remote access',
          summary: 'Stop relying on clunky, insecure VPNs.',
          sourceId: 'www-solution-sase',
        },
      ],
      edgeClaims: [
        {
          type: 'solution-use-case',
          fromId: 'sase',
          toId: 'safely-adopt-ai',
          sourceId: 'www-solution-sase',
        },
        {
          type: 'solution-use-case',
          fromId: 'sase',
          toId: 'modernize-remote-access',
          sourceId: 'www-solution-sase',
        },
      ],
      docsEntryClaims: [],
    });
  });

  it('maps the docs directory to slug-or-null entries and mints NO entities', () => {
    const fragment = normalizeFixture(
      'developer-docs-directory.html',
      'developers-docs-directory',
      'https://developers.cloudflare.com/directory/',
      'developer-docs',
    );
    expect(fragment).toEqual({
      source: {
        id: 'developers-docs-directory',
        url: 'https://developers.cloudflare.com/directory/',
        pageKind: 'developer-docs',
        title: 'Docs directory | Cloudflare Docs',
        retrievedAt: RETRIEVED_AT,
      },
      familyClaims: [],
      productClaims: [],
      solutionClaims: [],
      useCaseClaims: [],
      edgeClaims: [],
      docsEntryClaims: [
        // Single-segment hrefs carry their slug; the multi-segment
        // /cloudflare-one/email-security/ entry is a sub-page, not a product.
        { slug: 'workers', sourceId: 'developers-docs-directory' },
        { slug: 'cache', sourceId: 'developers-docs-directory' },
        { slug: null, sourceId: 'developers-docs-directory' },
      ],
    });
  });

  it('yields slug null for a card-shaped docs entry on an external host', () => {
    const page: ParsedPage = {
      kind: 'developer-docs',
      sourceId: 'developers-docs-directory',
      canonicalUrl: 'https://developers.cloudflare.com/directory/',
      title: 'Docs directory | Cloudflare Docs',
      description: 'Explore the different areas of our documentation site.',
      retrievedAt: RETRIEVED_AT,
      entries: [
        {
          name: 'Open Source',
          summary: 'Cloudflare projects on GitHub.',
          // Single path segment, but NOT developers.cloudflare.com: external
          // cards must never enrich product provenance.
          href: 'https://github.com/cloudflare',
        },
      ],
    };
    const fragment = normalizePage(page, 'developer-docs');
    expect(fragment.docsEntryClaims).toEqual([
      { slug: null, sourceId: 'developers-docs-directory' },
    ]);
  });

  it('errors at stage normalize on a relative docs entry href', () => {
    const page: ParsedPage = {
      kind: 'developer-docs',
      sourceId: 'developers-docs-directory',
      canonicalUrl: 'https://developers.cloudflare.com/directory/',
      title: 'Docs directory | Cloudflare Docs',
      description: 'Explore the different areas of our documentation site.',
      retrievedAt: RETRIEVED_AT,
      entries: [{ name: 'Workers', summary: 'Serverless platform docs.', href: '/workers/' }],
    };
    let caught: unknown;
    try {
      normalizePage(page, 'developer-docs');
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(CrawlError);
    if (caught instanceof CrawlError) {
      expect(caught.stage).toBe('normalize');
      expect(caught.url).toBe('https://developers.cloudflare.com/directory/');
      expect(caught.message).toContain('docs entry href is not an absolute URL');
    }
  });
});
