import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';

import { CatalogStore } from '../../core/catalog/catalog-store';
import { CuratedStore } from '../../core/catalog/curated-store';
import { firstParamValue } from '../../core/routing/query-params';
import { productPanel, type ProductPanelView } from '../map/map-selectors';
import { ProductPanel } from '../map/product-panel';
import {
  focusView,
  layoutMembers,
  solutionCards,
  type FocusView,
  type SolutionCard,
  type SolutionRef,
} from './graph-selectors';

/** SVG canvas geometry; the hub sits at the center. */
const WIDTH = 720;
const HEIGHT = 520;

/** One positioned member node ready for the template. */
interface GraphNode {
  readonly id: string;
  readonly name: string;
  readonly sharedWith: readonly SolutionRef[];
  readonly x: number;
  readonly y: number;
  readonly anchor: 'start' | 'middle' | 'end';
  readonly labelX: number;
  readonly labelY: number;
}

/**
 * Solution composition graph: an overview grid of all solutions, and a
 * radial focus view (hub = solution, spokes = member products). Both the
 * focused solution (`?solution=`) and the selected product (`?product=`)
 * are URL state — validated against the catalog, so hostile or unknown ids
 * collapse to the overview / no selection.
 *
 * The SVG is a visual duplicate marked `aria-hidden`; the member chip list
 * below it is the keyboard- and screen-reader path (the AGENTS fallback
 * rule for visualizations). Switching solutions keeps the selected product
 * so the shared-product pivot ("함께 포함된 솔루션") can hop between hubs.
 */
@Component({
  selector: 'app-graph-page',
  imports: [DatePipe, ProductPanel, RouterLink],
  templateUrl: './graph-page.html',
  styleUrl: './graph-page.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class GraphPage {
  /** Raw query params, bound by the router; undefined when absent. */
  readonly solution = input<string | undefined>();
  readonly product = input<string | undefined>();

  private readonly store = inject(CatalogStore);
  private readonly curatedStore = inject(CuratedStore);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  protected readonly hubX = WIDTH / 2;
  protected readonly hubY = HEIGHT / 2;
  protected readonly viewBox = `0 0 ${String(WIDTH)} ${String(HEIGHT)}`;

  protected readonly cards = computed<readonly SolutionCard[]>(() => {
    const catalog = this.store.catalog();
    const curated = this.curatedStore.curated();
    return catalog !== undefined && curated !== undefined ? solutionCards(catalog, curated) : [];
  });

  /** The validated focused solution id; unknown ids mean the overview. */
  protected readonly focusedId = computed<string | null>(() => {
    const raw = firstParamValue(this.solution());
    if (raw === undefined || raw === '') return null;
    const catalog = this.store.catalog();
    return catalog !== undefined && catalog.solutions.some((entry) => entry.id === raw)
      ? raw
      : null;
  });

  protected readonly focus = computed<FocusView | null>(() => {
    const id = this.focusedId();
    const catalog = this.store.catalog();
    const curated = this.curatedStore.curated();
    if (id === null || catalog === undefined || curated === undefined) return null;
    return focusView(catalog, curated, id) ?? null;
  });

  /** Members zipped with their radial positions and label placement. */
  protected readonly nodes = computed<readonly GraphNode[]>(() => {
    const members = this.focus()?.members;
    if (members == null) return [];
    const positions = layoutMembers(members.length, WIDTH, HEIGHT);
    return members.flatMap((member, index): GraphNode[] => {
      const position = positions[index];
      if (position === undefined) return [];
      const labelY = position.y < HEIGHT / 2 ? position.y - 18 : position.y + 30;
      const labelX =
        position.anchor === 'start'
          ? position.x + 18
          : position.anchor === 'end'
            ? position.x - 18
            : position.x;
      return [{ ...member, ...position, labelX, labelY }];
    });
  });

  /** The validated selected product id; unknown ids mean no selection. */
  protected readonly selectedProductId = computed<string | null>(() => {
    const raw = firstParamValue(this.product());
    if (raw === undefined || raw === '') return null;
    const catalog = this.store.catalog();
    return catalog !== undefined && catalog.products.some((entry) => entry.id === raw) ? raw : null;
  });

  protected readonly panelView = computed<ProductPanelView | null>(() => {
    const id = this.selectedProductId();
    const catalog = this.store.catalog();
    const curated = this.curatedStore.curated();
    if (id === null || catalog === undefined || curated === undefined) return null;
    return productPanel(catalog, curated, id) ?? null;
  });

  /** Solutions sharing the selected product, for the pivot list. */
  protected readonly sharedSolutions = computed<readonly SolutionRef[]>(() => {
    const id = this.selectedProductId();
    if (id === null) return [];
    return this.focus()?.members?.find((member) => member.id === id)?.sharedWith ?? [];
  });

  /** Members with curated pricing — the calculator can preload these. */
  protected readonly pricedMemberIds = computed<readonly string[]>(() => {
    const members = this.focus()?.members;
    const curated = this.curatedStore.curated();
    if (members == null || curated === undefined) return [];
    const priced = new Set(curated.pricing.map((entry) => entry.productId));
    return members.map((member) => member.id).filter((id) => priced.has(id));
  });

  /**
   * Focuses a solution (keeping any selected product so the shared-product
   * pivot can hop hubs) or, with null, returns to the overview.
   */
  protected selectSolution(solutionId: string | null): void {
    const product = solutionId === null ? null : this.selectedProductId();
    this.apply(solutionId, product);
  }

  /** Product node/chip click: select, or deselect when already active. */
  protected selectProduct(productId: string): void {
    const next = this.selectedProductId() === productId ? null : productId;
    this.apply(this.focusedId(), next);
  }

  /** Hub click: back to the solution card in the panel. */
  protected clearProduct(): void {
    this.apply(this.focusedId(), null);
  }

  /** Writes the full param set (the URL always mirrors state). */
  private apply(solutionId: string | null, productId: string | null): void {
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: {
        ...(solutionId === null ? {} : { solution: solutionId }),
        ...(productId === null ? {} : { product: productId }),
      },
    });
  }
}
