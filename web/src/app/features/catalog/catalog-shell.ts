import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import type { CatalogIssue } from '@cf-viz/catalog';

import { CatalogStore } from '../../core/catalog/catalog-store';

/** Validation issues rendered before the list collapses into a count. */
const MAX_VISIBLE_ISSUES = 10;

/**
 * Layout gate for every catalog route. Renders the loading, fetch-error,
 * invalid-data, and empty states itself and only mounts the child
 * `<router-outlet>` once the catalog reached `success` — child routes can
 * therefore rely on {@link CatalogStore.catalog} being present.
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

  /** The first {@link MAX_VISIBLE_ISSUES} validation issues, if any. */
  protected readonly visibleIssues = computed<readonly CatalogIssue[]>(() => {
    const state = this.store.state();
    return state.kind === 'invalid-data' ? state.issues.slice(0, MAX_VISIBLE_ISSUES) : [];
  });

  /** How many validation issues are collapsed behind the cap. */
  protected readonly hiddenIssueCount = computed(() => {
    const state = this.store.state();
    return state.kind === 'invalid-data'
      ? Math.max(state.issues.length - MAX_VISIBLE_ISSUES, 0)
      : 0;
  });
}
