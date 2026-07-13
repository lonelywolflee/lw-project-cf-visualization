import { describe, expect, it } from 'vitest';

import { safeParseCatalog, type Catalog } from './index.js';

function first<T>(items: readonly T[]): T {
  const item = items[0];
  if (item === undefined) {
    throw new Error('expected at least one item');
  }
  return item;
}

function buildValidCatalog(): Catalog {
  return {
    schemaVersion: '1',
    generatedAt: '2026-07-14T00:00:00Z',
    sources: [
      {
        id: 'waf-product-page',
        url: 'https://www.cloudflare.com/application-services/products/waf/',
        pageKind: 'marketing-product',
        title: 'Cloudflare Web Application Firewall',
        retrievedAt: '2026-07-14T00:00:00Z',
      },
      {
        id: 'waf-docs',
        url: 'https://developers.cloudflare.com/waf/',
        pageKind: 'developer-docs',
        title: 'Cloudflare WAF documentation',
        retrievedAt: '2026-07-14T00:00:00Z',
      },
    ],
    productFamilies: [
      {
        id: 'application-security',
        name: 'Application security',
        summary: 'Products that protect web applications and APIs at the edge.',
        sourceIds: ['waf-product-page'],
      },
    ],
    products: [
      {
        id: 'waf',
        name: 'Web Application Firewall',
        summary: 'Filters and blocks malicious HTTP traffic before it reaches an application.',
        familyId: 'application-security',
        sourceIds: ['waf-product-page', 'waf-docs'],
      },
    ],
    solutions: [
      {
        id: 'protect-web-applications',
        name: 'Protect web applications',
        summary: 'Defend public-facing web applications against common attacks.',
        sourceIds: ['waf-product-page'],
      },
    ],
    useCases: [
      {
        id: 'block-malicious-traffic',
        name: 'Block malicious traffic',
        summary: 'Stop injection, bot, and denial-of-service traffic at the edge.',
        sourceIds: ['waf-docs'],
      },
    ],
    relationships: [
      {
        type: 'product-solution',
        fromId: 'waf',
        toId: 'protect-web-applications',
        sourceIds: ['waf-product-page'],
      },
      {
        type: 'product-use-case',
        fromId: 'waf',
        toId: 'block-malicious-traffic',
        sourceIds: ['waf-docs'],
      },
      {
        type: 'solution-use-case',
        fromId: 'protect-web-applications',
        toId: 'block-malicious-traffic',
        sourceIds: ['waf-product-page'],
      },
    ],
  };
}

function expectSingleShapeIssue(input: unknown, path: string): void {
  const result = safeParseCatalog(input);
  expect(result.success).toBe(false);
  if (result.success) {
    throw new Error('expected validation to fail');
  }
  expect(result.issues).toHaveLength(1);
  expect(result.issues[0]).toMatchObject({ code: 'invalid-shape', path });
}

describe('catalogSchema shape validation', () => {
  it('accepts a minimal valid catalog and echoes the data unchanged', () => {
    const catalog = buildValidCatalog();
    const result = safeParseCatalog(catalog);
    expect(result.success).toBe(true);
    if (!result.success) {
      throw new Error('expected validation to succeed');
    }
    expect(result.data).toEqual(catalog);
  });

  it('rejects an unsupported schemaVersion', () => {
    const doc: unknown = { ...buildValidCatalog(), schemaVersion: '999' };
    expectSingleShapeIssue(doc, 'schemaVersion');
  });

  it('rejects a generatedAt with a timezone offset instead of Z', () => {
    const doc: unknown = { ...buildValidCatalog(), generatedAt: '2026-07-14T09:00:00+09:00' };
    expectSingleShapeIssue(doc, 'generatedAt');
  });

  it('rejects unknown top-level keys', () => {
    const doc: unknown = { ...buildValidCatalog(), unexpected: true };
    expectSingleShapeIssue(doc, 'unexpected');
  });

  it('rejects a whitespace-only product name', () => {
    const catalog = buildValidCatalog();
    first(catalog.products).name = '   ';
    expectSingleShapeIssue(catalog, 'products[0].name');
  });

  it('rejects an empty product summary', () => {
    const catalog = buildValidCatalog();
    first(catalog.products).summary = '';
    expectSingleShapeIssue(catalog, 'products[0].summary');
  });

  it('rejects an uppercase id slug', () => {
    const catalog = buildValidCatalog();
    first(catalog.solutions).id = 'Protect-Web-Applications';
    const result = safeParseCatalog(catalog);
    expect(result.success).toBe(false);
    if (result.success) {
      throw new Error('expected validation to fail');
    }
    expect(
      result.issues.some(
        (issue) => issue.code === 'invalid-shape' && issue.path === 'solutions[0].id',
      ),
    ).toBe(true);
  });

  it('rejects an http source URL', () => {
    const catalog = buildValidCatalog();
    first(catalog.sources).url = 'http://www.cloudflare.com/application-services/products/waf/';
    expectSingleShapeIssue(catalog, 'sources[0].url');
  });

  it('rejects a non-approved Cloudflare hostname', () => {
    const catalog = buildValidCatalog();
    first(catalog.sources).url = 'https://blog.cloudflare.com/waf/';
    expectSingleShapeIssue(catalog, 'sources[0].url');
  });

  it('rejects the apex cloudflare.com hostname (canonical form is www)', () => {
    const catalog = buildValidCatalog();
    first(catalog.sources).url = 'https://cloudflare.com/application-services/products/waf/';
    expectSingleShapeIssue(catalog, 'sources[0].url');
  });

  it('rejects a canonical URL with a query string', () => {
    const catalog = buildValidCatalog();
    first(catalog.sources).url = 'https://www.cloudflare.com/waf/?utm_source=x';
    expectSingleShapeIssue(catalog, 'sources[0].url');
  });

  it('rejects developer-docs sources hosted on the marketing hostname', () => {
    const catalog = buildValidCatalog();
    const source = first(catalog.sources);
    source.pageKind = 'developer-docs';
    expectSingleShapeIssue(catalog, 'sources[0].pageKind');
  });

  it('rejects marketing sources hosted on the docs hostname', () => {
    const catalog = buildValidCatalog();
    const docsSource = catalog.sources[1];
    if (docsSource === undefined) {
      throw new Error('expected a second source');
    }
    docsSource.pageKind = 'marketing-solution';
    expectSingleShapeIssue(catalog, 'sources[1].pageKind');
  });

  it('rejects an unsupported relationship type', () => {
    const catalog = buildValidCatalog();
    const doc: unknown = {
      ...catalog,
      relationships: [{ ...first(catalog.relationships), type: 'product-competitor' }],
    };
    expectSingleShapeIssue(doc, 'relationships[0].type');
  });

  it('rejects an entity without source references', () => {
    const catalog = buildValidCatalog();
    first(catalog.useCases).sourceIds = [];
    expectSingleShapeIssue(catalog, 'useCases[0].sourceIds');
  });

  it('rejects duplicate ids inside one sourceIds list', () => {
    const catalog = buildValidCatalog();
    first(catalog.productFamilies).sourceIds = ['waf-product-page', 'waf-product-page'];
    expectSingleShapeIssue(catalog, 'productFamilies[0].sourceIds');
  });

  it('rejects a retrievedAt without any timezone designator', () => {
    const catalog = buildValidCatalog();
    first(catalog.sources).retrievedAt = '2026-07-14T00:00:00';
    expectSingleShapeIssue(catalog, 'sources[0].retrievedAt');
  });
});
