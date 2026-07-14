import { describe, expect, it } from 'vitest';

import type { Catalog, CuratedData } from '@cf-viz/catalog';

import { buildCuratedArtifact, normalizeCuratedData } from './curated-build.js';

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
        id: 'gateway',
        name: 'Gateway',
        summary: 'Filters outbound DNS and HTTP traffic for organizations.',
        familyId: 'application-security',
        sourceIds: ['waf-product-page'],
      },
      {
        id: 'waf',
        name: 'Web Application Firewall',
        summary: 'Filters and blocks malicious HTTP traffic.',
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
    narration: [],
    products: [
      {
        productId: 'waf',
        roleKo: '웹 공격 패턴을 차단합니다.',
        placements: [
          { lane: 'zero-trust', layer: 'access-control' },
          { lane: 'public-web', layer: 'application-security' },
        ],
        sourceUrl: 'https://www.cloudflare.com/application-services/products/waf/',
        verifiedAt: '2026-07-14T00:00:00Z',
      },
      {
        productId: 'gateway',
        roleKo: '아웃바운드 트래픽을 필터링합니다.',
        placements: [{ lane: 'zero-trust', layer: 'access-control' }],
        sourceUrl: 'https://www.cloudflare.com/zero-trust/products/gateway/',
        verifiedAt: '2026-07-14T00:00:00Z',
      },
    ],
    compositions: [
      {
        solutionId: 'sase',
        productIds: ['waf', 'gateway'],
        sourceUrl: 'https://www.cloudflare.com/sase/',
        verifiedAt: '2026-07-14T00:00:00Z',
      },
    ],
    pricing: [
      {
        productId: 'waf',
        tiers: [
          { id: 'paid', name: 'Paid', monthlyUsd: 5 },
          {
            id: 'free',
            name: 'Free',
            monthlyUsd: 0,
            noteKo: '기본 제공',
            featuresKo: ['무료 관리형 룰셋'],
            limits: [{ metric: 'custom-rules', included: 5, labelKo: '커스텀 룰' }],
            meters: [
              {
                metric: 'requests',
                included: 0,
                per: 'month',
                overage: { usd: 0.3, perUnits: 1_000_000 },
              },
            ],
          },
        ],
        sourceUrl: 'https://www.cloudflare.com/plans/',
        verifiedAt: '2026-07-14T00:00:00Z',
      },
    ],
  };
}

describe('normalizeCuratedData', () => {
  it('sorts collections by entry id and inner order-free arrays, keeping tier order', () => {
    const normalized = normalizeCuratedData(buildCuratedData());
    expect(normalized.products.map((product) => product.productId)).toEqual(['gateway', 'waf']);
    expect(normalized.products[1]?.placements).toEqual([
      { lane: 'public-web', layer: 'application-security' },
      { lane: 'zero-trust', layer: 'access-control' },
    ]);
    expect(normalized.compositions[0]?.productIds).toEqual(['gateway', 'waf']);
    // Tier order is authored meaning (Free → Paid progression) — untouched.
    expect(normalized.pricing[0]?.tiers.map((tier) => tier.id)).toEqual(['paid', 'free']);
  });

  it('preserves every optional pricing field', () => {
    const normalized = normalizeCuratedData(buildCuratedData());
    const free = normalized.pricing[0]?.tiers[1];
    expect(free?.noteKo).toBe('기본 제공');
    expect(free?.featuresKo).toEqual(['무료 관리형 룰셋']);
    expect(free?.limits).toEqual([{ metric: 'custom-rules', included: 5, labelKo: '커스텀 룰' }]);
    expect(free?.meters).toEqual([
      { metric: 'requests', included: 0, per: 'month', overage: { usd: 0.3, perUnits: 1_000_000 } },
    ]);
  });

  it('sorts scenarios by id and their members by product id', () => {
    const base = buildCuratedData();
    const normalized = normalizeCuratedData({
      ...base,
      scenarios: [
        {
          id: 'vpn-replacement',
          titleKo: 'VPN 대체',
          situationKo: '신원 기반 접근으로 옮깁니다.',
          talkTrackKo: '헬프데스크 티켓 수로 시작하세요.',
          productIds: ['gateway', 'access'],
          sourceUrl: 'https://www.cloudflare.com/sase/',
          verifiedAt: '2026-07-15T00:00:00Z',
        },
        {
          id: 'api-abuse-defense',
          titleKo: 'API 남용 방어',
          situationKo: '정상처럼 보이는 남용을 거릅니다.',
          productIds: ['waf', 'api-shield'],
          sourceUrl: 'https://developers.cloudflare.com/api-shield/',
          verifiedAt: '2026-07-15T00:00:00Z',
        },
      ],
    });
    expect(normalized.scenarios.map((scenario) => scenario.id)).toEqual([
      'api-abuse-defense',
      'vpn-replacement',
    ]);
    expect(normalized.scenarios[0]?.productIds).toEqual(['api-shield', 'waf']);
    expect(normalized.scenarios[1]?.talkTrackKo).toBe('헬프데스크 티켓 수로 시작하세요.');
  });

  it('keeps narration in authored order — the array order is the journey', () => {
    const base = buildCuratedData();
    const normalized = normalizeCuratedData({
      ...base,
      narration: [
        {
          productId: 'waf',
          captionKo: '요청의 내용을 엽니다.',
          sourceUrl: 'https://www.cloudflare.com/application-services/products/waf/',
          verifiedAt: '2026-07-15T00:00:00Z',
        },
        {
          // Alphabetically before 'waf' — must still render second.
          productId: 'gateway',
          captionKo: '나가는 트래픽을 거릅니다.',
          sourceUrl: 'https://www.cloudflare.com/zero-trust/products/gateway/',
          verifiedAt: '2026-07-15T00:00:00Z',
        },
      ],
    });
    expect(normalized.narration.map((stop) => stop.productId)).toEqual(['waf', 'gateway']);
  });

  it('is idempotent', () => {
    const once = normalizeCuratedData(buildCuratedData());
    expect(normalizeCuratedData(once)).toEqual(once);
  });
});

describe('buildCuratedArtifact', () => {
  it('produces identical bytes regardless of author key order and entry order', () => {
    const canonical = buildCuratedArtifact(buildCuratedData(), buildCatalog());
    // Same document, keys and arrays deliberately scrambled.
    const scrambled: unknown = JSON.parse(
      JSON.stringify({
        pricing: buildCuratedData().pricing.map((entry) => ({
          verifiedAt: entry.verifiedAt,
          sourceUrl: entry.sourceUrl,
          tiers: entry.tiers,
          productId: entry.productId,
        })),
        compositions: buildCuratedData().compositions.map((entry) => ({
          productIds: [...entry.productIds].reverse(),
          verifiedAt: entry.verifiedAt,
          solutionId: entry.solutionId,
          sourceUrl: entry.sourceUrl,
        })),
        products: [...buildCuratedData().products].reverse().map((entry) => ({
          verifiedAt: entry.verifiedAt,
          sourceUrl: entry.sourceUrl,
          roleKo: entry.roleKo,
          placements: [...entry.placements].reverse(),
          productId: entry.productId,
        })),
        learningNotes: [],
        scenarios: [],
        narration: [],
        schemaVersion: '1',
      }),
    );
    const rebuilt = buildCuratedArtifact(scrambled, buildCatalog());
    expect(canonical.success).toBe(true);
    expect(rebuilt.success).toBe(true);
    if (canonical.success && rebuilt.success) {
      expect(rebuilt.body).toBe(canonical.body);
      expect(canonical.body.endsWith('\n')).toBe(true);
    }
  });

  it('is byte-identical across repeated builds', () => {
    const first = buildCuratedArtifact(buildCuratedData(), buildCatalog());
    const second = buildCuratedArtifact(buildCuratedData(), buildCatalog());
    expect(first.success && second.success && first.body === second.body).toBe(true);
  });

  it('returns shape issues for an invalid source document', () => {
    const result = buildCuratedArtifact({ schemaVersion: '1' }, buildCatalog());
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.issues.every((issue) => issue.code === 'invalid-shape')).toBe(true);
    }
  });

  it('returns reference issues when the source cites unknown catalog ids', () => {
    const curated = buildCuratedData();
    const result = buildCuratedArtifact(
      {
        ...curated,
        compositions: [{ ...curated.compositions[0], productIds: ['ghost'] }],
      },
      buildCatalog(),
    );
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.issues).toEqual([
        {
          code: 'unknown-entity-reference',
          path: 'compositions[0].productIds[0]',
          message: "Unknown products id 'ghost'",
        },
      ]);
    }
  });
});
