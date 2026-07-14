import type { CuratedPricing, PricingTier } from '@cf-viz/catalog';

/**
 * Pure cost estimation over curated pricing meters. No Angular, no I/O.
 *
 * Model: tier cost = monthlyUsd + Σ max(0, usage − included) / perUnits ×
 * overage.usd, computed linearly (pro-rata for partial billing units).
 *
 * Explicit rounding rule: every meter line is rounded to whole cents
 * (half-up) FIRST, and a tier total is the sum of its displayed lines plus
 * the base fee — so the numbers on screen always add up, at the price of
 * up to half a cent per line versus exact arithmetic. All values are USD;
 * these are estimates, never billing statements.
 */

/** Rounds a USD amount to whole cents, half-up. */
export function roundUsd(value: number): number {
  return Math.round(value * 100) / 100;
}

/** One usage metric a product accepts as calculator input. */
export interface UsageMetric {
  readonly metric: string;
  readonly labelKo: string;
}

/**
 * The union of meter metrics across every tier of one product, in first-
 * appearance order — these are the product's usage inputs. Metrics that
 * only appear as display limits are excluded: without an overage price
 * there is nothing to compute.
 */
export function usageMetricsOf(pricing: CuratedPricing): readonly UsageMetric[] {
  const seen = new Map<string, string>();
  for (const tier of pricing.tiers) {
    for (const meter of tier.meters ?? []) {
      if (!seen.has(meter.metric)) {
        seen.set(meter.metric, meter.labelKo ?? meter.metric);
      }
    }
  }
  return [...seen.entries()].map(([metric, labelKo]) => ({ metric, labelKo }));
}

/** Cost line for one metered metric of one tier. */
export interface MeterCost {
  readonly metric: string;
  readonly labelKo: string;
  readonly usage: number;
  readonly included: number;
  /** max(0, usage − included) — the billable amount. */
  readonly billable: number;
  /** Rounded USD for this line. */
  readonly cost: number;
}

/** Estimated monthly cost of one tier for the entered usage. */
export interface TierEstimate {
  readonly tierId: string;
  readonly tierName: string;
  /** Base monthly fee; null means contact-sales — not calculable. */
  readonly base: number | null;
  readonly meterCosts: readonly MeterCost[];
  /**
   * Metrics with usage > 0 that this tier sells no overage for (e.g. a
   * free tier without meters). The estimate ignores them, so the real
   * cost is "not available on this tier" rather than the number shown.
   */
  readonly uncovered: readonly string[];
  /** base + Σ meter line costs; null exactly when `base` is null. */
  readonly total: number | null;
}

/** Estimates one tier against usage keyed by metric (missing = 0). */
export function estimateTier(
  tier: PricingTier,
  usage: Readonly<Record<string, number>>,
): TierEstimate {
  const meters = tier.meters ?? [];
  const meterCosts = meters.map((meter): MeterCost => {
    const used = Math.max(0, usage[meter.metric] ?? 0);
    const billable = Math.max(0, used - meter.included);
    return {
      metric: meter.metric,
      labelKo: meter.labelKo ?? meter.metric,
      usage: used,
      included: meter.included,
      billable,
      cost: roundUsd((billable / meter.overage.perUnits) * meter.overage.usd),
    };
  });

  const metered = new Set(meters.map((meter) => meter.metric));
  const uncovered = Object.entries(usage)
    .filter(([metric, value]) => value > 0 && !metered.has(metric))
    .map(([metric]) => metric)
    .sort();

  const total =
    tier.monthlyUsd === null
      ? null
      : roundUsd(meterCosts.reduce((sum, line) => sum + line.cost, tier.monthlyUsd));

  return {
    tierId: tier.id,
    tierName: tier.name,
    base: tier.monthlyUsd,
    meterCosts,
    uncovered,
    total,
  };
}

/** All tier estimates of one product for the entered usage. */
export interface ProductEstimate {
  readonly productId: string;
  readonly tiers: readonly TierEstimate[];
}

export function estimateProduct(
  pricing: CuratedPricing,
  usage: Readonly<Record<string, number>>,
): ProductEstimate {
  return {
    productId: pricing.productId,
    tiers: pricing.tiers.map((tier) => estimateTier(tier, usage)),
  };
}

/**
 * The default tier the combined total starts from: the first tier that
 * sells overage (has meters) — a usage estimate is meaningless on a tier
 * that cannot absorb usage — falling back to the first tier.
 */
export function defaultTierId(pricing: CuratedPricing): string {
  const withMeters = pricing.tiers.find((tier) => (tier.meters ?? []).length > 0);
  return (withMeters ?? pricing.tiers[0])?.id ?? '';
}

/** Sum of the selected tiers across products. */
export interface CombinedEstimate {
  /** Rounded sum over every calculable selected tier. */
  readonly total: number;
  /** Product ids whose selected tier is contact-sales (excluded). */
  readonly excluded: readonly string[];
}

export function combineEstimates(
  selections: readonly { readonly estimate: ProductEstimate; readonly tierId: string }[],
): CombinedEstimate {
  let total = 0;
  const excluded: string[] = [];
  for (const { estimate, tierId } of selections) {
    const tier = estimate.tiers.find((candidate) => candidate.tierId === tierId);
    if (tier?.total == null) {
      excluded.push(estimate.productId);
    } else {
      total += tier.total;
    }
  }
  return { total: roundUsd(total), excluded };
}
