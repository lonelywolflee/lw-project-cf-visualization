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

/** A catalog is empty when every entity collection has zero entries. */
export function isCatalogEmpty(catalog: Catalog): boolean {
  return (
    catalog.sources.length === 0 &&
    catalog.productFamilies.length === 0 &&
    catalog.products.length === 0 &&
    catalog.solutions.length === 0 &&
    catalog.useCases.length === 0 &&
    catalog.relationships.length === 0
  );
}
