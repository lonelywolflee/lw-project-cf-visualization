import type { Catalog, Relationship, RelationshipType, Source } from '@cf-viz/catalog';
import { RELATIONSHIP_TYPES } from '@cf-viz/catalog';

import { compareByNameThenId } from '../../core/catalog/catalog-selectors';
import { firstParamValue } from '../../core/routing/query-params';

/**
 * Pure relationship projection: validated catalog -> typed graph view.
 *
 * Both on-screen representations (the SVG diagram and the HTML list/detail
 * fallback) render the SAME filtered projection produced here, so they can
 * never disagree. Every function is deterministic — the layout is a pure
 * function of the filtered node set (no physics, no randomness) — and never
 * mutates the catalog.
 */

/** Entity kind of a graph node; doubles as the category filter value. */
export type NodeKind = 'product' | 'solution' | 'use-case';

export const NODE_KINDS: readonly NodeKind[] = ['product', 'solution', 'use-case'];

/** Endpoint kinds implied by each relationship type name. */
const ENDPOINT_KINDS: Record<RelationshipType, readonly [NodeKind, NodeKind]> = {
  'product-solution': ['product', 'solution'],
  'product-use-case': ['product', 'use-case'],
  'solution-use-case': ['solution', 'use-case'],
};

/** Korean UI label + badge letter per node kind (badge is the non-color kind signal). */
export const KIND_LABELS: Record<NodeKind, { readonly badge: string; readonly en: string }> = {
  product: { badge: 'P', en: 'Product' },
  solution: { badge: 'S', en: 'Solution' },
  'use-case': { badge: 'U', en: 'Use case' },
};

/** Display label per relationship type (English term kept, per house style). */
export const TYPE_LABELS: Record<RelationshipType, string> = {
  'product-solution': 'Product – Solution',
  'product-use-case': 'Product – Use case',
  'solution-use-case': 'Solution – Use case',
};

/** One graph node: a catalog entity that participates in at least one edge. */
export interface RelationshipNode {
  /** `${kind}:${id}` — ids are only unique per collection. */
  readonly key: string;
  readonly kind: NodeKind;
  readonly id: string;
  readonly name: string;
  readonly summary: string;
  /** Catalog detail route commands, or null (use cases have no detail page). */
  readonly detailRoute: readonly string[] | null;
}

/** One typed edge with resolved endpoint nodes. */
export interface RelationshipEdge {
  /** `${type}:${fromId}:${toId}` — the relationship identity triple. */
  readonly key: string;
  readonly type: RelationshipType;
  readonly from: RelationshipNode;
  readonly to: RelationshipNode;
  readonly sourceIds: readonly string[];
  /** Accessible name: `Product – Use case: CDN → Static Asset Acceleration`. */
  readonly label: string;
}

function nodeKey(kind: NodeKind, id: string): string {
  return `${kind}:${id}`;
}

export function edgeKey(relationship: Relationship): string {
  return `${relationship.type}:${relationship.fromId}:${relationship.toId}`;
}

function toNode(catalog: Catalog, kind: NodeKind, id: string): RelationshipNode | undefined {
  const collection =
    kind === 'product'
      ? catalog.products
      : kind === 'solution'
        ? catalog.solutions
        : catalog.useCases;
  const entity = collection.find((candidate) => candidate.id === id);
  if (entity === undefined) return undefined; // Unreachable for validated catalogs.
  const detailRoute =
    kind === 'product' ? ['/products', id] : kind === 'solution' ? ['/solutions', id] : null;
  return {
    key: nodeKey(kind, id),
    kind,
    id,
    name: entity.name,
    summary: entity.summary,
    detailRoute,
  };
}

/**
 * All catalog relationships as edges with resolved endpoints, in
 * deterministic display order: type (schema enum order), then from-name,
 * then to-name (both via the shared comparator).
 */
export function relationshipEdges(catalog: Catalog): readonly RelationshipEdge[] {
  const edges: RelationshipEdge[] = [];
  for (const relationship of catalog.relationships) {
    const [fromKind, toKind] = ENDPOINT_KINDS[relationship.type];
    const from = toNode(catalog, fromKind, relationship.fromId);
    const to = toNode(catalog, toKind, relationship.toId);
    if (from === undefined || to === undefined) continue; // Unreachable for validated catalogs.
    edges.push({
      key: edgeKey(relationship),
      type: relationship.type,
      from,
      to,
      sourceIds: relationship.sourceIds,
      label: `${TYPE_LABELS[relationship.type]}: ${from.name} → ${to.name}`,
    });
  }
  const typeOrder = new Map(RELATIONSHIP_TYPES.map((type, index) => [type, index]));
  return edges.sort(
    (a, b) =>
      (typeOrder.get(a.type) ?? 0) - (typeOrder.get(b.type) ?? 0) ||
      compareByNameThenId(a.from, b.from) ||
      compareByNameThenId(a.to, b.to),
  );
}

/** Validated relationship filter; null means "no restriction". */
export interface RelationshipFilter {
  readonly type: RelationshipType | null;
  readonly category: NodeKind | null;
}

export const EMPTY_FILTER: RelationshipFilter = { type: null, category: null };

export interface ParsedRelationshipParams {
  readonly filter: RelationshipFilter;
  /** Param names whose values were invalid and therefore ignored. */
  readonly dropped: readonly ('type' | 'category')[];
}

/**
 * Normalizes raw `type` / `category` query params against the two enums.
 * Unknown values are dropped (reported), never thrown.
 */
export function parseRelationshipParams(raw: {
  readonly type?: unknown;
  readonly category?: unknown;
}): ParsedRelationshipParams {
  const dropped: ('type' | 'category')[] = [];

  const typeParam = firstParamValue(raw.type);
  let type: RelationshipType | null = null;
  if (typeParam !== undefined && typeParam !== '') {
    const match = RELATIONSHIP_TYPES.find((candidate) => candidate === typeParam);
    if (match !== undefined) {
      type = match;
    } else {
      dropped.push('type');
    }
  }

  const categoryParam = firstParamValue(raw.category);
  let category: NodeKind | null = null;
  if (categoryParam !== undefined && categoryParam !== '') {
    const match = NODE_KINDS.find((candidate) => candidate === categoryParam);
    if (match !== undefined) {
      category = match;
    } else {
      dropped.push('category');
    }
  }

  return { filter: { type, category }, dropped };
}

/** Filter -> query params for `Router.navigate`; inactive keys map to null. */
export function toRelationshipQueryParams(
  filter: RelationshipFilter,
): Record<string, string | null> {
  return { type: filter.type, category: filter.category };
}

/**
 * Applies the filter with AND semantics. Category filters EDGES (an edge
 * survives when either endpoint has the kind): the view is edge-centric, and
 * keeping whole edges keeps both representations meaningful — filtering
 * nodes alone would strand half-drawn edges.
 */
export function filterEdges(
  edges: readonly RelationshipEdge[],
  filter: RelationshipFilter,
): readonly RelationshipEdge[] {
  return edges.filter(
    (edge) =>
      (filter.type === null || edge.type === filter.type) &&
      (filter.category === null ||
        edge.from.kind === filter.category ||
        edge.to.kind === filter.category),
  );
}

/** Entities per kind with no edge at all (computed on the UNFILTERED set). */
export interface DisconnectedCounts {
  readonly products: number;
  readonly solutions: number;
  readonly useCases: number;
}

export function disconnectedCounts(catalog: Catalog): DisconnectedCounts {
  const connected = new Set<string>();
  for (const relationship of catalog.relationships) {
    const [fromKind, toKind] = ENDPOINT_KINDS[relationship.type];
    connected.add(nodeKey(fromKind, relationship.fromId));
    connected.add(nodeKey(toKind, relationship.toId));
  }
  return {
    products: catalog.products.filter((p) => !connected.has(nodeKey('product', p.id))).length,
    solutions: catalog.solutions.filter((s) => !connected.has(nodeKey('solution', s.id))).length,
    useCases: catalog.useCases.filter((u) => !connected.has(nodeKey('use-case', u.id))).length,
  };
}

/* ------------------------------------------------------------------ *
 * Deterministic three-column layout                                   *
 * ------------------------------------------------------------------ */

/** Left x per column in viewBox units: products | use cases | solutions. */
const COLUMN_X: Record<NodeKind, number> = {
  product: 24,
  'use-case': 354,
  solution: 684,
};

/** Fixed viewBox geometry (SVG user units; the element scales responsively). */
export const LAYOUT = {
  viewBoxWidth: 940,
  nodeWidth: 232,
  nodeHeight: 36,
  rowGap: 16,
  padding: 24,
  /** Left x per column: products | use cases | solutions. */
  columnX: COLUMN_X,
  /** Longest label that fits the node width at the CSS font size. */
  maxLabelLength: 26,
} as const;

export interface PositionedNode extends RelationshipNode {
  /** Top-left corner in viewBox units. */
  readonly x: number;
  readonly y: number;
  /** Name truncated to fit the node box (full name lives in the HTML list). */
  readonly displayName: string;
}

export interface PositionedEdge extends RelationshipEdge {
  /** SVG path `d`: one cubic curve between the facing node sides. */
  readonly path: string;
}

/** Everything the SVG template renders; a pure function of the edge list. */
export interface RelationshipGraphView {
  readonly nodes: readonly PositionedNode[];
  readonly edges: readonly PositionedEdge[];
  readonly viewBoxHeight: number;
}

function truncate(name: string): string {
  return name.length <= LAYOUT.maxLabelLength
    ? name
    : `${name.slice(0, LAYOUT.maxLabelLength - 1)}…`;
}

/**
 * Columns: products left, use cases centre, solutions right — every edge
 * type in the schema connects adjacent-or-outer columns, and the shipped
 * data (product→use-case, solution→use-case) only ever crosses one gap.
 * Rows are display-ordered by the shared comparator; shorter columns are
 * vertically centred. Same filtered edges in, same coordinates out.
 */
export function layoutGraph(edges: readonly RelationshipEdge[]): RelationshipGraphView {
  const byKind = new Map<NodeKind, RelationshipNode[]>();
  const seen = new Set<string>();
  for (const edge of edges) {
    for (const node of [edge.from, edge.to]) {
      if (seen.has(node.key)) continue;
      seen.add(node.key);
      const column = byKind.get(node.kind);
      if (column === undefined) {
        byKind.set(node.kind, [node]);
      } else {
        column.push(node);
      }
    }
  }

  const rowPitch = LAYOUT.nodeHeight + LAYOUT.rowGap;
  const maxRows = Math.max(0, ...[...byKind.values()].map((column) => column.length));
  const contentHeight = maxRows > 0 ? maxRows * rowPitch - LAYOUT.rowGap : 0;
  const viewBoxHeight = contentHeight + LAYOUT.padding * 2;

  const nodes: PositionedNode[] = [];
  const positionByKey = new Map<string, PositionedNode>();
  for (const kind of NODE_KINDS) {
    const column = [...(byKind.get(kind) ?? [])].sort(compareByNameThenId);
    const columnHeight = column.length > 0 ? column.length * rowPitch - LAYOUT.rowGap : 0;
    const yOffset = LAYOUT.padding + (contentHeight - columnHeight) / 2;
    column.forEach((node, index) => {
      const positioned: PositionedNode = {
        ...node,
        x: LAYOUT.columnX[kind],
        y: yOffset + index * rowPitch,
        displayName: truncate(node.name),
      };
      nodes.push(positioned);
      positionByKey.set(node.key, positioned);
    });
  }

  const positionedEdges: PositionedEdge[] = [];
  for (const edge of edges) {
    const from = positionByKey.get(edge.from.key);
    const to = positionByKey.get(edge.to.key);
    if (from === undefined || to === undefined) continue; // Unreachable: endpoints were laid out above.
    positionedEdges.push({ ...edge, path: edgePath(from, to) });
  }

  return { nodes, edges: positionedEdges, viewBoxHeight };
}

/** One cubic curve between the two facing sides of the endpoint boxes. */
function edgePath(from: PositionedNode, to: PositionedNode): string {
  const fromCy = from.y + LAYOUT.nodeHeight / 2;
  const toCy = to.y + LAYOUT.nodeHeight / 2;
  const [x1, x2] =
    from.x < to.x ? [from.x + LAYOUT.nodeWidth, to.x] : [from.x, to.x + LAYOUT.nodeWidth];
  const midX = (x1 + x2) / 2;
  return `M ${x1} ${fromCy} C ${midX} ${fromCy}, ${midX} ${toCy}, ${x2} ${toCy}`;
}

/* ------------------------------------------------------------------ *
 * List / detail projections                                           *
 * ------------------------------------------------------------------ */

/** Edges grouped by type for the HTML fallback, keeping display order. */
export interface EdgeTypeGroup {
  readonly type: RelationshipType;
  readonly label: string;
  readonly edges: readonly RelationshipEdge[];
}

export function edgesByType(edges: readonly RelationshipEdge[]): readonly EdgeTypeGroup[] {
  return RELATIONSHIP_TYPES.map((type) => ({
    type,
    label: TYPE_LABELS[type],
    edges: edges.filter((edge) => edge.type === type),
  })).filter((group) => group.edges.length > 0);
}

/** What the user has picked; keys refer to the CURRENT filtered projection. */
export type RelationshipSelection =
  { readonly kind: 'node'; readonly key: string } | { readonly kind: 'edge'; readonly key: string };

/** Detail panel content for a selected edge. */
export interface EdgeDetailView {
  readonly edge: RelationshipEdge;
  readonly sources: readonly Source[];
}

/** Detail panel content for a selected node: the node plus its edges. */
export interface NodeDetailView {
  readonly node: RelationshipNode;
  /** '연결된 항목': every filtered edge touching the node, display-ordered. */
  readonly edges: readonly RelationshipEdge[];
}

/** Sources for an edge, preserving declared sourceIds order. */
function resolveSources(catalog: Catalog, sourceIds: readonly string[]): readonly Source[] {
  const byId = new Map(catalog.sources.map((source) => [source.id, source]));
  return sourceIds
    .map((id) => byId.get(id))
    .filter((source): source is Source => source !== undefined);
}

export type SelectionDetail =
  | { readonly kind: 'edge'; readonly detail: EdgeDetailView }
  | { readonly kind: 'node'; readonly detail: NodeDetailView };

/**
 * Resolves a selection against the CURRENT filtered edges. Returns undefined
 * when the selection points at nothing visible (e.g. the filter changed
 * underneath it) — the page then renders the unselected placeholder, keeping
 * SVG, list, and detail consistent by construction.
 */
export function selectionDetail(
  catalog: Catalog,
  edges: readonly RelationshipEdge[],
  selection: RelationshipSelection | null,
): SelectionDetail | undefined {
  if (selection === null) return undefined;
  if (selection.kind === 'edge') {
    const edge = edges.find((candidate) => candidate.key === selection.key);
    if (edge === undefined) return undefined;
    return {
      kind: 'edge',
      detail: { edge, sources: resolveSources(catalog, edge.sourceIds) },
    };
  }
  const touching = edges.filter(
    (edge) => edge.from.key === selection.key || edge.to.key === selection.key,
  );
  const first = touching[0];
  if (first === undefined) return undefined;
  const node = first.from.key === selection.key ? first.from : first.to;
  return { kind: 'node', detail: { node, edges: touching } };
}
