import type { Catalog, CuratedData } from '@cf-viz/catalog';

import { buildMapModel, productPanel } from './map-selectors';

const source = {
  id: 'products-overview',
  url: 'https://www.cloudflare.com/products/',
  pageKind: 'marketing-overview',
  title: 'Our products',
  retrievedAt: '2026-07-14T00:00:00Z',
} as const;

const catalog: Catalog = {
  schemaVersion: '1',
  generatedAt: '2026-07-14T00:00:00Z',
  sources: [source],
  productFamilies: [
    { id: 'security', name: 'Security', summary: 'Security products.', sourceIds: [source.id] },
    { id: 'compute', name: 'Compute', summary: 'Compute products.', sourceIds: [source.id] },
    { id: 'storage', name: 'Storage', summary: 'Storage products.', sourceIds: [source.id] },
  ],
  products: [
    {
      id: 'waf',
      name: 'WAF',
      summary: 'Filters malicious HTTP traffic.',
      familyId: 'security',
      sourceIds: [source.id],
    },
    {
      id: 'ddos',
      name: 'DDoS Protection',
      summary: 'Absorbs volumetric attacks.',
      familyId: 'security',
      sourceIds: [source.id],
    },
    {
      id: 'workers',
      name: 'Workers',
      summary: 'Serverless compute at the edge.',
      familyId: 'compute',
      sourceIds: [source.id],
    },
    {
      id: 'r2',
      name: 'R2',
      summary: 'Egress-free object storage.',
      familyId: 'storage',
      sourceIds: [source.id],
    },
    {
      id: 'analytics',
      name: 'Analytics',
      summary: 'Traffic insights.',
      familyId: 'security',
      sourceIds: [source.id],
    },
    {
      id: 'access',
      name: 'Access',
      summary: 'Zero trust access to private resources.',
      familyId: 'security',
      sourceIds: [source.id],
    },
    {
      id: 'newcomer',
      name: 'Newcomer',
      summary: 'Not yet curated.',
      familyId: 'security',
      sourceIds: [source.id],
    },
  ],
  solutions: [],
  useCases: [],
  relationships: [],
};

const curated: CuratedData = {
  schemaVersion: '1',
  learningNotes: [],
  products: [
    {
      productId: 'waf',
      roleKo: '웹 공격 패턴을 차단합니다.',
      placements: [{ lane: 'public-web', layer: 'application-security' }],
      sourceUrl: 'https://www.cloudflare.com/application-services/products/waf/',
      verifiedAt: '2026-07-14T00:00:00Z',
    },
    {
      productId: 'ddos',
      roleKo: 'L3~L7 DDoS를 흡수합니다.',
      placements: [
        { lane: 'public-web', layer: 'network-l3-l4' },
        { lane: 'public-web', layer: 'application-security' },
      ],
      sourceUrl: 'https://www.cloudflare.com/products/',
      verifiedAt: '2026-07-14T00:00:00Z',
    },
    {
      productId: 'workers',
      roleKo: '엣지 서버리스 코드입니다.',
      placements: [{ lane: 'public-web', layer: 'compute-platform' }],
      sourceUrl: 'https://www.cloudflare.com/products/workers/',
      verifiedAt: '2026-07-14T00:00:00Z',
    },
    {
      productId: 'r2',
      roleKo: 'Egress 무료 스토리지입니다.',
      placements: [{ lane: 'public-web', layer: 'compute-platform' }],
      sourceUrl: 'https://www.cloudflare.com/products/',
      verifiedAt: '2026-07-14T00:00:00Z',
    },
    {
      productId: 'analytics',
      roleKo: '트래픽 지표를 보여줍니다.',
      placements: [{ lane: 'public-web', layer: 'observability' }],
      sourceUrl: 'https://www.cloudflare.com/products/',
      verifiedAt: '2026-07-14T00:00:00Z',
    },
    {
      productId: 'access',
      roleKo: '신원 기반 접근 제어입니다.',
      placements: [{ lane: 'zero-trust', layer: 'access-control' }],
      sourceUrl: 'https://www.cloudflare.com/products/',
      verifiedAt: '2026-07-14T00:00:00Z',
    },
    {
      productId: 'ghost-product',
      roleKo: '카탈로그에서 사라진 제품입니다.',
      placements: [{ lane: 'public-web', layer: 'application-security' }],
      sourceUrl: 'https://www.cloudflare.com/products/',
      verifiedAt: '2026-07-14T00:00:00Z',
    },
  ],
  compositions: [],
  pricing: [
    {
      productId: 'workers',
      tiers: [
        { id: 'free', name: 'Free', monthlyUsd: 0 },
        {
          id: 'paid',
          name: 'Paid',
          monthlyUsd: 5,
          meters: [
            {
              metric: 'requests',
              included: 10_000_000,
              per: 'month',
              overage: { usd: 0.3, perUnits: 1_000_000 },
            },
          ],
        },
      ],
      sourceUrl: 'https://developers.cloudflare.com/workers/platform/pricing/',
      verifiedAt: '2026-07-14T00:00:00Z',
    },
  ],
};

describe('buildMapModel', () => {
  const model = buildMapModel(catalog, curated);

  it('renders lanes and layers in contract order with sorted chips', () => {
    expect(model.lanes.map((lane) => lane.lane)).toEqual(['public-web', 'zero-trust']);
    const publicWeb = model.lanes[0];
    expect(publicWeb?.layers.map((layer) => layer.layer)).toEqual([
      'dns-connectivity',
      'network-l3-l4',
      'application-security',
      'application-performance',
      'compute-platform',
      'observability',
    ]);
    const appSec = publicWeb?.layers.find((layer) => layer.layer === 'application-security');
    expect(appSec?.products.map((chip) => chip.id)).toEqual(['ddos', 'waf']);
  });

  it('places multi-placement products on every one of their layers', () => {
    const publicWeb = model.lanes[0];
    const l3 = publicWeb?.layers.find((layer) => layer.layer === 'network-l3-l4');
    const appSec = publicWeb?.layers.find((layer) => layer.layer === 'application-security');
    expect(l3?.products.map((chip) => chip.id)).toContain('ddos');
    expect(appSec?.products.map((chip) => chip.id)).toContain('ddos');
  });

  it('groups the compute band by family and flags it as origin bypass', () => {
    const compute = model.lanes[0]?.layers.find((layer) => layer.layer === 'compute-platform');
    expect(compute?.originBypass).toBe(true);
    expect(compute?.groups?.map((group) => group.familyName)).toEqual(['Compute', 'Storage']);
    expect(compute?.groups?.[0]?.products.map((chip) => chip.id)).toEqual(['workers']);
    const appSec = model.lanes[0]?.layers.find((layer) => layer.layer === 'application-security');
    expect(appSec?.groups).toBeNull();
  });

  it('marks observability as the off-path layer', () => {
    const observability = model.lanes[0]?.layers.find((layer) => layer.layer === 'observability');
    expect(observability?.offPath).toBe(true);
    expect(observability?.products.map((chip) => chip.id)).toEqual(['analytics']);
  });

  it('collects catalog products without curated placement as unplaced', () => {
    expect(model.unplaced.map((chip) => chip.id)).toEqual(['newcomer']);
    expect(model.placedCount).toBe(6);
  });

  it('ignores curated entries whose product id is missing from the catalog', () => {
    const allChipIds = model.lanes
      .flatMap((lane) => lane.layers)
      .flatMap((layer) => layer.products)
      .map((chip) => chip.id);
    expect(allChipIds).not.toContain('ghost-product');
  });
});

describe('productPanel', () => {
  it('joins catalog, curated, and pricing for a fully covered product', () => {
    const panel = productPanel(catalog, curated, 'workers');
    expect(panel?.product.name).toBe('Workers');
    expect(panel?.familyName).toBe('Compute');
    expect(panel?.roleKo).toBe('엣지 서버리스 코드입니다.');
    expect(panel?.placementLabels).toEqual(['공개 웹 · 컴퓨팅']);
    expect(panel?.pricing?.tiers.map((tier) => tier.id)).toEqual(['free', 'paid']);
    expect(panel?.pricing?.sourceUrl).toContain('developers.cloudflare.com');
    expect(panel?.sources.map((link) => link.url)).toEqual([source.url]);
  });

  it('returns null curated fields for a product without curation', () => {
    const panel = productPanel(catalog, curated, 'newcomer');
    expect(panel?.roleKo).toBeNull();
    expect(panel?.placementLabels).toEqual([]);
    expect(panel?.pricing).toBeNull();
    expect(panel?.curatedSource).toBeNull();
  });

  it('returns pricing null for a placed but unpriced product', () => {
    const panel = productPanel(catalog, curated, 'waf');
    expect(panel?.roleKo).not.toBeNull();
    expect(panel?.pricing).toBeNull();
  });

  it('yields undefined for an unknown product id from the URL', () => {
    expect(productPanel(catalog, curated, 'does-not-exist')).toBeUndefined();
  });
});
