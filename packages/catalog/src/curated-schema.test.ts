import { describe, expect, it } from 'vitest';

import { safeParseCuratedData, type CuratedData } from './index.js';

function buildValidCuratedData(): CuratedData {
  return {
    schemaVersion: '1',
    learningNotes: [],
    scenarios: [],
    products: [
      {
        productId: 'waf',
        roleKo: 'SQL 주입·XSS 같은 웹 공격 패턴을 요청 단계에서 차단합니다.',
        placements: [{ lane: 'public-web', layer: 'application-security' }],
        sourceUrl: 'https://www.cloudflare.com/application-services/products/waf/',
        verifiedAt: '2026-07-14T00:00:00Z',
      },
      {
        productId: 'gateway',
        roleKo: '조직의 아웃바운드 트래픽을 DNS/HTTP 레벨에서 필터링합니다.',
        placements: [
          { lane: 'zero-trust', layer: 'access-control' },
          { lane: 'public-web', layer: 'dns-connectivity' },
        ],
        sourceUrl: 'https://www.cloudflare.com/zero-trust/products/gateway/',
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
        tiers: [
          {
            id: 'free',
            name: 'Free',
            monthlyUsd: 0,
            featuresKo: ['무료 관리형 룰셋'],
            limits: [{ metric: 'custom-rules', included: 5, labelKo: '커스텀 룰' }],
          },
          {
            id: 'paid',
            name: 'Paid',
            monthlyUsd: 5,
            limits: [{ metric: 'cpu-ms', included: 10, per: 'invocation', labelKo: 'CPU 시간' }],
            meters: [
              {
                metric: 'requests',
                included: 10_000_000,
                per: 'month',
                overage: { usd: 0.3, perUnits: 1_000_000 },
                labelKo: '요청 수',
              },
            ],
          },
          { id: 'enterprise', name: 'Enterprise', monthlyUsd: null, noteKo: '문의 기반 가격' },
        ],
        sourceUrl: 'https://www.cloudflare.com/plans/',
        verifiedAt: '2026-07-14T00:00:00Z',
      },
    ],
  };
}

function expectShapeIssue(input: unknown, path: string): void {
  const result = safeParseCuratedData(input);
  expect(result.success).toBe(false);
  if (result.success) {
    return;
  }
  expect(result.issues.map((issue) => issue.code)).toContain('invalid-shape');
  expect(result.issues.map((issue) => issue.path)).toContain(path);
}

describe('curatedDataSchema', () => {
  it('accepts a document with both lanes, multi-placement, and every pricing shape', () => {
    const result = safeParseCuratedData(buildValidCuratedData());
    expect(result.success).toBe(true);
  });

  it('accepts empty collections (curation grows incrementally)', () => {
    const result = safeParseCuratedData({
      schemaVersion: '1',
      learningNotes: [],
      scenarios: [],
      products: [],
      compositions: [],
      pricing: [],
    });
    expect(result.success).toBe(true);
  });

  it('accepts the off-path observability layer only in the public-web lane', () => {
    const data = buildValidCuratedData();
    const product = data.products[0];
    expect(
      safeParseCuratedData({
        ...data,
        products: [{ ...product, placements: [{ lane: 'public-web', layer: 'observability' }] }],
      }).success,
    ).toBe(true);
    expectShapeIssue(
      {
        ...data,
        products: [{ ...product, placements: [{ lane: 'zero-trust', layer: 'observability' }] }],
      },
      'products[0].placements[0].layer',
    );
  });

  it('rejects an unsupported schemaVersion', () => {
    expectShapeIssue({ ...buildValidCuratedData(), schemaVersion: '2' }, 'schemaVersion');
  });

  it('rejects unrecognized keys at the offending path', () => {
    expectShapeIssue({ ...buildValidCuratedData(), extra: true }, 'extra');
    const data = buildValidCuratedData();
    const tier = { ...data.pricing[0]?.tiers[0], yearlyUsd: 100 };
    expectShapeIssue(
      { ...data, pricing: [{ ...data.pricing[0], tiers: [tier] }] },
      'pricing[0].tiers[0].yearlyUsd',
    );
  });

  it('rejects a blank roleKo', () => {
    const data = buildValidCuratedData();
    expectShapeIssue(
      { ...data, products: [{ ...data.products[0], roleKo: '   ' }] },
      'products[0].roleKo',
    );
  });

  it('rejects empty and duplicate placements', () => {
    const data = buildValidCuratedData();
    expectShapeIssue(
      { ...data, products: [{ ...data.products[0], placements: [] }] },
      'products[0].placements',
    );
    const placement = { lane: 'public-web', layer: 'application-security' };
    expectShapeIssue(
      { ...data, products: [{ ...data.products[0], placements: [placement, placement] }] },
      'products[0].placements',
    );
  });

  it('rejects a layer that does not belong to its lane', () => {
    const data = buildValidCuratedData();
    expectShapeIssue(
      {
        ...data,
        products: [
          {
            ...data.products[0],
            placements: [{ lane: 'zero-trust', layer: 'application-security' }],
          },
        ],
      },
      'products[0].placements[0].layer',
    );
  });

  it('rejects a verifiedAt with a UTC offset instead of Z', () => {
    const data = buildValidCuratedData();
    expectShapeIssue(
      { ...data, products: [{ ...data.products[0], verifiedAt: '2026-07-14T09:00:00+09:00' }] },
      'products[0].verifiedAt',
    );
  });

  it('rejects a sourceUrl off the approved hosts or carrying a query', () => {
    const data = buildValidCuratedData();
    expectShapeIssue(
      { ...data, products: [{ ...data.products[0], sourceUrl: 'https://blog.cloudflare.com/x/' }] },
      'products[0].sourceUrl',
    );
    expectShapeIssue(
      {
        ...data,
        products: [
          { ...data.products[0], sourceUrl: 'https://www.cloudflare.com/plans/?utm_source=x' },
        ],
      },
      'products[0].sourceUrl',
    );
  });

  it('rejects empty and duplicate composition productIds', () => {
    const data = buildValidCuratedData();
    expectShapeIssue(
      { ...data, compositions: [{ ...data.compositions[0], productIds: [] }] },
      'compositions[0].productIds',
    );
    expectShapeIssue(
      { ...data, compositions: [{ ...data.compositions[0], productIds: ['waf', 'waf'] }] },
      'compositions[0].productIds',
    );
  });

  it('rejects a negative monthlyUsd', () => {
    const data = buildValidCuratedData();
    const tier = { ...data.pricing[0]?.tiers[0], monthlyUsd: -1 };
    expectShapeIssue(
      { ...data, pricing: [{ ...data.pricing[0], tiers: [tier] }] },
      'pricing[0].tiers[0].monthlyUsd',
    );
  });

  it('rejects duplicate tier ids within one product', () => {
    const data = buildValidCuratedData();
    const tier = { id: 'free', name: 'Free', monthlyUsd: 0 };
    expectShapeIssue(
      { ...data, pricing: [{ ...data.pricing[0], tiers: [tier, { ...tier, name: 'Free 2' }] }] },
      'pricing[0].tiers',
    );
  });

  it('rejects malformed meters: non-monthly period, zero perUnits, fractional perUnits', () => {
    const data = buildValidCuratedData();
    const buildTier = (meter: Record<string, unknown>): Record<string, unknown> => ({
      id: 'paid',
      name: 'Paid',
      monthlyUsd: 5,
      meters: [meter],
    });
    const meter = {
      metric: 'requests',
      included: 0,
      per: 'month',
      overage: { usd: 0.3, perUnits: 1_000_000 },
    };
    expectShapeIssue(
      { ...data, pricing: [{ ...data.pricing[0], tiers: [buildTier({ ...meter, per: 'day' })] }] },
      'pricing[0].tiers[0].meters[0].per',
    );
    expectShapeIssue(
      {
        ...data,
        pricing: [
          {
            ...data.pricing[0],
            tiers: [buildTier({ ...meter, overage: { usd: 0.3, perUnits: 0 } })],
          },
        ],
      },
      'pricing[0].tiers[0].meters[0].overage.perUnits',
    );
    expectShapeIssue(
      {
        ...data,
        pricing: [
          {
            ...data.pricing[0],
            tiers: [buildTier({ ...meter, overage: { usd: 0.3, perUnits: 1.5 } })],
          },
        ],
      },
      'pricing[0].tiers[0].meters[0].overage.perUnits',
    );
  });

  it('accepts a learning note with and without the optional fields', () => {
    const data = buildValidCuratedData();
    const note = {
      productId: 'waf',
      whyKo: '공격 패턴은 요청 단계에서 잡는 게 싸다.',
      misconceptionKo: '방화벽이라 네트워크 장비라고 오해한다.',
      customerQuestionKo: '"AWS WAF 이미 쓰는데요?"',
      sourceUrl: 'https://www.cloudflare.com/application-services/products/waf/',
      verifiedAt: '2026-07-15T00:00:00Z',
    };
    expect(safeParseCuratedData({ ...data, learningNotes: [note] }).success).toBe(true);
    expect(
      safeParseCuratedData({
        ...data,
        learningNotes: [
          { ...note, analogyKo: '공항 검색대.', seNoteKo: '룰셋 구조.', aeNoteKo: '딜 여는 법.' },
        ],
      }).success,
    ).toBe(true);
  });

  it('rejects a learning note with a blank required field or an unknown key', () => {
    const data = buildValidCuratedData();
    const note = {
      productId: 'waf',
      whyKo: ' ',
      misconceptionKo: '오해.',
      customerQuestionKo: '질문?',
      sourceUrl: 'https://www.cloudflare.com/application-services/products/waf/',
      verifiedAt: '2026-07-15T00:00:00Z',
    };
    expectShapeIssue({ ...data, learningNotes: [note] }, 'learningNotes[0].whyKo');
    expectShapeIssue(
      { ...data, learningNotes: [{ ...note, whyKo: '이유.', extra: true }] },
      'learningNotes[0].extra',
    );
  });

  it('accepts a scenario with and without the optional talk track', () => {
    const data = buildValidCuratedData();
    const scenario = {
      id: 'flash-sale-surge',
      titleKo: '이커머스 세일 폭주',
      situationKo: '정상 트래픽이 순간 폭주하는 상황입니다.',
      productIds: ['waiting-room', 'cdn'],
      sourceUrl: 'https://developers.cloudflare.com/waiting-room/',
      verifiedAt: '2026-07-15T00:00:00Z',
    };
    expect(safeParseCuratedData({ ...data, scenarios: [scenario] }).success).toBe(true);
    expect(
      safeParseCuratedData({
        ...data,
        scenarios: [{ ...scenario, talkTrackKo: '지난 피크 이벤트 경험을 물으세요.' }],
      }).success,
    ).toBe(true);
  });

  it('rejects a scenario with fewer than two members or duplicate members', () => {
    const data = buildValidCuratedData();
    const scenario = {
      id: 'flash-sale-surge',
      titleKo: '이커머스 세일 폭주',
      situationKo: '정상 트래픽이 순간 폭주하는 상황입니다.',
      productIds: ['waiting-room', 'cdn'],
      sourceUrl: 'https://developers.cloudflare.com/waiting-room/',
      verifiedAt: '2026-07-15T00:00:00Z',
    };
    expectShapeIssue(
      { ...data, scenarios: [{ ...scenario, productIds: ['waiting-room'] }] },
      'scenarios[0].productIds',
    );
    expectShapeIssue(
      { ...data, scenarios: [{ ...scenario, productIds: ['cdn', 'cdn'] }] },
      'scenarios[0].productIds',
    );
  });

  it('rejects non-finite numbers (programmatic input; JSON cannot carry them)', () => {
    const data = buildValidCuratedData();
    const tier = {
      id: 'paid',
      name: 'Paid',
      monthlyUsd: 5,
      meters: [
        {
          metric: 'requests',
          included: Number.POSITIVE_INFINITY,
          per: 'month',
          overage: { usd: 0.3, perUnits: 1_000_000 },
        },
      ],
    };
    expectShapeIssue(
      { ...data, pricing: [{ ...data.pricing[0], tiers: [tier] }] },
      'pricing[0].tiers[0].meters[0].included',
    );
  });
});
