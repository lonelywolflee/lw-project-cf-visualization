import type { Catalog, CuratedData } from '@cf-viz/catalog';

import {
  buildRecallPool,
  buildSolutionRecallPool,
  scoreRecall,
  suggestProducts,
} from './recall-session';

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
    product('r2', 'R2'),
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
  solutionNotes: [],
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
        placement('public-web', 'network-l4'),
        placement('public-web', 'application-security'),
      ],
      sourceUrl: source.url,
      verifiedAt: '2026-07-14T00:00:00Z',
    },
    {
      productId: 'spectrum',
      roleKo: '역할.',
      placements: [placement('public-web', 'network-l4')],
      sourceUrl: source.url,
      verifiedAt: '2026-07-14T00:00:00Z',
    },
    {
      productId: 'magic-transit',
      roleKo: '역할.',
      placements: [placement('public-web', 'network-l4')],
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

  it('suggests exact short names below the gate — two-letter products stay reachable', () => {
    // Typing the full short name (case-insensitive) is still retrieval.
    expect(suggestProducts(catalog, 'r2', new Set()).map((chip) => chip.id)).toEqual(['r2']);
    expect(suggestProducts(catalog, 'R2', new Set()).map((chip) => chip.id)).toEqual(['r2']);
    // But a two-letter fragment of a longer name never opens a list.
    expect(suggestProducts(catalog, 'ma', new Set())).toEqual([]);
  });

  it('matches word starts only — no letter fishing inside names', () => {
    // 'age' sits inside "Management" but starts no word — must not match.
    expect(suggestProducts(catalog, 'age', new Set())).toEqual([]);
    // 'man' starts the word "Management" — matches.
    expect(suggestProducts(catalog, 'man', new Set()).map((chip) => chip.id)).toContain(
      'bot-management',
    );
  });

  it('excludes already-entered ids and respects the limit', () => {
    expect(suggestProducts(catalog, 'waf', new Set(['waf'])).map((chip) => chip.id)).not.toContain(
      'waf',
    );
    const limited = suggestProducts(catalog, 'a', new Set(), 2);
    expect(limited).toEqual([]); // short fragment, no exact match
  });
});

describe('buildSolutionRecallPool', () => {
  const solutionCatalog: Catalog = {
    ...catalog,
    solutions: [
      { id: 'sase', name: 'Cloudflare One', summary: 'SASE.', sourceIds: [source.id] },
      { id: 'security', name: 'Security', summary: 'Inbound.', sourceIds: [source.id] },
      { id: 'retail', name: 'Retail', summary: 'Retail.', sourceIds: [source.id] },
    ],
  };
  const solutionCurated = {
    ...(curated as unknown as Record<string, unknown>),
    compositions: [
      {
        solutionId: 'sase',
        productIds: ['waf', 'cdn', 'ddos'],
        sourceUrl: source.url,
        verifiedAt: '2026-07-14T00:00:00Z',
      },
      {
        solutionId: 'security',
        productIds: ['waf', 'ddos'],
        sourceUrl: source.url,
        verifiedAt: '2026-07-14T00:00:00Z',
      },
      {
        solutionId: 'retail',
        productIds: ['cdn'],
        sourceUrl: source.url,
        verifiedAt: '2026-07-14T00:00:00Z',
      },
    ],
    solutionNotes: [
      {
        solutionId: 'sase',
        oneLinerKo: '정의.',
        whyKo: '왜.',
        misconceptionKo: '오해.',
        customerQuestionKo: '질문.',
        boundariesKo: [{ solutionId: 'security', noteKo: '방향 차이.' }],
        sourceUrl: source.url,
        verifiedAt: '2026-07-14T00:00:00Z',
      },
      {
        solutionId: 'retail',
        oneLinerKo: '정의.',
        whyKo: '왜.',
        misconceptionKo: '오해.',
        customerQuestionKo: '질문.',
        // One-directional storage: retail → sase. The sase session must
        // still see this pair (mirroring), and retail ∩ security is empty
        // so no question may exist for that pair anywhere.
        boundariesKo: [
          { solutionId: 'sase', noteKo: '상거래 특화.' },
          { solutionId: 'security', noteKo: '빈 교집합 경계.' },
        ],
        sourceUrl: source.url,
        verifiedAt: '2026-07-14T00:00:00Z',
      },
    ],
  } as unknown as CuratedData;

  it('builds ① answers from the composition and ③ from non-empty pairs, mirrored', () => {
    const pool = buildSolutionRecallPool(solutionCatalog, solutionCurated, 'sase');
    expect(pool?.answers.map((chip) => chip.id)).toEqual(['cdn', 'ddos', 'waf']);
    // Own boundary (security: waf+ddos shared) plus the mirrored retail
    // pair (cdn shared), neighbour-name order.
    expect(
      pool?.boundaryQuestions.map((question) => ({
        id: question.neighbourId,
        shared: question.answers.map((chip) => chip.id),
      })),
    ).toEqual([
      { id: 'retail', shared: ['cdn'] },
      { id: 'security', shared: ['ddos', 'waf'] },
    ]);
  });

  it('drops empty-intersection pairs and returns null without a composition', () => {
    // retail ↔ security is declared in a note but shares nothing — the
    // question must not exist (an unanswerable question is not a question).
    const pool = buildSolutionRecallPool(solutionCatalog, solutionCurated, 'security');
    expect(pool?.boundaryQuestions.map((question) => question.neighbourId)).toEqual(['sase']);
    expect(buildSolutionRecallPool(solutionCatalog, solutionCurated, 'ghost')).toBeNull();
    const uncomposed: Catalog = {
      ...solutionCatalog,
      solutions: [
        ...solutionCatalog.solutions,
        { id: 'bare', name: 'Bare', summary: 'No composition.', sourceIds: [source.id] },
      ],
    };
    expect(buildSolutionRecallPool(uncomposed, solutionCurated, 'bare')).toBeNull();
  });
});
