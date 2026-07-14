import type { CuratedPricing } from '@cf-viz/catalog';

import { parseScenario, serializeScenario } from './calculator-params';

const workersPricing: CuratedPricing = {
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
};

const pricingByProduct = new Map([['workers', workersPricing]]);

describe('parseScenario', () => {
  it('round-trips a serialized scenario', () => {
    const scenario = {
      products: ['workers'],
      tiers: { workers: 'paid' },
      usage: { workers: { requests: 11_500_000 } },
    } as const;
    expect(parseScenario(serializeScenario(scenario), pricingByProduct)).toEqual(scenario);
  });

  it('drops unknown products, tiers, and metrics instead of throwing', () => {
    const scenario = parseScenario(
      {
        products: 'workers,ghost,workers',
        't.workers': 'platinum',
        't.ghost': 'free',
        'u.workers.neurons': '5',
        'u.ghost.requests': '5',
      },
      pricingByProduct,
    );
    expect(scenario).toEqual({ products: ['workers'], tiers: {}, usage: {} });
  });

  it('drops non-finite, non-numeric, and non-positive usage values', () => {
    const scenario = parseScenario(
      {
        products: 'workers',
        'u.workers.requests': 'abc',
      },
      pricingByProduct,
    );
    expect(scenario.usage).toEqual({});
    expect(
      parseScenario({ products: 'workers', 'u.workers.requests': '-3' }, pricingByProduct).usage,
    ).toEqual({});
  });

  it('takes the first value of a repeated param', () => {
    const scenario = parseScenario(
      { products: ['workers', 'ghost'], 'u.workers.requests': ['12000000', '1'] },
      pricingByProduct,
    );
    expect(scenario.usage['workers']?.['requests']).toBe(12_000_000);
  });

  it('serializes the empty scenario to no params at all', () => {
    expect(serializeScenario({ products: [], tiers: {}, usage: {} })).toEqual({});
  });
});
