import { describe, expect, it } from 'vitest';

import { collectCuratedReferenceIssues, type Catalog, type CuratedData } from './index.js';

function first<T>(items: readonly T[]): T {
  const item = items[0];
  if (item === undefined) {
    throw new Error('expected at least one item');
  }
  return item;
}

function buildCatalog(): Catalog {
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
        summary: 'Filters and blocks malicious HTTP traffic.',
        familyId: 'application-security',
        sourceIds: ['waf-product-page'],
      },
      {
        id: 'gateway',
        name: 'Gateway',
        summary: 'Filters outbound DNS and HTTP traffic for organizations.',
        familyId: 'application-security',
        sourceIds: ['waf-product-page'],
      },
    ],
    solutions: [
      {
        id: 'sase',
        name: 'Cloudflare One',
        summary: 'SASE platform combining network and security services.',
        sourceIds: ['waf-product-page'],
      },
    ],
    useCases: [],
    relationships: [],
  };
}

function buildCuratedData(): CuratedData {
  return {
    schemaVersion: '1',
    learningNotes: [],
    scenarios: [],
    products: [
      {
        productId: 'waf',
        roleKo: '웹 공격 패턴을 차단합니다.',
        placements: [{ lane: 'public-web', layer: 'application-security' }],
        sourceUrl: 'https://www.cloudflare.com/application-services/products/waf/',
        verifiedAt: '2026-07-14T00:00:00Z',
      },
    ],
    compositions: [
      {
        solutionId: 'sase',
        productIds: ['gateway', 'waf'],
        sourceUrl: 'https://www.cloudflare.com/cloudflare-one/',
        verifiedAt: '2026-07-14T00:00:00Z',
      },
    ],
    pricing: [
      {
        productId: 'waf',
        tiers: [{ id: 'free', name: 'Free', monthlyUsd: 0 }],
        sourceUrl: 'https://www.cloudflare.com/plans/',
        verifiedAt: '2026-07-14T00:00:00Z',
      },
    ],
  };
}

describe('collectCuratedReferenceIssues', () => {
  it('returns no issues when every reference resolves', () => {
    expect(collectCuratedReferenceIssues(buildCuratedData(), buildCatalog())).toEqual([]);
  });

  it('collects every unresolved reference across all collections at once', () => {
    const curated = buildCuratedData();
    const broken: CuratedData = {
      ...curated,
      products: [{ ...first(curated.products), productId: 'ghost-product' }],
      compositions: [
        {
          ...first(curated.compositions),
          solutionId: 'ghost-solution',
          productIds: ['waf', 'ghost-member'],
        },
      ],
      pricing: [{ ...first(curated.pricing), productId: 'ghost-priced' }],
      learningNotes: [
        {
          productId: 'ghost-note',
          whyKo: '이유.',
          misconceptionKo: '오해.',
          customerQuestionKo: '질문?',
          sourceUrl: 'https://www.cloudflare.com/products/',
          verifiedAt: '2026-07-15T00:00:00Z',
        },
      ],
      scenarios: [
        {
          // 'sase' is a solution id in buildCatalog — the shared ?lens=
          // namespace makes that collision a rejected reference issue.
          id: 'sase',
          titleKo: '충돌 시나리오',
          situationKo: '렌즈 네임스페이스가 겹칩니다.',
          productIds: ['waf', 'ghost-lens-member'],
          sourceUrl: 'https://www.cloudflare.com/products/',
          verifiedAt: '2026-07-15T00:00:00Z',
        },
      ],
    };
    expect(collectCuratedReferenceIssues(broken, buildCatalog())).toEqual([
      {
        code: 'unknown-entity-reference',
        path: 'products[0].productId',
        message: "Unknown products id 'ghost-product'",
      },
      {
        code: 'unknown-entity-reference',
        path: 'compositions[0].solutionId',
        message: "Unknown solutions id 'ghost-solution'",
      },
      {
        code: 'unknown-entity-reference',
        path: 'compositions[0].productIds[1]',
        message: "Unknown products id 'ghost-member'",
      },
      {
        code: 'unknown-entity-reference',
        path: 'pricing[0].productId',
        message: "Unknown products id 'ghost-priced'",
      },
      {
        code: 'unknown-entity-reference',
        path: 'learningNotes[0].productId',
        message: "Unknown products id 'ghost-note'",
      },
      {
        code: 'duplicate-id',
        path: 'scenarios[0].id',
        message: "Scenario id 'sase' collides with a solution id",
      },
      {
        code: 'unknown-entity-reference',
        path: 'scenarios[0].productIds[1]',
        message: "Unknown products id 'ghost-lens-member'",
      },
    ]);
  });
});
