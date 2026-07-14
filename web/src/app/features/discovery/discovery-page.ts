import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';

import { compareByNameThenId } from '../../core/catalog/catalog-selectors';
import { CatalogStore } from '../../core/catalog/catalog-store';
import {
  EMPTY_CRITERIA,
  firstParamValue,
  parseDiscoveryParams,
  searchCatalog,
  toDiscoveryQueryParams,
  type DiscoveryCriteria,
  type DiscoveryResults,
} from './discovery-selectors';

const NO_RESULTS: DiscoveryResults = { products: [], solutions: [], total: 0 };

/**
 * Search-and-filter page. The URL query string is the only state store:
 * `q`, `family`, `useCase` are bound to same-named inputs by
 * `withComponentInputBinding()` (query params participate in input binding
 * exactly like path params), and every control event writes the full
 * normalized criteria back via `Router.navigate`. Typing uses
 * `replaceUrl: true` so keystrokes do not spam history; discrete filter
 * changes push a history entry.
 *
 * Rendered inside the {@link CatalogShell} gate, so the catalog signal is
 * present whenever this is on screen; `NO_RESULTS` fallbacks are type
 * honesty for the instant before the gate settles.
 */
@Component({
  selector: 'app-discovery-page',
  imports: [RouterLink],
  templateUrl: './discovery-page.html',
  styleUrl: './discovery-page.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DiscoveryPage {
  /** Raw query params, bound by the router; undefined when absent. */
  readonly q = input<string | undefined>();
  readonly family = input<string | undefined>();
  readonly useCase = input<string | undefined>();

  private readonly store = inject(CatalogStore);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  protected readonly catalog = this.store.catalog;

  /**
   * Untrimmed search text for the input's `[value]` (trimming here would
   * fight the caret while typing trailing spaces). Repeated `?q=` params
   * arrive as an array despite the input's declared type; first one wins.
   */
  protected readonly qValue = computed(() => firstParamValue(this.q()) ?? '');

  /** Validated criteria; invalid ids are dropped, never thrown. */
  protected readonly criteria = computed<DiscoveryCriteria>(() => {
    const catalog = this.catalog();
    if (catalog === undefined) return EMPTY_CRITERIA;
    return parseDiscoveryParams(catalog, {
      q: this.q(),
      family: this.family(),
      useCase: this.useCase(),
    }).criteria;
  });

  protected readonly results = computed<DiscoveryResults>(() => {
    const catalog = this.catalog();
    return catalog === undefined ? NO_RESULTS : searchCatalog(catalog, this.criteria());
  });

  protected readonly families = computed(() => {
    const catalog = this.catalog();
    return catalog === undefined ? [] : [...catalog.productFamilies].sort(compareByNameThenId);
  });

  protected readonly useCases = computed(() => {
    const catalog = this.catalog();
    return catalog === undefined ? [] : [...catalog.useCases].sort(compareByNameThenId);
  });

  /** Display name for the active family filter chip. */
  protected readonly familyName = computed(() => {
    const id = this.criteria().familyId;
    return id === null ? null : (this.families().find((f) => f.id === id)?.name ?? id);
  });

  /** Display name for the active use case filter chip. */
  protected readonly useCaseName = computed(() => {
    const id = this.criteria().useCaseId;
    return id === null ? null : (this.useCases().find((u) => u.id === id)?.name ?? id);
  });

  protected readonly hasActiveCriteria = computed(() => {
    const criteria = this.criteria();
    return criteria.q !== '' || criteria.familyId !== null || criteria.useCaseId !== null;
  });

  protected onSearchInput(value: string): void {
    this.apply({ ...this.criteria(), q: value }, { replaceUrl: true });
  }

  protected onFamilyChange(value: string): void {
    this.apply({ ...this.criteria(), familyId: value === '' ? null : value });
  }

  protected onUseCaseChange(value: string): void {
    this.apply({ ...this.criteria(), useCaseId: value === '' ? null : value });
  }

  protected clearSearch(): void {
    this.apply({ ...this.criteria(), q: '' });
  }

  protected clearFamily(): void {
    this.apply({ ...this.criteria(), familyId: null });
  }

  protected clearUseCase(): void {
    this.apply({ ...this.criteria(), useCaseId: null });
  }

  protected clearAll(): void {
    this.apply(EMPTY_CRITERIA);
  }

  /**
   * Writes the full normalized criteria as the query string (no merge:
   * the URL always mirrors state, which also purges invalid params on the
   * next interaction).
   */
  private apply(criteria: DiscoveryCriteria, options?: { replaceUrl?: boolean }): void {
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: toDiscoveryQueryParams(criteria),
      replaceUrl: options?.replaceUrl ?? false,
    });
  }
}
