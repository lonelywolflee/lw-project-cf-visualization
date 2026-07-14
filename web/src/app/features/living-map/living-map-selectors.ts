import type { Catalog, CuratedData, LearningNote, Product } from '@cf-viz/catalog';

/**
 * Read models specific to the Living Map's learning layer. The map's
 * lane/layer geometry itself comes from the shared buildMapModel — this
 * file only joins what the learning card and the recall metric need.
 */

/** Everything the learning card renders for one product. */
export interface LearningCardView {
  readonly product: Product;
  readonly familyName: string;
  /** Curated Korean role line; null while the product is uncurated. */
  readonly roleKo: string | null;
  /** The quote-first learning note; null → the card shows the fallback. */
  readonly note: LearningNote | null;
  /** True when curated pricing exists (the card links the calculator). */
  readonly hasPricing: boolean;
  /** Official pages the product was crawled from. */
  readonly sources: readonly { readonly title: string; readonly url: string }[];
}

/** Joins one product with its learning note; unknown ids yield undefined. */
export function learningCardView(
  catalog: Catalog,
  curated: CuratedData,
  productId: string,
): LearningCardView | undefined {
  const product = catalog.products.find((candidate) => candidate.id === productId);
  if (product === undefined) return undefined;
  const familyName =
    catalog.productFamilies.find((family) => family.id === product.familyId)?.name ??
    product.familyId;
  const sourceById = new Map(catalog.sources.map((source) => [source.id, source]));
  return {
    product,
    familyName,
    roleKo: curated.products.find((entry) => entry.productId === productId)?.roleKo ?? null,
    note: curated.learningNotes.find((entry) => entry.productId === productId) ?? null,
    hasPricing: curated.pricing.some((entry) => entry.productId === productId),
    sources: product.sourceIds.flatMap((sourceId) => {
      const source = sourceById.get(sourceId);
      return source === undefined ? [] : [{ title: source.title, url: source.url }];
    }),
  };
}

/**
 * One selectable lens over the map. Scenarios carry their narrative;
 * solution lenses derive from compositions (title from the catalog) and
 * carry no narrative — the graph page remains their deep view.
 */
export interface LensView {
  readonly kind: 'scenario' | 'solution';
  readonly id: string;
  readonly title: string;
  readonly productIds: ReadonlySet<string>;
  /** Scenario narrative; null for solution lenses. */
  readonly situationKo: string | null;
  /** Optional AE conversation opener; null when absent. */
  readonly talkTrackKo: string | null;
  readonly sourceUrl: string;
  readonly verifiedAt: string;
}

/**
 * Every lens the bar offers: scenarios first (the learning story), then
 * solution compositions sorted by display name. Ids are unique across both
 * kinds — the curated contract rejects scenario/solution collisions.
 */
export function buildLensViews(catalog: Catalog, curated: CuratedData): readonly LensView[] {
  const solutionNameById = new Map(
    catalog.solutions.map((solution) => [solution.id, solution.name]),
  );
  const scenarios = curated.scenarios.map((scenario): LensView => ({
    kind: 'scenario',
    id: scenario.id,
    title: scenario.titleKo,
    productIds: new Set(scenario.productIds),
    situationKo: scenario.situationKo,
    talkTrackKo: scenario.talkTrackKo ?? null,
    sourceUrl: scenario.sourceUrl,
    verifiedAt: scenario.verifiedAt,
  }));
  const solutions = curated.compositions
    .map((composition): LensView => ({
      kind: 'solution',
      id: composition.solutionId,
      title: solutionNameById.get(composition.solutionId) ?? composition.solutionId,
      productIds: new Set(composition.productIds),
      situationKo: null,
      talkTrackKo: null,
      sourceUrl: composition.sourceUrl,
      verifiedAt: composition.verifiedAt,
    }))
    .sort((a, b) => (a.title < b.title ? -1 : a.title > b.title ? 1 : 0));
  return [...scenarios, ...solutions];
}

/**
 * Slot counts for the approved recall metric: every placement is one slot
 * (multi-placement products contribute one slot per layer), so the global
 * denominator is 70 for the shipped dataset, never assumed as a constant.
 */
export function totalSlots(curated: CuratedData): number {
  return curated.products.reduce((sum, entry) => sum + entry.placements.length, 0);
}

/** Slots covered by the given verified product ids. */
export function verifiedSlots(curated: CuratedData, verifiedIds: ReadonlySet<string>): number {
  return curated.products
    .filter((entry) => verifiedIds.has(entry.productId))
    .reduce((sum, entry) => sum + entry.placements.length, 0);
}
