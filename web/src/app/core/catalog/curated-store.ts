import { HttpErrorResponse, httpResource } from '@angular/common/http';
import { Injectable, computed } from '@angular/core';
import { safeParseCuratedData, type CuratedData } from '@cf-viz/catalog';

import { CuratedInvalidDataError, type CuratedState } from './curated-state';

/** Single source of truth for the curated data artifact. */
export const CURATED_URL = '/data/curated.json';

/**
 * Data-access boundary for the curated dataset, mirroring
 * {@link CatalogStore}. Validates the document shape and internal
 * duplicates at the boundary; catalog cross-references are NOT re-checked
 * here — `pnpm validate:data` guarantees them for every committed artifact,
 * and the two documents load as independent resources. A curated entry
 * whose id no longer matches the catalog simply joins nothing in the
 * selectors (the product renders as unplaced), which is the desired
 * degradation.
 */
@Injectable({ providedIn: 'root' })
export class CuratedStore {
  private readonly curatedResource = httpResource<CuratedData>(() => CURATED_URL, {
    parse: (raw: unknown): CuratedData => {
      const result = safeParseCuratedData(raw);
      if (!result.success) {
        throw new CuratedInvalidDataError(result.issues);
      }
      return result.data;
    },
  });

  /** Discriminated four-state view of the load lifecycle. */
  readonly state = computed<CuratedState>(() => {
    const status = this.curatedResource.status();
    if (status === 'error') {
      const error = this.curatedResource.error();
      if (error instanceof CuratedInvalidDataError) {
        return { kind: 'invalid-data', issues: error.issues };
      }
      return {
        kind: 'fetch-error',
        status: error instanceof HttpErrorResponse ? error.status : 0,
      };
    }
    if (this.curatedResource.hasValue()) {
      return { kind: 'success', curated: this.curatedResource.value() };
    }
    return { kind: 'loading' };
  });

  /** The validated curated dataset, or `undefined` outside success. */
  readonly curated = computed<CuratedData | undefined>(() => {
    const state = this.state();
    return state.kind === 'success' ? state.curated : undefined;
  });

  readonly isLoading = computed(() => this.state().kind === 'loading');

  /** Re-requests the document after a fetch error (retry button). */
  reload(): void {
    this.curatedResource.reload();
  }
}
