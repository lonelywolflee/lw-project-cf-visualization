import type { Catalog, CuratedData, Solution } from '@cf-viz/catalog';

import { compareByNameThenId } from '../../core/catalog/catalog-selectors';

/**
 * Pure read-model selectors for the solution composition graph.
 *
 * Composition edges exist only in the curated dataset (the crawl carries
 * zero solution→product edges). The same skew tolerance as the map applies:
 * a curated member id missing from the catalog joins nothing and is
 * silently dropped from the view, because `pnpm validate:data` forbids it
 * in committed data and only a mid-deploy skew can produce it.
 */

/** One solution card on the overview grid. */
export interface SolutionCard {
  readonly id: string;
  readonly name: string;
  /** Member count, or null when the solution has no curated composition. */
  readonly memberCount: number | null;
}

/** Every catalog solution in display order, with composition coverage. */
export function solutionCards(catalog: Catalog, curated: CuratedData): readonly SolutionCard[] {
  const productIds = new Set(catalog.products.map((product) => product.id));
  const memberCountBySolution = new Map<string, number>(
    curated.compositions.map((composition) => [
      composition.solutionId,
      composition.productIds.filter((id) => productIds.has(id)).length,
    ]),
  );
  return [...catalog.solutions].sort(compareByNameThenId).map((solution) => ({
    id: solution.id,
    name: solution.name,
    memberCount: memberCountBySolution.get(solution.id) ?? null,
  }));
}

/** Another solution that shares a member product. */
export interface SolutionRef {
  readonly id: string;
  readonly name: string;
}

/** One member node of the focused solution. */
export interface FocusMember {
  readonly id: string;
  readonly name: string;
  /** Other solutions whose composition also contains this product. */
  readonly sharedWith: readonly SolutionRef[];
}

/** The focused solution with its composition, or the explicit lack of one. */
export interface FocusView {
  readonly solution: Solution;
  /** Null when the solution has no curated composition (empty state). */
  readonly members: readonly FocusMember[] | null;
  /** Composition provenance; null exactly when `members` is null. */
  readonly source: { readonly url: string; readonly verifiedAt: string } | null;
}

/**
 * Joins one solution with its curated composition. Unknown solution ids
 * (the URL is the caller) yield `undefined`; a known solution without a
 * composition yields `members: null` so the page renders the explicit
 * empty state instead of an empty graph.
 */
export function focusView(
  catalog: Catalog,
  curated: CuratedData,
  solutionId: string,
): FocusView | undefined {
  const solution = catalog.solutions.find((candidate) => candidate.id === solutionId);
  if (solution === undefined) return undefined;

  const composition = curated.compositions.find((entry) => entry.solutionId === solutionId);
  if (composition === undefined) {
    return { solution, members: null, source: null };
  }

  const solutionNameById = new Map(catalog.solutions.map((entry) => [entry.id, entry.name]));
  const productById = new Map(catalog.products.map((product) => [product.id, product]));

  const members = composition.productIds
    .flatMap((productId): FocusMember[] => {
      const product = productById.get(productId);
      if (product === undefined) return []; // Tolerated mid-deploy skew.
      const sharedWith = curated.compositions
        .filter((other) => other.solutionId !== solutionId && other.productIds.includes(productId))
        .flatMap((other): SolutionRef[] => {
          const name = solutionNameById.get(other.solutionId);
          return name === undefined ? [] : [{ id: other.solutionId, name }];
        })
        .sort(compareByNameThenId);
      return [{ id: product.id, name: product.name, sharedWith }];
    })
    .sort(compareByNameThenId);

  return {
    solution,
    members,
    source: { url: composition.sourceUrl, verifiedAt: composition.verifiedAt },
  };
}

/** One node position of the radial focus layout. */
export interface MemberPosition {
  readonly x: number;
  readonly y: number;
  /** SVG text-anchor that keeps the label outside the ring. */
  readonly anchor: 'start' | 'middle' | 'end';
}

/**
 * Deterministic radial layout: members sit on an ellipse around the hub,
 * starting at 12 o'clock and proceeding clockwise. Pure geometry — index
 * order is the caller's (already-sorted) member order.
 */
export function layoutMembers(
  count: number,
  width: number,
  height: number,
): readonly MemberPosition[] {
  const centerX = width / 2;
  const centerY = height / 2;
  const radiusX = width * 0.38;
  const radiusY = height * 0.36;
  return Array.from({ length: count }, (_, index) => {
    const angle = -Math.PI / 2 + (2 * Math.PI * index) / count;
    const cos = Math.cos(angle);
    const anchor = cos > 0.3 ? 'start' : cos < -0.3 ? 'end' : 'middle';
    return {
      x: Math.round(centerX + radiusX * cos),
      y: Math.round(centerY + radiusY * Math.sin(angle)),
      anchor,
    };
  });
}
