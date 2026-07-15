import {
  CURATED_LANE_LAYERS,
  type Catalog,
  type CuratedData,
  type CuratedLane,
  type CuratedLayer,
} from '@cf-viz/catalog';

/**
 * Pure recall-session logic: chip pool construction and scoring, per the
 * approved rubric. Everything here is deterministic — chips come out in
 * name order, decoys are picked by deterministic order, no randomness —
 * so a session over the same data is reproducible (house determinism
 * rule; fairness beats shuffling for a study tool).
 */

/** One selectable chip in a recall session. */
export interface RecallChip {
  readonly id: string;
  readonly name: string;
}

/** A prepared recall session for one map area (lane + layer). */
export interface RecallPool {
  readonly lane: CuratedLane;
  readonly layer: CuratedLayer;
  /** Products that truly belong to the area — one slot each. */
  readonly answers: readonly RecallChip[];
  /** Adjacent-layer distractors; never a correct answer for this area. */
  readonly decoys: readonly RecallChip[];
  /** answers + decoys in display order (name, then id). */
  readonly chips: readonly RecallChip[];
}

function compareChips(a: RecallChip, b: RecallChip): number {
  const aName = a.name.toLowerCase();
  const bName = b.name.toLowerCase();
  if (aName < bName) return -1;
  if (aName > bName) return 1;
  if (a.id < b.id) return -1;
  if (a.id > b.id) return 1;
  return 0;
}

/** Product ids placed in the given lane/layer. */
function productsIn(curated: CuratedData, lane: CuratedLane, layer: CuratedLayer): Set<string> {
  const ids = new Set<string>();
  for (const entry of curated.products) {
    if (
      entry.placements.some((placement) => placement.lane === lane && placement.layer === layer)
    ) {
      ids.add(entry.productId);
    }
  }
  return ids;
}

/** Neighbouring layers within the same lane (the decoy source). */
function adjacentLayers(lane: CuratedLane, layer: CuratedLayer): readonly CuratedLayer[] {
  const layers: readonly CuratedLayer[] = CURATED_LANE_LAYERS[lane];
  const index = layers.indexOf(layer);
  if (index === -1) return [];
  const neighbours: CuratedLayer[] = [];
  const before = layers[index - 1];
  const after = layers[index + 1];
  if (before !== undefined) neighbours.push(before);
  if (after !== undefined) neighbours.push(after);
  return neighbours;
}

/**
 * Builds the chip pool for one area: every product placed there (the
 * answers, one slot each) plus decoys from adjacent layers — sized
 * max(2, round(30% of answers)) and, per the approved rubric, never
 * containing a product that is ALSO a correct answer for this area
 * (multi-placement products such as ddos would otherwise appear as
 * unwinnable traps).
 */
export function buildRecallPool(
  catalog: Catalog,
  curated: CuratedData,
  lane: CuratedLane,
  layer: CuratedLayer,
): RecallPool {
  const nameById = new Map(catalog.products.map((product) => [product.id, product.name]));
  const toChip = (id: string): RecallChip | null => {
    const name = nameById.get(id);
    return name === undefined ? null : { id, name };
  };

  const answerIds = productsIn(curated, lane, layer);
  const answers = [...answerIds]
    .map(toChip)
    .filter((chip): chip is RecallChip => chip !== null)
    .sort(compareChips);

  const decoyCandidates = new Set<string>();
  for (const neighbour of adjacentLayers(lane, layer)) {
    for (const id of productsIn(curated, lane, neighbour)) {
      if (!answerIds.has(id)) decoyCandidates.add(id);
    }
  }
  const decoyCount = Math.max(2, Math.round(answers.length * 0.3));
  const decoys = [...decoyCandidates]
    .map(toChip)
    .filter((chip): chip is RecallChip => chip !== null)
    .sort(compareChips)
    .slice(0, decoyCount);

  return {
    lane,
    layer,
    answers,
    decoys,
    chips: [...answers, ...decoys].sort(compareChips),
  };
}

/**
 * Autocomplete for the verify session's free-recall input. The learner
 * must retrieve how a name STARTS, not fish for letters it contains, so
 * matching is prefix-of-a-word (case-insensitive over name and id words).
 * Below three characters only an exact name/id match suggests — that
 * keeps two-letter products (D1, KV, R2) reachable by typing them out in
 * full while never opening a browsable list. Entered ids never repeat.
 */
export function suggestProducts(
  catalog: Catalog,
  query: string,
  enteredIds: ReadonlySet<string>,
  limit = 8,
): readonly RecallChip[] {
  const needle = query.trim().toLowerCase();
  if (needle.length === 0) return [];
  const matches = (name: string, id: string): boolean => {
    if (needle.length < 3) {
      return name === needle || id === needle;
    }
    return (
      name.split(/[\s/-]+/).some((word) => word.startsWith(needle)) ||
      id.split('-').some((word) => word.startsWith(needle))
    );
  };
  return catalog.products
    .filter(
      (product) => !enteredIds.has(product.id) && matches(product.name.toLowerCase(), product.id),
    )
    .map((product) => ({ id: product.id, name: product.name }))
    .sort(compareChips)
    .slice(0, limit);
}

/** Per-answer outcome of a submitted session. */
export interface RecallResult {
  readonly productId: string;
  readonly name: string;
  readonly correct: boolean;
}

export interface RecallScore {
  readonly results: readonly RecallResult[];
  readonly correctSlots: number;
  readonly totalSlots: number;
}

/**
 * Scores a submission: each answer slot is correct iff the learner picked
 * that product. Picking a decoy wastes one of the limited picks, which is
 * the natural penalty — decoys themselves are not graded entities.
 */
export function scoreRecall(pool: RecallPool, pickedIds: ReadonlySet<string>): RecallScore {
  const results = pool.answers.map((answer) => ({
    productId: answer.id,
    name: answer.name,
    correct: pickedIds.has(answer.id),
  }));
  return {
    results,
    correctSlots: results.filter((result) => result.correct).length,
    totalSlots: pool.answers.length,
  };
}
