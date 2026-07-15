import { describe, expect, it } from 'vitest';

import { safeParseCatalog, type Catalog, type CatalogIssue } from './index.js';

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

function expectIssues(input: unknown): readonly CatalogIssue[] {
  const result = safeParseCatalog(input);
  expect(result.success).toBe(false);
  if (result.success) {
    throw new Error('expected validation to fail');
  }
  return result.issues;
}

describe('catalog referential integrity', () => {
  it('accepts the sound minimal catalog', () => {
    const result = safeParseCatalog(buildValidCatalog());
    expect(result.success).toBe(true);
  });

  it('rejects duplicate ids within one collection, pointing at the second occurrence', () => {
    const catalog = buildValidCatalog();
    catalog.products.push({ ...first(catalog.products), name: 'WAF copy' });
    const issues = expectIssues(catalog);
    expect(issues).toEqual([
      { code: 'duplicate-id', path: 'products[1].id', message: expect.any(String) as string },
    ]);
  });

  it('allows the same id in different collections', () => {
    const catalog = buildValidCatalog();
    first(catalog.solutions).id = 'waf';
    catalog.relationships = [
      { type: 'product-solution', fromId: 'waf', toId: 'waf', sourceIds: ['waf-product-page'] },
    ];
    const result = safeParseCatalog(catalog);
    expect(result.success).toBe(true);
  });

  it('rejects references to unknown sources', () => {
    const catalog = buildValidCatalog();
    first(catalog.productFamilies).sourceIds = ['ghost-source'];
    const issues = expectIssues(catalog);
    expect(issues).toEqual([
      {
        code: 'unknown-source-reference',
        path: 'productFamilies[0].sourceIds[0]',
        message: expect.any(String) as string,
      },
    ]);
  });

  it('rejects a product with an unknown familyId', () => {
    const catalog = buildValidCatalog();
    first(catalog.products).familyId = 'ghost-family';
    const issues = expectIssues(catalog);
    expect(issues).toEqual([
      {
        code: 'unknown-entity-reference',
        path: 'products[0].familyId',
        message: expect.any(String) as string,
      },
    ]);
  });

  it('resolves relationship endpoints in the collection implied by the type', () => {
    const catalog = buildValidCatalog();
    // 'block-malicious-traffic' exists as a use case, but product-solution
    // requires the toId to be a SOLUTION — kind-scoped lookup must reject it.
    catalog.relationships = [
      {
        type: 'product-solution',
        fromId: 'waf',
        toId: 'block-malicious-traffic',
        sourceIds: ['waf-product-page'],
      },
    ];
    const issues = expectIssues(catalog);
    expect(issues).toEqual([
      {
        code: 'unknown-entity-reference',
        path: 'relationships[0].toId',
        message: expect.any(String) as string,
      },
    ]);
  });

  it('rejects a relationship with an unknown fromId', () => {
    const catalog = buildValidCatalog();
    catalog.relationships = [
      {
        type: 'product-use-case',
        fromId: 'ghost-product',
        toId: 'block-malicious-traffic',
        sourceIds: ['waf-docs'],
      },
    ];
    const issues = expectIssues(catalog);
    expect(issues).toEqual([
      {
        code: 'unknown-entity-reference',
        path: 'relationships[0].fromId',
        message: expect.any(String) as string,
      },
    ]);
  });

  it('rejects duplicate relationship edges even when their sources differ', () => {
    const catalog = buildValidCatalog();
    catalog.relationships.push({ ...first(catalog.relationships), sourceIds: ['waf-docs'] });
    const issues = expectIssues(catalog);
    expect(issues).toEqual([
      {
        code: 'duplicate-relationship',
        path: 'relationships[3]',
        message: expect.any(String) as string,
      },
    ]);
  });

  it('collects every integrity issue instead of failing fast', () => {
    const catalog = buildValidCatalog();
    first(catalog.products).familyId = 'ghost-family';
    first(catalog.useCases).sourceIds = ['ghost-source'];
    const issues = expectIssues(catalog);
    expect(issues).toHaveLength(2);
    const codes = issues.map((issue) => issue.code).sort();
    expect(codes).toEqual(['unknown-entity-reference', 'unknown-source-reference']);
  });

  it('skips integrity checks while the shape is invalid', () => {
    const catalog = buildValidCatalog();
    first(catalog.products).familyId = 'ghost-family';
    const doc: unknown = { ...catalog, schemaVersion: '999' };
    const issues = expectIssues(doc);
    expect(issues.every((issue) => issue.code === 'invalid-shape')).toBe(true);
  });
});
