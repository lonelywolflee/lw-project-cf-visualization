import type { Catalog, CuratedData, LearningNote, Product, SolutionNote } from '@cf-viz/catalog';

/**
 * Read models specific to the Living Map's learning layer. The map's
 * lane/layer geometry itself comes from the shared buildMapModel — this
 * file only joins what the learning card and the recall metric need.
 */

/**
 * Catalog name-trap pairs: two catalog entries that share an engine or a
 * name and get mixed up on the map. The card cross-links them so the
 * learner meets the confusion head-on instead of by accident. This is
 * navigation over facts the notes already state — not new curated data.
 */
export const PAIRED_NODES: Readonly<Record<string, string>> = {
  gateway: 'secure-web-gateway',
  'secure-web-gateway': 'gateway',
  ddos: 'ddos-for-web',
  'ddos-for-web': 'ddos',
  'email-routing': 'email-security',
  'email-security': 'email-routing',
};

/** Everything the learning card renders for one product. */
export interface LearningCardView {
  readonly product: Product;
  readonly familyName: string;
  /** Curated Korean role line; null while the product is uncurated. */
  readonly roleKo: string | null;
  /** The quote-first learning note; null → the card shows the fallback. */
  readonly note: LearningNote | null;
  /** The name-trap sibling, when one exists in the catalog. */
  readonly pairedWith: { readonly id: string; readonly name: string } | null;
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
  const pairedId = PAIRED_NODES[productId];
  const paired =
    pairedId === undefined
      ? undefined
      : catalog.products.find((candidate) => candidate.id === pairedId);
  return {
    product,
    familyName,
    roleKo: curated.products.find((entry) => entry.productId === productId)?.roleKo ?? null,
    note: curated.learningNotes.find((entry) => entry.productId === productId) ?? null,
    pairedWith: paired === undefined ? null : { id: paired.id, name: paired.name },
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

/** One product chip on the solution card. */
export interface SolutionProductChip {
  readonly id: string;
  readonly name: string;
}

/** One neighbour row of the solution card's boundary section. */
export interface SolutionBoundaryView {
  readonly solutionId: string;
  readonly solutionName: string;
  readonly noteKo: string;
  /** Derived from composition intersection — never stored (design rule). */
  readonly sharedProducts: readonly SolutionProductChip[];
}

/** Everything the canonical solution card renders. */
export interface SolutionCardView {
  readonly id: string;
  readonly name: string;
  /** Crawled English summary — the fallback body when no note exists. */
  readonly summary: string;
  /** The curated note; null → the card shows the fallback. */
  readonly note: SolutionNote | null;
  /** Composition members in name order (the recall answers). */
  readonly products: readonly SolutionProductChip[];
  /**
   * Boundary rows: this note's own boundariesKo PLUS mirrored entries from
   * neighbours whose notes point back here (stored one-directional,
   * displayed both ways — the design's no-double-truth rule).
   */
  readonly boundaries: readonly SolutionBoundaryView[];
}

/** Joins a solution with its note, members, and mirrored boundaries. */
export function solutionCardView(
  catalog: Catalog,
  curated: CuratedData,
  solutionId: string,
): SolutionCardView | undefined {
  const solution = catalog.solutions.find((candidate) => candidate.id === solutionId);
  if (solution === undefined) return undefined;

  const nameById = new Map(catalog.products.map((product) => [product.id, product.name]));
  const solutionNameById = new Map(catalog.solutions.map((entry) => [entry.id, entry.name]));
  const membersOf = (id: string): readonly string[] =>
    curated.compositions.find((entry) => entry.solutionId === id)?.productIds ?? [];
  const toChips = (ids: readonly string[]): SolutionProductChip[] =>
    ids
      .map((id) => ({ id, name: nameById.get(id) ?? id }))
      .sort((a, b) => (a.name.toLowerCase() < b.name.toLowerCase() ? -1 : 1));

  const ownMembers = new Set(membersOf(solutionId));
  const note = curated.solutionNotes.find((entry) => entry.solutionId === solutionId) ?? null;

  const boundaries = new Map<string, SolutionBoundaryView>();
  const addBoundary = (neighbourId: string, noteKo: string): void => {
    if (boundaries.has(neighbourId)) return; // own entry wins over mirror
    boundaries.set(neighbourId, {
      solutionId: neighbourId,
      solutionName: solutionNameById.get(neighbourId) ?? neighbourId,
      noteKo,
      sharedProducts: toChips(membersOf(neighbourId).filter((id) => ownMembers.has(id))),
    });
  };
  for (const boundary of note?.boundariesKo ?? []) {
    addBoundary(boundary.solutionId, boundary.noteKo);
  }
  for (const other of curated.solutionNotes) {
    if (other.solutionId === solutionId) continue;
    for (const boundary of other.boundariesKo ?? []) {
      if (boundary.solutionId === solutionId) {
        addBoundary(other.solutionId, boundary.noteKo);
      }
    }
  }

  return {
    id: solution.id,
    name: solution.name,
    summary: solution.summary,
    note,
    products: toChips([...ownMembers]),
    boundaries: [...boundaries.values()],
  };
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
