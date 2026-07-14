import type { CatalogIssue, CuratedData } from '@cf-viz/catalog';

/**
 * Discriminated union describing every state the curated data layer can be
 * in. Unlike the catalog there is no `empty` kind: a curated document with
 * empty collections is a valid, meaningful state (curation coverage grows
 * incrementally) and renders as "everything unplaced", not as a blocker.
 */
export type CuratedState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'success'; readonly curated: CuratedData }
  | { readonly kind: 'invalid-data'; readonly issues: readonly CatalogIssue[] }
  | { readonly kind: 'fetch-error'; readonly status: number };

export type CuratedStateKind = CuratedState['kind'];

/**
 * Carries curated schema issues from the validation boundary through the
 * resource error channel; mirrors {@link CatalogInvalidDataError}.
 */
export class CuratedInvalidDataError extends Error {
  constructor(readonly issues: readonly CatalogIssue[]) {
    super(`Curated document failed validation with ${issues.length} issue(s).`);
    this.name = 'CuratedInvalidDataError';
  }
}
