import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import type { CatalogIssue } from '@cf-viz/catalog';

import { CatalogStore } from '../../core/catalog/catalog-store';

/** Validation issues rendered before the list collapses into a count. */
const MAX_VISIBLE_ISSUES = 10;

/**
 * Route-level shell for the catalog feature. Renders one of the five data
 * states exposed by {@link CatalogStore}; later issues replace the success
 * summary with the real hierarchy/list UI.
 */
@Component({
  selector: 'app-catalog-shell',
  imports: [DatePipe],
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
