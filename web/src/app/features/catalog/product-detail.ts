import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { RouterLink } from '@angular/router';

import { productDetail, toDetailState } from '../../core/catalog/catalog-selectors';
import { CatalogStore } from '../../core/catalog/catalog-store';

/**
 * Detail page for one product. `productId` is bound from the route param by
 * `withComponentInputBinding()`. The shell gate guarantees the catalog is
 * loaded whenever this renders, so `pending` renders nothing (the gate's
 * load state is already on screen above the outlet position).
 */
@Component({
  selector: 'app-product-detail',
  imports: [DatePipe, RouterLink],
  templateUrl: './product-detail.html',
  styleUrl: './detail.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ProductDetail {
  readonly productId = input.required<string>();

  private readonly store = inject(CatalogStore);

  protected readonly view = computed(() =>
    toDetailState(this.store.catalog(), this.productId(), productDetail),
  );
}
