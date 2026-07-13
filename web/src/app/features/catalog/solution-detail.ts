import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { RouterLink } from '@angular/router';

import { solutionDetail, toDetailState } from '../../core/catalog/catalog-selectors';
import { CatalogStore } from '../../core/catalog/catalog-store';

/**
 * Detail page for one solution. Mirrors {@link ProductDetail}: route param
 * bound to `solutionId`, gate-guaranteed catalog, in-page not-found.
 */
@Component({
  selector: 'app-solution-detail',
  imports: [DatePipe, RouterLink],
  templateUrl: './solution-detail.html',
  styleUrl: './detail.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SolutionDetail {
  readonly solutionId = input.required<string>();

  private readonly store = inject(CatalogStore);

  protected readonly view = computed(() =>
    toDetailState(this.store.catalog(), this.solutionId(), solutionDetail),
  );
}
