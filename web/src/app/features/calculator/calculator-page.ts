import { DatePipe, DecimalPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import type { CuratedPricing } from '@cf-viz/catalog';

import { CatalogStore } from '../../core/catalog/catalog-store';
import { CuratedStore } from '../../core/catalog/curated-store';
import { parseScenario, serializeScenario, type CalculatorScenario } from './calculator-params';
import {
  combineEstimates,
  defaultTierId,
  estimateProduct,
  usageMetricsOf,
  type CombinedEstimate,
  type TierEstimate,
  type UsageMetric,
} from './pricing-math';

/** One priced product offered by the picker. */
interface PricedProduct {
  readonly id: string;
  readonly name: string;
  readonly pricing: CuratedPricing;
  readonly metrics: readonly UsageMetric[];
}

/** One selected product's card: inputs, tier estimates, chosen tier. */
interface ProductCard {
  readonly product: PricedProduct;
  readonly usage: Readonly<Record<string, number>>;
  readonly tiers: readonly TierEstimate[];
  readonly selectedTierId: string;
}

/**
 * Usage-based cost calculator over the curated pricing meters. The whole
 * scenario — selected products, chosen tiers, entered usage — lives in the
 * URL (see calculator-params), so an estimate is shareable as a link and a
 * hostile URL degrades to an empty scenario. Only products with curated
 * pricing are offered; everything on screen is an estimate, never a quote.
 */
@Component({
  selector: 'app-calculator-page',
  imports: [DatePipe, DecimalPipe],
  templateUrl: './calculator-page.html',
  styleUrl: './calculator-page.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CalculatorPage {
  private readonly store = inject(CatalogStore);
  private readonly curatedStore = inject(CuratedStore);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  /** Raw query params as a signal (keys are dynamic, so no input binding). */
  private readonly queryParams = toSignal(this.route.queryParams, {
    initialValue: this.route.snapshot.queryParams,
  });

  /** Every product with curated pricing, in display order. */
  protected readonly pricedProducts = computed<readonly PricedProduct[]>(() => {
    const catalog = this.store.catalog();
    const curated = this.curatedStore.curated();
    if (catalog === undefined || curated === undefined) return [];
    const nameById = new Map(catalog.products.map((product) => [product.id, product.name]));
    return curated.pricing
      .flatMap((pricing): PricedProduct[] => {
        const name = nameById.get(pricing.productId);
        return name === undefined
          ? []
          : [{ id: pricing.productId, name, pricing, metrics: usageMetricsOf(pricing) }];
      })
      .sort((a, b) => (a.name.toLowerCase() < b.name.toLowerCase() ? -1 : 1));
  });

  protected readonly unpricedCount = computed(() => {
    const catalog = this.store.catalog();
    return catalog === undefined ? 0 : catalog.products.length - this.pricedProducts().length;
  });

  private readonly pricingById = computed<ReadonlyMap<string, CuratedPricing>>(
    () => new Map(this.pricedProducts().map((product) => [product.id, product.pricing])),
  );

  protected readonly scenario = computed<CalculatorScenario>(() =>
    parseScenario(this.queryParams(), this.pricingById()),
  );

  /** Cards for every selected product, in selection order. */
  protected readonly cards = computed<readonly ProductCard[]>(() => {
    const scenario = this.scenario();
    const byId = new Map(this.pricedProducts().map((product) => [product.id, product]));
    return scenario.products.flatMap((productId): ProductCard[] => {
      const product = byId.get(productId);
      if (product === undefined) return [];
      const usage = scenario.usage[productId] ?? {};
      return [
        {
          product,
          usage,
          tiers: estimateProduct(product.pricing, usage).tiers,
          selectedTierId: scenario.tiers[productId] ?? defaultTierId(product.pricing),
        },
      ];
    });
  });

  protected readonly combined = computed<CombinedEstimate>(() =>
    combineEstimates(
      this.cards().map((card) => ({
        estimate: { productId: card.product.id, tiers: card.tiers },
        tierId: card.selectedTierId,
      })),
    ),
  );

  protected isSelected(productId: string): boolean {
    return this.scenario().products.includes(productId);
  }

  protected toggleProduct(productId: string): void {
    const scenario = this.scenario();
    const products = scenario.products.includes(productId)
      ? scenario.products.filter((id) => id !== productId)
      : [...scenario.products, productId];
    this.apply({ ...scenario, products });
  }

  protected setTier(productId: string, tierId: string): void {
    const scenario = this.scenario();
    this.apply({ ...scenario, tiers: { ...scenario.tiers, [productId]: tierId } });
  }

  protected onUsage(productId: string, metric: string, event: Event): void {
    const target = event.target;
    if (!(target instanceof HTMLInputElement)) return;
    const amount = Number(target.value);
    const scenario = this.scenario();
    const forProduct = { ...scenario.usage[productId] };
    if (Number.isFinite(amount) && amount > 0) {
      forProduct[metric] = amount;
    } else {
      delete forProduct[metric];
    }
    this.apply(
      { ...scenario, usage: { ...scenario.usage, [productId]: forProduct } },
      { replaceUrl: true },
    );
  }

  protected usageValue(card: ProductCard, metric: string): number {
    return card.usage[metric] ?? 0;
  }

  /** Serializes the scenario; parseScenario re-validates on the way back. */
  private apply(scenario: CalculatorScenario, options?: { replaceUrl?: boolean }): void {
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams:
        scenario.products.length === 0 ? {} : serializeScenario(this.normalize(scenario)),
      replaceUrl: options?.replaceUrl ?? false,
    });
  }

  /** Drops tier/usage entries for products no longer selected. */
  private normalize(scenario: CalculatorScenario): CalculatorScenario {
    const selected = new Set(scenario.products);
    return {
      products: scenario.products,
      tiers: Object.fromEntries(
        Object.entries(scenario.tiers).filter(([productId]) => selected.has(productId)),
      ),
      usage: Object.fromEntries(
        Object.entries(scenario.usage).filter(([productId]) => selected.has(productId)),
      ),
    };
  }
}
