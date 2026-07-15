import type { CuratedPricing } from '@cf-viz/catalog';

import {
  combineEstimates,
  defaultTierId,
  estimateProduct,
  estimateTier,
  roundUsd,
  usageMetricsOf,
} from './pricing-math';

/** Workers-shaped fixture: a limits-only free tier and a metered paid tier. */
const workersPricing: CuratedPricing = {
  productId: 'workers',
  tiers: [
    {
      id: 'free',
      name: 'Free',
      monthlyUsd: 0,
      limits: [{ metric: 'requests', included: 100_000, per: 'day', labelKo: '요청 수' }],
    },
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
          labelKo: '요청 수',
        },
        {
          metric: 'cpu-ms',
          included: 30_000_000,
          per: 'month',
          overage: { usd: 0.02, perUnits: 1_000_000 },
          labelKo: 'CPU 시간(ms)',
        },
      ],
    },
    { id: 'enterprise', name: 'Enterprise', monthlyUsd: null },
  ],
  sourceUrl: 'https://developers.cloudflare.com/workers/platform/pricing/',
  verifiedAt: '2026-07-14T00:00:00Z',
};

describe('roundUsd', () => {
  it('rounds to whole cents half-up', () => {
    expect(roundUsd(0.4449)).toBe(0.44);
    expect(roundUsd(0.445)).toBe(0.45);
    expect(roundUsd(12)).toBe(12);
  });
});

describe('usageMetricsOf', () => {
  it('collects meter metrics across tiers, ignoring display-only limits', () => {
    expect(usageMetricsOf(workersPricing)).toEqual([
      { metric: 'requests', labelKo: '요청 수' },
      { metric: 'cpu-ms', labelKo: 'CPU 시간(ms)' },
    ]);
  });
});

describe('estimateTier', () => {
  const paid = workersPricing.tiers[1];
  if (paid === undefined) throw new Error('fixture must have a paid tier');

  it('is the base fee alone at zero usage', () => {
    const estimate = estimateTier(paid, {});
    expect(estimate.total).toBe(5);
    expect(estimate.meterCosts.every((line) => line.cost === 0)).toBe(true);
    expect(estimate.uncovered).toEqual([]);
  });

  it('bills nothing exactly at the included quota', () => {
    const estimate = estimateTier(paid, { requests: 10_000_000, 'cpu-ms': 30_000_000 });
    expect(estimate.meterCosts.map((line) => line.billable)).toEqual([0, 0]);
    expect(estimate.total).toBe(5);
  });

  it('prices fractional overage units pro-rata with cent rounding', () => {
    // 1.5M requests over quota at $0.30 per 1M = $0.45.
    const estimate = estimateTier(paid, { requests: 11_500_000 });
    expect(estimate.meterCosts[0]?.cost).toBe(0.45);
    expect(estimate.total).toBe(5.45);
  });

  it('sums the tier total from the rounded lines so displayed numbers add up', () => {
    // Each line rounds to a half-cent boundary: 0.005 → 0.01 twice.
    const estimate = estimateTier(paid, { requests: 10_016_667, 'cpu-ms': 30_250_000 });
    const lines = estimate.meterCosts.map((line) => line.cost);
    expect(lines[0]).toBe(0.01); // 16,667 / 1M × $0.30 = $0.0050001
    expect(lines[1]).toBe(0.01); // 250,000 / 1M × $0.02 = $0.005
    expect(estimate.total).toBe(roundUsd(5 + 0.01 + 0.01));
  });

  it('treats negative or missing usage as zero', () => {
    const estimate = estimateTier(paid, { requests: -5 });
    expect(estimate.meterCosts[0]?.usage).toBe(0);
    expect(estimate.total).toBe(5);
  });

  it('lists entered metrics the tier sells no overage for', () => {
    const free = workersPricing.tiers[0];
    if (free === undefined) throw new Error('fixture must have a free tier');
    const estimate = estimateTier(free, { requests: 30_000_000, 'cpu-ms': 0 });
    expect(estimate.uncovered).toEqual(['requests']);
    expect(estimate.total).toBe(0);
  });

  it('marks contact-sales tiers as not calculable', () => {
    const enterprise = workersPricing.tiers[2];
    if (enterprise === undefined) throw new Error('fixture must have an enterprise tier');
    const estimate = estimateTier(enterprise, { requests: 1 });
    expect(estimate.base).toBeNull();
    expect(estimate.total).toBeNull();
  });
});

describe('estimateProduct / defaultTierId / combineEstimates', () => {
  it('estimates every tier and defaults to the first metered tier', () => {
    const estimate = estimateProduct(workersPricing, { requests: 11_000_000 });
    expect(estimate.tiers.map((tier) => tier.tierId)).toEqual(['free', 'paid', 'enterprise']);
    expect(defaultTierId(workersPricing)).toBe('paid');
  });

  it('combines selected tiers and excludes contact-sales selections', () => {
    const workers = estimateProduct(workersPricing, { requests: 11_500_000 });
    const combined = combineEstimates([
      { estimate: workers, tierId: 'paid' },
      { estimate: workers, tierId: 'enterprise' },
    ]);
    expect(combined.total).toBe(5.45);
    expect(combined.excluded).toEqual(['workers']);
  });
});
