import type { Catalog, CatalogIssue } from '@cf-viz/catalog';

/**
 * Discriminated union describing every state the catalog data layer can be
 * in. Components switch on `kind` and never see raw HTTP or zod artifacts.
 */
export type CatalogState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'success'; readonly catalog: Catalog }
  | { readonly kind: 'empty'; readonly catalog: Catalog }
  | { readonly kind: 'invalid-data'; readonly issues: readonly CatalogIssue[] }
  | { readonly kind: 'fetch-error'; readonly status: number };

export type CatalogStateKind = CatalogState['kind'];

/**
 * Carries schema/integrity issues from the validation boundary through the
 * resource error channel. `Error` subclasses pass through Angular's resource
 * error encapsulation unwrapped, so `instanceof` checks stay reliable.
 */
export class CatalogInvalidDataError extends Error {
  constructor(readonly issues: readonly CatalogIssue[]) {
    super(`Catalog document failed validation with ${issues.length} issue(s).`);
    this.name = 'CatalogInvalidDataError';
  }
}

/** Array-valued keys of the Catalog contract (the entity collections). */
type CatalogCollectionKey = keyof {
  [K in keyof Catalog as Catalog[K] extends readonly unknown[] ? K : never]: true;
};

/**
 * A catalog is empty when every entity collection has zero entries.
 *
 * The Record annotation is exhaustive against the schema: a future collection
 * added to the Catalog contract fails compilation here instead of being
 * silently ignored by the emptiness check.
 */
export function isCatalogEmpty(catalog: Catalog): boolean {
  const collectionSizes: Record<CatalogCollectionKey, number> = {
    sources: catalog.sources.length,
    productFamilies: catalog.productFamilies.length,
    products: catalog.products.length,
    solutions: catalog.solutions.length,
    useCases: catalog.useCases.length,
    relationships: catalog.relationships.length,
  };
  return Object.values(collectionSizes).every((count) => count === 0);
}
