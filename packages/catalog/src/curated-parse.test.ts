import { describe, expect, it } from 'vitest';

import {
  CatalogValidationError,
  parseCuratedData,
  safeParseCuratedData,
  type CuratedData,
} from './index.js';

function buildCuratedProduct(productId: string): CuratedData['products'][number] {
  return {
    productId,
    roleKo: '역할 설명입니다.',
    placements: [{ lane: 'public-web', layer: 'application-security' }],
    sourceUrl: 'https://www.cloudflare.com/application-services/products/waf/',
    verifiedAt: '2026-07-14T00:00:00Z',
  };
}

function buildValidCuratedData(): CuratedData {
  return {
    schemaVersion: '1',
    learningNotes: [],
    scenarios: [],
    products: [buildCuratedProduct('waf')],
    compositions: [
      {
        solutionId: 'sase',
        productIds: ['waf'],
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

describe('safeParseCuratedData', () => {
  it('returns the parsed document for valid input', () => {
    const input = buildValidCuratedData();
    const result = safeParseCuratedData(input);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual(input);
    }
  });

  it('aggregates every shape issue instead of stopping at the first', () => {
    const data = buildValidCuratedData();
    const result = safeParseCuratedData({
      ...data,
      products: [{ ...data.products[0], roleKo: '' }],
      pricing: [{ ...data.pricing[0], tiers: [] }],
    });
    expect(result.success).toBe(false);
    if (result.success) {
      return;
    }
    expect(result.issues.length).toBeGreaterThanOrEqual(2);
    expect(result.issues.every((issue) => issue.code === 'invalid-shape')).toBe(true);
    const paths = result.issues.map((issue) => issue.path);
    expect(paths).toContain('products[0].roleKo');
    expect(paths).toContain('pricing[0].tiers');
  });

  it('collects every duplicate-id issue across all collections', () => {
    const data = buildValidCuratedData();
    const scenario = {
      id: 'flash-sale-surge',
      titleKo: '세일 폭주',
      situationKo: '정상 트래픽이 순간 폭주합니다.',
      productIds: ['waf', 'gateway'],
      sourceUrl: 'https://www.cloudflare.com/products/',
      verifiedAt: '2026-07-15T00:00:00Z',
    };
    const result = safeParseCuratedData({
      ...data,
      products: [buildCuratedProduct('waf'), buildCuratedProduct('waf')],
      compositions: [...data.compositions, ...data.compositions],
      pricing: [...data.pricing, ...data.pricing],
      scenarios: [scenario, scenario],
    });
    expect(result.success).toBe(false);
    if (result.success) {
      return;
    }
    expect(result.issues).toEqual([
      {
        code: 'duplicate-id',
        path: 'products[1].productId',
        message: "Duplicate productId 'waf' in products",
      },
      {
        code: 'duplicate-id',
        path: 'compositions[1].solutionId',
        message: "Duplicate solutionId 'sase' in compositions",
      },
      {
        code: 'duplicate-id',
        path: 'pricing[1].productId',
        message: "Duplicate productId 'waf' in pricing",
      },
      {
        code: 'duplicate-id',
        path: 'scenarios[1].id',
        message: "Duplicate id 'flash-sale-surge' in scenarios",
      },
    ]);
  });
});

describe('parseCuratedData', () => {
  it('returns the parsed document for valid input', () => {
    expect(parseCuratedData(buildValidCuratedData())).toEqual(buildValidCuratedData());
  });

  it('throws a CatalogValidationError naming the curated subject', () => {
    let caught: unknown;
    try {
      parseCuratedData({ schemaVersion: '1' });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(CatalogValidationError);
    if (!(caught instanceof CatalogValidationError)) {
      return;
    }
    expect(caught.message).toMatch(/^Curated data validation failed with \d+ issue\(s\):/);
    expect(caught.issues.length).toBeGreaterThan(0);
  });
});
