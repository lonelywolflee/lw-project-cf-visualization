import { DatePipe, DecimalPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';

import { CatalogStore } from '../../core/catalog/catalog-store';
import { CuratedStore } from '../../core/catalog/curated-store';
import { firstParamValue } from '../../core/routing/query-params';
import { buildMapModel, productPanel, type MapModel, type ProductPanelView } from './map-selectors';

/**
 * The home page: visitor → Cloudflare Edge → origin as a layered map, a
 * separate Zero Trust lane, and a detail side panel. The `product` query
 * param is the only selection state: it is bound by
 * `withComponentInputBinding()`, validated against the catalog (unknown
 * ids are dropped, never thrown), and every chip click writes it back via
 * `Router.navigate` — selecting is a discrete action, so it pushes
 * history and stays shareable.
 *
 * Rendered inside the {@link CatalogShell} gate, so both document signals
 * are present whenever this is on screen; the `undefined` fallbacks are
 * type honesty for the instant before the gate settles.
 */
@Component({
  selector: 'app-map-page',
  imports: [DatePipe, DecimalPipe],
  templateUrl: './map-page.html',
  styleUrl: './map-page.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MapPage {
  /** Raw `?product=` value, bound by the router; undefined when absent. */
  readonly product = input<string | undefined>();

  private readonly store = inject(CatalogStore);
  private readonly curatedStore = inject(CuratedStore);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  protected readonly model = computed<MapModel | undefined>(() => {
    const catalog = this.store.catalog();
    const curated = this.curatedStore.curated();
    return catalog !== undefined && curated !== undefined
      ? buildMapModel(catalog, curated)
      : undefined;
  });

  /** The validated selection; hostile or unknown ids collapse to null. */
  protected readonly selectedId = computed<string | null>(() => {
    const raw = firstParamValue(this.product());
    if (raw === undefined || raw === '') return null;
    const catalog = this.store.catalog();
    return catalog !== undefined && catalog.products.some((product) => product.id === raw)
      ? raw
      : null;
  });

  protected readonly panel = computed<ProductPanelView | null>(() => {
    const id = this.selectedId();
    const catalog = this.store.catalog();
    const curated = this.curatedStore.curated();
    if (id === null || catalog === undefined || curated === undefined) return null;
    return productPanel(catalog, curated, id) ?? null;
  });

  /** Chip click: select, or deselect when the chip is already active. */
  protected select(productId: string): void {
    const next = this.selectedId() === productId ? null : productId;
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: next === null ? {} : { product: next },
    });
  }
}
