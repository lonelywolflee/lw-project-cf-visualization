import type { CuratedPricing } from '@cf-viz/catalog';
import type { Params } from '@angular/router';

import { firstParamValue } from '../../core/routing/query-params';
import { usageMetricsOf } from './pricing-math';

/**
 * URL scheme of a shareable calculator scenario:
 *
 *   products=workers,r2          selected products (comma list)
 *   t.workers=paid               chosen tier per product
 *   u.workers.requests=11500000  usage per product and metric
 *
 * Parsing is strictly validating: unknown products, tiers, and metrics and
 * non-finite or negative numbers are dropped, never thrown — a hostile URL
 * degrades to the empty scenario.
 */
export interface CalculatorScenario {
  readonly products: readonly string[];
  /** productId → tierId, only for explicit (valid) choices. */
  readonly tiers: Readonly<Record<string, string>>;
  /** productId → metric → usage amount. */
  readonly usage: Readonly<Record<string, Readonly<Record<string, number>>>>;
}

export const EMPTY_SCENARIO: CalculatorScenario = { products: [], tiers: {}, usage: {} };

export function parseScenario(
  params: Params,
  pricingByProduct: ReadonlyMap<string, CuratedPricing>,
): CalculatorScenario {
  const rawProducts = firstParamValue(params['products']) ?? '';
  const products = rawProducts
    .split(',')
    .map((id) => id.trim())
    .filter((id, index, all) => id !== '' && all.indexOf(id) === index)
    .filter((id) => pricingByProduct.has(id));

  const tiers: Record<string, string> = {};
  const usage: Record<string, Record<string, number>> = {};

  for (const [key, rawValue] of Object.entries(params)) {
    const value = firstParamValue(rawValue);
    if (value === undefined) continue;

    if (key.startsWith('t.')) {
      const productId = key.slice(2);
      const pricing = pricingByProduct.get(productId);
      if (
        products.includes(productId) &&
        pricing !== undefined &&
        pricing.tiers.some((tier) => tier.id === value)
      ) {
        tiers[productId] = value;
      }
      continue;
    }

    if (key.startsWith('u.')) {
      const [productId, metric] = key.slice(2).split('.');
      if (productId === undefined || metric === undefined) continue;
      const pricing = pricingByProduct.get(productId);
      if (!products.includes(productId) || pricing === undefined) continue;
      if (!usageMetricsOf(pricing).some((entry) => entry.metric === metric)) continue;
      const amount = Number(value);
      if (!Number.isFinite(amount) || amount <= 0) continue;
      usage[productId] = { ...usage[productId], [metric]: amount };
    }
  }

  return { products, tiers, usage };
}

/** The exact query params for a scenario; the URL always mirrors state. */
export function serializeScenario(scenario: CalculatorScenario): Params {
  if (scenario.products.length === 0) return {};
  const params: Params = { products: scenario.products.join(',') };
  for (const [productId, tierId] of Object.entries(scenario.tiers)) {
    params[`t.${productId}`] = tierId;
  }
  for (const [productId, metrics] of Object.entries(scenario.usage)) {
    for (const [metric, amount] of Object.entries(metrics)) {
      if (amount > 0) params[`u.${productId}.${metric}`] = String(amount);
    }
  }
  return params;
}
