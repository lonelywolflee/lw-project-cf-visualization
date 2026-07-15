import type { Catalog, CuratedData } from '@cf-viz/catalog';

import { buildRecallPool, scoreRecall, suggestProducts } from './recall-session';

const source = {
  id: 'products-overview',
  url: 'https://www.cloudflare.com/products/',
  pageKind: 'marketing-overview',
  title: 'Our products',
  retrievedAt: '2026-07-14T00:00:00Z',
} as const;

function product(id: string, name: string): Catalog['products'][number] {
  return { id, name, summary: `${name} summary.`, familyId: 'security', sourceIds: [source.id] };
}

const catalog: Catalog = {
  schemaVersion: '1',
  generatedAt: '2026-07-14T00:00:00Z',
  sources: [source],
  productFamilies: [
    { id: 'security', name: 'Security', summary: 'Security products.', sourceIds: [source.id] },
  ],
  products: [
    product('waf', 'WAF'),
    product('bot-management', 'Bot Management'),
    product('rate-limiting', 'Rate Limiting'),
    product('ddos', 'DDoS Protection'),
    product('spectrum', 'Spectrum'),
    product('magic-transit', 'Magic Transit'),
    product('cdn', 'CDN'),
  ],
  solutions: [],
  useCases: [],
  relationships: [],
};

function placement(lane: 'public-web', layer: string): { lane: 'public-web'; layer: string } {
  return { lane, layer };
}

const curated = {
  schemaVersion: '1',
  learningNotes: [],
  scenarios: [],
  narration: [],
  products: [
    {
      productId: 'waf',
      roleKo: '역할.',
      placements: [placement('public-web', 'application-security')],
      sourceUrl: source.url,
      verifiedAt: '2026-07-14T00:00:00Z',
    },
    {
      productId: 'bot-management',
      roleKo: '역할.',
      placements: [placement('public-web', 'application-security')],
      sourceUrl: source.url,
      verifiedAt: '2026-07-14T00:00:00Z',
    },
    {
      productId: 'rate-limiting',
      roleKo: '역할.',
      placements: [placement('public-web', 'application-security')],
      sourceUrl: source.url,
      verifiedAt: '2026-07-14T00:00:00Z',
    },
    {
      // Multi-placement: correct in BOTH l3/l4 and application-security.
      productId: 'ddos',
      roleKo: '역할.',
      placements: [
        placement('public-web', 'network-l3-l4'),
        placement('public-web', 'application-security'),
      ],
      sourceUrl: source.url,
      verifiedAt: '2026-07-14T00:00:00Z',
    },
    {
      productId: 'spectrum',
      roleKo: '역할.',
      placements: [placement('public-web', 'network-l3-l4')],
      sourceUrl: source.url,
      verifiedAt: '2026-07-14T00:00:00Z',
    },
    {
      productId: 'magic-transit',
      roleKo: '역할.',
      placements: [placement('public-web', 'network-l3-l4')],
      sourceUrl: source.url,
      verifiedAt: '2026-07-14T00:00:00Z',
    },
    {
      productId: 'cdn',
      roleKo: '역할.',
      placements: [placement('public-web', 'application-performance')],
      sourceUrl: source.url,
      verifiedAt: '2026-07-14T00:00:00Z',
    },
  ],
  compositions: [],
  pricing: [],
} as unknown as CuratedData;

describe('buildRecallPool', () => {
  it('collects the area answers in deterministic name order', () => {
    const pool = buildRecallPool(catalog, curated, 'public-web', 'application-security');
    expect(pool.answers.map((chip) => chip.id)).toEqual([
      'bot-management',
      'ddos',
      'rate-limiting',
      'waf',
    ]);
    expect(buildRecallPool(catalog, curated, 'public-web', 'application-security')).toEqual(pool);
  });

  it('never uses a multi-placement correct answer as a decoy (approved rubric)', () => {
    // ddos lives in the adjacent l3/l4 layer too — it must NOT appear as a
    // decoy for application-security, where it is also a correct answer.
    const pool = buildRecallPool(catalog, curated, 'public-web', 'application-security');
    const decoyIds = pool.decoys.map((chip) => chip.id);
    expect(decoyIds).not.toContain('ddos');
    // Real decoys come from the adjacent layers (l3/l4 and performance).
    expect(decoyIds.length).toBeGreaterThanOrEqual(2);
    for (const id of decoyIds) {
      expect(['spectrum', 'magic-transit', 'cdn']).toContain(id);
    }
  });

  it('sizes the decoy pool at max(2, 30% of answers)', () => {
    const appSec = buildRecallPool(catalog, curated, 'public-web', 'application-security');
    // 4 answers → round(1.2) = 1 → floor at 2.
    expect(appSec.decoys).toHaveLength(2);
  });

  it('merges answers and decoys into one name-ordered chip list', () => {
    const pool = buildRecallPool(catalog, curated, 'public-web', 'application-security');
    const names = pool.chips.map((chip) => chip.name);
    expect(names).toEqual([...names].sort((a, b) => (a.toLowerCase() < b.toLowerCase() ? -1 : 1)));
    expect(pool.chips.length).toBe(pool.answers.length + pool.decoys.length);
  });
});

describe('scoreRecall', () => {
  const pool = buildRecallPool(catalog, curated, 'public-web', 'application-security');

  it('scores each answer slot by whether it was picked', () => {
    const score = scoreRecall(pool, new Set(['waf', 'ddos', 'cdn']));
    expect(score.totalSlots).toBe(4);
    expect(score.correctSlots).toBe(2); // waf + ddos; cdn is a wasted pick.
    expect(score.results.find((result) => result.productId === 'bot-management')?.correct).toBe(
      false,
    );
  });

  it('handles the empty submission and the perfect one', () => {
    expect(scoreRecall(pool, new Set()).correctSlots).toBe(0);
    expect(
      scoreRecall(pool, new Set(['waf', 'ddos', 'bot-management', 'rate-limiting'])).correctSlots,
    ).toBe(4);
  });
});

describe('suggestProducts', () => {
  it('opens only from three characters and matches case-insensitively', () => {
    expect(suggestProducts(catalog, 'wa', new Set())).toEqual([]);
    const hits = suggestProducts(catalog, 'WAF', new Set());
    expect(hits.map((chip) => chip.id)).toContain('waf');
  });

  it('excludes already-entered ids and respects the limit', () => {
    expect(suggestProducts(catalog, 'waf', new Set(['waf'])).map((chip) => chip.id)).not.toContain(
      'waf',
    );
    const limited = suggestProducts(catalog, 'a', new Set(), 2);
    expect(limited).toEqual([]); // still gated by the 3-char rule
  });
});
