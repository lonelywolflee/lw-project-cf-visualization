import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { RouterLink } from '@angular/router';

import { familyGroups, sortedSolutions } from '../../core/catalog/catalog-selectors';
import { CatalogStore } from '../../core/catalog/catalog-store';

/**
 * Taxonomy overview: the official family hierarchy with product links,
 * the solution list, and a compact one-line summary. Rendered inside the
 * {@link CatalogShell} gate, so the catalog signal is present whenever this
 * component is on screen; the empty fallbacks below are type honesty, not a
 * reachable UI state.
 */
@Component({
  selector: 'app-catalog-overview',
  imports: [DatePipe, RouterLink],
  templateUrl: './catalog-overview.html',
  styleUrl: './catalog-overview.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CatalogOverview {
  protected readonly catalog = inject(CatalogStore).catalog;

  protected readonly groups = computed(() => {
    const catalog = this.catalog();
    return catalog === undefined ? [] : familyGroups(catalog);
  });

  protected readonly solutions = computed(() => {
    const catalog = this.catalog();
    return catalog === undefined ? [] : sortedSolutions(catalog);
  });
}
