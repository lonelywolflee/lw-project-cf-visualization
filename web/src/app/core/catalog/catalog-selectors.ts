import type { Catalog, Product, ProductFamily, Solution, Source, UseCase } from '@cf-viz/catalog';

/**
 * Pure read-model selectors over a validated {@link Catalog}.
 *
 * Referential integrity assumption: every catalog reaching these functions
 * has passed `safeParseCatalog`, which rejects unknown `familyId`,
 * `sourceIds`, and relationship endpoint references. Selectors therefore do
 * not re-validate references; the narrowing they perform exists only to
 * satisfy strict TypeScript without non-null assertions. Unknown ids coming
 * from the URL (route params) are the one expected miss and yield
 * `undefined`.
 */

interface NamedEntity {
  readonly id: string;
  readonly name: string;
}

/**
 * Deterministic display order: official name, case-insensitive, compared by
 * code point; ties broken by unique id.
 *
 * `localeCompare` is intentionally avoided: its result depends on the
 * runtime's ICU data and active locale, which breaks the house rule that the
 * same input produces the same output everywhere (dev machine, CI, browser).
 */
export function compareByNameThenId(a: NamedEntity, b: NamedEntity): number {
  const aName = a.name.toLowerCase();
  const bName = b.name.toLowerCase();
  if (aName < bName) return -1;
  if (aName > bName) return 1;
  if (a.id < b.id) return -1;
  if (a.id > b.id) return 1;
  return 0;
}

/** One product family with its member products in display order. */
export interface FamilyGroup {
  readonly family: ProductFamily;
  readonly products: readonly Product[];
}

/**
 * Families in display order, each carrying its products in display order.
 * A family without products is kept with an empty list.
 */
export function familyGroups(catalog: Catalog): readonly FamilyGroup[] {
  const byFamilyId = new Map<string, Product[]>();
  for (const product of catalog.products) {
    const members = byFamilyId.get(product.familyId);
    if (members === undefined) {
      byFamilyId.set(product.familyId, [product]);
    } else {
      members.push(product);
    }
  }
  return [...catalog.productFamilies].sort(compareByNameThenId).map((family) => ({
    family,
    products: (byFamilyId.get(family.id) ?? []).sort(compareByNameThenId),
  }));
}

/** All solutions in display order. */
export function sortedSolutions(catalog: Catalog): readonly Solution[] {
  return [...catalog.solutions].sort(compareByNameThenId);
}

/** Everything the product detail page renders. */
export interface ProductDetailView {
  readonly product: Product;
  readonly family: ProductFamily;
  readonly useCases: readonly UseCase[];
  readonly sources: readonly Source[];
}

/** Everything the solution detail page renders. */
export interface SolutionDetailView {
  readonly solution: Solution;
  readonly useCases: readonly UseCase[];
  readonly sources: readonly Source[];
}

/** Sources for an entity, preserving the entity's declared sourceIds order. */
function resolveSources(catalog: Catalog, sourceIds: readonly string[]): readonly Source[] {
  const byId = new Map(catalog.sources.map((source) => [source.id, source]));
  return sourceIds
    .map((id) => byId.get(id))
    .filter((source): source is Source => source !== undefined);
}

/** Use cases linked from an entity via the given edge type, display-ordered. */
function relatedUseCases(
  catalog: Catalog,
  type: 'product-use-case' | 'solution-use-case',
  fromId: string,
): readonly UseCase[] {
  const useCaseIds = new Set(
    catalog.relationships
      .filter((edge) => edge.type === type && edge.fromId === fromId)
      .map((edge) => edge.toId),
  );
  return catalog.useCases.filter((useCase) => useCaseIds.has(useCase.id)).sort(compareByNameThenId);
}

/**
 * Detail view for one product, or `undefined` when the id is unknown
 * (e.g. a hand-edited URL). The family lookup can only miss on a catalog
 * that bypassed validation; that impossible miss also maps to `undefined`.
 */
export function productDetail(catalog: Catalog, productId: string): ProductDetailView | undefined {
  const product = catalog.products.find((candidate) => candidate.id === productId);
  if (product === undefined) return undefined;
  const family = catalog.productFamilies.find((candidate) => candidate.id === product.familyId);
  if (family === undefined) return undefined; // Unreachable for validated catalogs.
  return {
    product,
    family,
    useCases: relatedUseCases(catalog, 'product-use-case', product.id),
    sources: resolveSources(catalog, product.sourceIds),
  };
}

/** Detail view for one solution, or `undefined` when the id is unknown. */
export function solutionDetail(
  catalog: Catalog,
  solutionId: string,
): SolutionDetailView | undefined {
  const solution = catalog.solutions.find((candidate) => candidate.id === solutionId);
  if (solution === undefined) return undefined;
  return {
    solution,
    useCases: relatedUseCases(catalog, 'solution-use-case', solution.id),
    sources: resolveSources(catalog, solution.sourceIds),
  };
}

/**
 * Route-facing wrapper around a detail selector. `pending` means the catalog
 * has not reached success yet (the shell gate renders the load state, so a
 * child in this state renders nothing); `not-found` means the catalog is
 * present but the id is unknown.
 */
export type DetailState<T> =
  | { readonly kind: 'pending' }
  | { readonly kind: 'not-found'; readonly id: string }
  | { readonly kind: 'found'; readonly detail: T };

export function toDetailState<T>(
  catalog: Catalog | undefined,
  id: string,
  lookup: (catalog: Catalog, id: string) => T | undefined,
): DetailState<T> {
  if (catalog === undefined) return { kind: 'pending' };
  const detail = lookup(catalog, id);
  return detail === undefined ? { kind: 'not-found', id } : { kind: 'found', detail };
}
