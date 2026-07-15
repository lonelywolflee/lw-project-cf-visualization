import { HttpErrorResponse, httpResource } from '@angular/common/http';
import { Injectable, computed } from '@angular/core';
import { safeParseCatalog, type Catalog } from '@cf-viz/catalog';

import { CatalogInvalidDataError, isCatalogEmpty, type CatalogState } from './catalog-state';

/** Single source of truth for the generated catalog document. */
export const CATALOG_URL = '/data/catalog.json';

/**
 * The one data-access boundary between the application and the generated
 * static JSON. Loads the document once via `httpResource`, validates it with
 * the shared `@cf-viz/catalog` runtime schema, and exposes the outcome as
 * read-only signals. Components must consume this store instead of fetching.
 */
@Injectable({ providedIn: 'root' })
export class CatalogStore {
  private readonly catalogResource = httpResource<Catalog>(() => CATALOG_URL, {
    parse: (raw: unknown): Catalog => {
      const result = safeParseCatalog(raw);
      if (!result.success) {
        throw new CatalogInvalidDataError(result.issues);
      }
      return result.data;
    },
  });

  /** Discriminated five-state view of the load lifecycle. */
  readonly state = computed<CatalogState>(() => {
    const status = this.catalogResource.status();
    if (status === 'error') {
      const error = this.catalogResource.error();
      if (error instanceof CatalogInvalidDataError) {
        return { kind: 'invalid-data', issues: error.issues };
      }
      return {
        kind: 'fetch-error',
        status: error instanceof HttpErrorResponse ? error.status : 0,
      };
    }
    if (this.catalogResource.hasValue()) {
      const catalog = this.catalogResource.value();
      return isCatalogEmpty(catalog) ? { kind: 'empty', catalog } : { kind: 'success', catalog };
    }
    return { kind: 'loading' };
  });

  /** The validated catalog, or `undefined` outside success/empty. */
  readonly catalog = computed<Catalog | undefined>(() => {
    const state = this.state();
    return state.kind === 'success' || state.kind === 'empty' ? state.catalog : undefined;
  });

  readonly isLoading = computed(() => this.state().kind === 'loading');

  /** Re-requests the document after a fetch error (retry button). */
  reload(): void {
    this.catalogResource.reload();
  }
}
