import { DatePipe, DecimalPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, input } from '@angular/core';

import type { ProductPanelView } from './map-selectors';

/**
 * Detail card for one selected product: Korean role line (falling back to
 * the official English summary), placements, verified pricing tiers, and
 * official source links. Pure presentation over a {@link ProductPanelView};
 * pages own the surrounding container, empty-selection hint, and any
 * page-specific extra sections. Styles are self-contained (own custom
 * properties) so the panel renders identically on every page that embeds
 * it.
 */
@Component({
  selector: 'app-product-panel',
  imports: [DatePipe, DecimalPipe],
  templateUrl: './product-panel.html',
  styleUrl: './product-panel.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ProductPanel {
  readonly view = input.required<ProductPanelView>();
}
