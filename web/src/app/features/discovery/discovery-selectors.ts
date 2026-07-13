import type { Catalog, Product, Solution } from '@cf-viz/catalog';

import { compareByNameThenId } from '../../core/catalog/catalog-selectors';
import { firstParamValue } from '../../core/routing/query-params';

/**
 * Pure discovery layer: URL params -> validated criteria -> derived results.
 *
 * Lives in the discovery feature (not core) because nothing else consumes
 * it; it only imports catalog types and the shared display comparator.
 * All functions are deterministic and never mutate the catalog.
 */

/** Validated discovery state. `q` is trimmed; ids are catalog-verified. */
export interface DiscoveryCriteria {
  readonly q: string;
  readonly familyId: string | null;
  readonly useCaseId: string | null;
}

export const EMPTY_CRITERIA: DiscoveryCriteria = { q: '', familyId: null, useCaseId: null };

export interface ParsedDiscoveryParams {
  readonly criteria: DiscoveryCriteria;
  /** Param names whose values were invalid and therefore ignored. */
  readonly dropped: readonly ('family' | 'useCase')[];
}

// Moved to core so the relationships feature can share it without a
// cross-feature dependency; re-exported to keep this module's public surface.
export { firstParamValue };

/**
 * Normalizes raw query params against the catalog. Unknown `family` /
 * `useCase` ids are dropped (reported in `dropped`), `q` is trimmed.
 * Never throws: any junk input degrades to the empty criteria.
 */
export function parseDiscoveryParams(
  catalog: Catalog,
  raw: { readonly q?: unknown; readonly family?: unknown; readonly useCase?: unknown },
): ParsedDiscoveryParams {
  const dropped: ('family' | 'useCase')[] = [];

  const familyParam = firstParamValue(raw.family);
  let familyId: string | null = null;
  if (familyParam !== undefined && familyParam !== '') {
    if (catalog.productFamilies.some((family) => family.id === familyParam)) {
      familyId = familyParam;
    } else {
      dropped.push('family');
    }
  }

  const useCaseParam = firstParamValue(raw.useCase);
  let useCaseId: string | null = null;
  if (useCaseParam !== undefined && useCaseParam !== '') {
    if (catalog.useCases.some((useCase) => useCase.id === useCaseParam)) {
      useCaseId = useCaseParam;
    } else {
      dropped.push('useCase');
    }
  }

  return { criteria: { q: (firstParamValue(raw.q) ?? '').trim(), familyId, useCaseId }, dropped };
}

/** Derived result sets; `total` is `products.length + solutions.length`. */
export interface DiscoveryResults {
  readonly products: readonly Product[];
  readonly solutions: readonly Solution[];
  readonly total: number;
}

/** Case-insensitive substring over official name + summary. Empty q matches. */
function matchesText(entity: { name: string; summary: string }, needle: string): boolean {
  if (needle === '') return true;
  return (
    entity.name.toLowerCase().includes(needle) || entity.summary.toLowerCase().includes(needle)
  );
}

/** Ids on the `from` side of edges of `type` pointing at `useCaseId`. */
function edgeFromIds(
  catalog: Catalog,
  type: 'product-use-case' | 'solution-use-case',
  useCaseId: string,
): ReadonlySet<string> {
  return new Set(
    catalog.relationships
      .filter((edge) => edge.type === type && edge.toId === useCaseId)
      .map((edge) => edge.fromId),
  );
}

/**
 * Applies all active criteria with AND semantics and returns display-ordered
 * results. Semantics decisions (documented, tested):
 *
 * - Text: `toLowerCase()` substring (code-point, not locale-aware) over
 *   name + summary of both products and solutions.
 * - `familyId`: a property only products have. A solution can never satisfy
 *   an active family filter, so the solutions list is empty while it is set
 *   (honest AND composition; the UI explains this instead of silently
 *   ignoring the filter for solutions).
 * - `useCaseId`: membership via explicit source-backed edges only
 *   (`product-use-case` / `solution-use-case`). Entities without an edge do
 *   not match — no inference.
 */
export function searchCatalog(catalog: Catalog, criteria: DiscoveryCriteria): DiscoveryResults {
  const needle = criteria.q.toLowerCase();

  let products = catalog.products.filter((product) => matchesText(product, needle));
  if (criteria.familyId !== null) {
    products = products.filter((product) => product.familyId === criteria.familyId);
  }
  if (criteria.useCaseId !== null) {
    const linked = edgeFromIds(catalog, 'product-use-case', criteria.useCaseId);
    products = products.filter((product) => linked.has(product.id));
  }

  let solutions: Solution[];
  if (criteria.familyId !== null) {
    solutions = [];
  } else {
    solutions = catalog.solutions.filter((solution) => matchesText(solution, needle));
    if (criteria.useCaseId !== null) {
      const linked = edgeFromIds(catalog, 'solution-use-case', criteria.useCaseId);
      solutions = solutions.filter((solution) => linked.has(solution.id));
    }
  }

  const sortedProducts = [...products].sort(compareByNameThenId);
  const sortedSolutions = [...solutions].sort(compareByNameThenId);
  return {
    products: sortedProducts,
    solutions: sortedSolutions,
    total: sortedProducts.length + sortedSolutions.length,
  };
}

/**
 * Criteria -> query params for `Router.navigate`. Inactive keys map to
 * `null` so the router omits them; the URL always mirrors the full
 * normalized state (invalid values disappear on the next interaction).
 * `q` keeps the raw typed text (only fully-empty becomes null) so typing
 * mid-word spaces is not fought; parsing trims for matching.
 */
export function toDiscoveryQueryParams(criteria: {
  readonly q: string;
  readonly familyId: string | null;
  readonly useCaseId: string | null;
}): Record<string, string | null> {
  return {
    q: criteria.q.trim() === '' ? null : criteria.q,
    family: criteria.familyId,
    useCase: criteria.useCaseId,
  };
}
