import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import type { CatalogIssue } from '@cf-viz/catalog';

import { CatalogStore } from '../../core/catalog/catalog-store';
import { CuratedStore } from '../../core/catalog/curated-store';

/** Validation issues rendered before the list collapses into a count. */
const MAX_VISIBLE_ISSUES = 10;

/**
 * Layout gate for every catalog route. Renders the loading, fetch-error,
 * invalid-data, and empty states itself and only mounts the child
 * `<router-outlet>` once BOTH documents reached `success` — child routes
 * can therefore rely on {@link CatalogStore.catalog} and
 * {@link CuratedStore.curated} being present. Catalog states take priority
 * in the non-success rendering: the catalog is the primary document and
 * the curated dataset annotates it.
 */
@Component({
  selector: 'app-catalog-shell',
  imports: [RouterOutlet],
  templateUrl: './catalog-shell.html',
  styleUrl: './catalog-shell.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CatalogShell {
  protected readonly store = inject(CatalogStore);
  protected readonly curatedStore = inject(CuratedStore);

  /** The first {@link MAX_VISIBLE_ISSUES} catalog validation issues. */
  protected readonly visibleIssues = computed<readonly CatalogIssue[]>(() => {
    const state = this.store.state();
    return state.kind === 'invalid-data' ? state.issues.slice(0, MAX_VISIBLE_ISSUES) : [];
  });

  /** How many catalog validation issues are collapsed behind the cap. */
  protected readonly hiddenIssueCount = computed(() => {
    const state = this.store.state();
    return state.kind === 'invalid-data'
      ? Math.max(state.issues.length - MAX_VISIBLE_ISSUES, 0)
      : 0;
  });

  /** The first {@link MAX_VISIBLE_ISSUES} curated validation issues. */
  protected readonly curatedVisibleIssues = computed<readonly CatalogIssue[]>(() => {
    const state = this.curatedStore.state();
    return state.kind === 'invalid-data' ? state.issues.slice(0, MAX_VISIBLE_ISSUES) : [];
  });

  /** How many curated validation issues are collapsed behind the cap. */
  protected readonly curatedHiddenIssueCount = computed(() => {
    const state = this.curatedStore.state();
    return state.kind === 'invalid-data'
      ? Math.max(state.issues.length - MAX_VISIBLE_ISSUES, 0)
      : 0;
  });
}
