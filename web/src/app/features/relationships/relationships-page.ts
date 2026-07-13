import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { RELATIONSHIP_TYPES } from '@cf-viz/catalog';

import { CatalogStore } from '../../core/catalog/catalog-store';
import {
  EMPTY_FILTER,
  KIND_LABELS,
  LAYOUT,
  NODE_KINDS,
  TYPE_LABELS,
  disconnectedCounts,
  edgesByType,
  filterEdges,
  layoutGraph,
  parseRelationshipParams,
  relationshipEdges,
  selectionDetail,
  toRelationshipQueryParams,
  type RelationshipFilter,
  type RelationshipSelection,
} from './relationship-selectors';

/**
 * Source-backed relationship view: an SVG diagram plus the EQUIVALENT
 * keyboard-accessible HTML list/detail fallback (AGENTS §5).
 *
 * State model:
 * - FILTERS live in the URL (`type`, `category`), mirroring the discovery
 *   page: shareable, restorable, bound via `withComponentInputBinding()`.
 * - SELECTION is an in-memory signal: it is transient inspect state, and
 *   keeping it out of the URL avoids history spam and focus-restoration
 *   questions on deep links.
 *
 * Consistency: the SVG, the edge list, and the detail panel all derive from
 * ONE filtered projection (`filteredEdges`), so a filter change updates both
 * representations identically; a selection that the filter removed resolves
 * to `undefined` detail and the placeholder is shown.
 *
 * The SVG is `aria-hidden`: every fact it shows (and more) is in the HTML
 * fallback, its click targets are a pointer bonus duplicating the list
 * buttons, and it contains no focusable elements. `role="img"` would instead
 * present the drawing as content and trap its interactivity behind an
 * opaque label.
 */
@Component({
  selector: 'app-relationships-page',
  imports: [RouterLink],
  templateUrl: './relationships-page.html',
  styleUrl: './relationships-page.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RelationshipsPage {
  /** Raw query params, bound by the router; undefined when absent. */
  readonly type = input<string | undefined>();
  readonly category = input<string | undefined>();

  private readonly store = inject(CatalogStore);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  protected readonly catalog = this.store.catalog;

  protected readonly layout = LAYOUT;
  protected readonly kindLabels = KIND_LABELS;
  protected readonly typeLabels = TYPE_LABELS;
  protected readonly relationshipTypes = RELATIONSHIP_TYPES;
  protected readonly nodeKinds = NODE_KINDS;

  /** Validated filter; invalid params are dropped, never thrown. */
  protected readonly filter = computed<RelationshipFilter>(
    () => parseRelationshipParams({ type: this.type(), category: this.category() }).filter,
  );

  /** In-memory selection; may point at an edge/node the filter later hides. */
  protected readonly selection = signal<RelationshipSelection | null>(null);

  /** All edges of the catalog (unfiltered), resolved and display-ordered. */
  private readonly allEdges = computed(() => {
    const catalog = this.catalog();
    return catalog === undefined ? [] : relationshipEdges(catalog);
  });

  /** THE shared projection input for SVG, list, and detail. */
  protected readonly filteredEdges = computed(() => filterEdges(this.allEdges(), this.filter()));

  protected readonly graph = computed(() => layoutGraph(this.filteredEdges()));

  protected readonly groups = computed(() => edgesByType(this.filteredEdges()));

  protected readonly detail = computed(() => {
    const catalog = this.catalog();
    if (catalog === undefined) return undefined;
    return selectionDetail(catalog, this.filteredEdges(), this.selection());
  });

  protected readonly disconnected = computed(() => {
    const catalog = this.catalog();
    return catalog === undefined ? undefined : disconnectedCounts(catalog);
  });

  protected readonly hasAnyRelationship = computed(() => this.allEdges().length > 0);

  protected readonly hasActiveFilter = computed(() => {
    const filter = this.filter();
    return filter.type !== null || filter.category !== null;
  });

  /** True when the selected key is this edge (drives aria-pressed + styles). */
  protected isSelectedEdge(key: string): boolean {
    const selection = this.selection();
    return selection?.kind === 'edge' && selection.key === key;
  }

  protected isSelectedNode(key: string): boolean {
    const selection = this.selection();
    return selection?.kind === 'node' && selection.key === key;
  }

  /** Toggles edge selection; used by list buttons and SVG paths alike. */
  protected selectEdge(key: string): void {
    this.selection.set(this.isSelectedEdge(key) ? null : { kind: 'edge', key });
  }

  protected selectNode(key: string): void {
    this.selection.set(this.isSelectedNode(key) ? null : { kind: 'node', key });
  }

  /**
   * Select values are re-validated through the same parser as the URL
   * params: no `as` cast, and an unexpected value degrades to "no filter"
   * exactly like an invalid deep link would.
   */
  protected onTypeChange(value: string): void {
    this.applyFilter({
      ...this.filter(),
      type: parseRelationshipParams({ type: value }).filter.type,
    });
  }

  protected onCategoryChange(value: string): void {
    this.applyFilter({
      ...this.filter(),
      category: parseRelationshipParams({ category: value }).filter.category,
    });
  }

  protected clearFilters(): void {
    this.applyFilter(EMPTY_FILTER);
  }

  /** Writes the full normalized filter as the query string (no merge). */
  private applyFilter(filter: RelationshipFilter): void {
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: toRelationshipQueryParams(filter),
    });
  }
}
