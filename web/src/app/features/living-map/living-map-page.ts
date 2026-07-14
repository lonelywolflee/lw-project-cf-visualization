import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { CURATED_LANES, type CuratedLane, type CuratedLayer } from '@cf-viz/catalog';

import { CatalogStore } from '../../core/catalog/catalog-store';
import { CuratedStore } from '../../core/catalog/curated-store';
import { ProgressStore, type NodeStatus } from '../../core/learning/progress-store';
import { firstParamValue } from '../../core/routing/query-params';
import { buildMapModel, LANE_LABELS, LAYER_LABELS, type MapModel } from '../map/map-selectors';
import {
  learningCardView,
  totalSlots,
  verifiedSlots,
  type LearningCardView,
} from './living-map-selectors';
import { buildRecallPool, scoreRecall, type RecallPool, type RecallScore } from './recall-session';

/**
 * The Living Map: one full-screen map where learning happens as modes.
 *
 * Exploration (default) — free clicking with fog-of-war motivation (no
 * locks: every node is clickable from the start; nodes the learner has
 * worked on render progressively brighter) and the learning card overlay.
 * Selection is URL state (`?product=`), validated against the catalog.
 *
 * Recall (`?mode=recall&area=<layer>`) — the same map blanked per area:
 * pick which products belong to the chosen layer from a pool that mixes
 * the answers with adjacent-layer decoys, limited to as many picks as the
 * area has slots. Submitting scores the session (slot rubric), upgrades
 * correct nodes to verified, demotes missed ones, and records the recall
 * log entry that feeds the exported report.
 *
 * The dense compute band renders as collapsed family groups by default —
 * the design's semantic-collapse requirement: labels and unvisited counts
 * stay readable even while collapsed.
 */
@Component({
  selector: 'app-living-map-page',
  imports: [DatePipe, RouterLink],
  templateUrl: './living-map-page.html',
  styleUrl: './living-map-page.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LivingMapPage {
  /** Raw `?product=` value, bound by the router; undefined when absent. */
  readonly product = input<string | undefined>();
  /** Raw `?mode=` value; anything but 'recall' means exploration. */
  readonly mode = input<string | undefined>();
  /** Raw `?area=` value; the recall layer, validated against the lanes. */
  readonly area = input<string | undefined>();

  private readonly store = inject(CatalogStore);
  private readonly curatedStore = inject(CuratedStore);
  protected readonly progress = inject(ProgressStore);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  /** Family groups the learner expanded in the compute band. */
  private readonly expandedGroups = signal<ReadonlySet<string>>(new Set());

  constructor() {
    this.progress.touchSession();
  }

  protected readonly model = computed<MapModel | undefined>(() => {
    const catalog = this.store.catalog();
    const curated = this.curatedStore.curated();
    return catalog !== undefined && curated !== undefined
      ? buildMapModel(catalog, curated)
      : undefined;
  });

  /** The validated selection; hostile or unknown ids collapse to null. */
  protected readonly selectedId = computed<string | null>(() => {
    const raw = firstParamValue(this.product());
    if (raw === undefined || raw === '') return null;
    const catalog = this.store.catalog();
    return catalog !== undefined && catalog.products.some((entry) => entry.id === raw) ? raw : null;
  });

  protected readonly card = computed<LearningCardView | null>(() => {
    const id = this.selectedId();
    const catalog = this.store.catalog();
    const curated = this.curatedStore.curated();
    if (id === null || catalog === undefined || curated === undefined) return null;
    return learningCardView(catalog, curated, id) ?? null;
  });

  /** Global recall metric: verified slots over all slots (70 today). */
  protected readonly slotTotal = computed(() => {
    const curated = this.curatedStore.curated();
    return curated === undefined ? 0 : totalSlots(curated);
  });

  protected readonly verifiedSlotCount = computed(() => {
    const curated = this.curatedStore.curated();
    if (curated === undefined) return 0;
    const verified = new Set(
      Object.entries(this.progress.state().nodeStates)
        .filter(([, status]) => status === 'verified')
        .map(([id]) => id),
    );
    return verifiedSlots(curated, verified);
  });

  protected statusOf(productId: string): NodeStatus | 'unvisited' {
    // Read through the state signal so fog classes update reactively.
    return this.progress.state().nodeStates[productId] ?? 'unvisited';
  }

  protected isExpanded(familyId: string): boolean {
    return this.expandedGroups().has(familyId);
  }

  protected toggleGroup(familyId: string): void {
    this.expandedGroups.update((expanded) => {
      const next = new Set(expanded);
      if (next.has(familyId)) {
        next.delete(familyId);
      } else {
        next.add(familyId);
      }
      return next;
    });
  }

  /** Unvisited count for a collapsed group's always-readable label. */
  protected unvisitedIn(products: readonly { readonly id: string }[]): number {
    const states = this.progress.state().nodeStates;
    return products.filter((product) => states[product.id] === undefined).length;
  }

  /** Node click: record the visit and open the card via URL state. */
  protected open(productId: string): void {
    this.progress.recordVisit(productId);
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { product: productId },
    });
  }

  protected close(): void {
    void this.router.navigate([], { relativeTo: this.route, queryParams: {} });
  }

  protected markLearned(productId: string): void {
    this.progress.markLearned(productId);
  }

  /** Downloads the measurement report (progress + derived recall rate). */
  protected exportReport(): void {
    const total = this.slotTotal();
    const json = this.progress.exportJson({
      recallRate: total === 0 ? null : this.verifiedSlotCount() / total,
      slotTotal: total,
      exportedAt: new Date().toISOString(),
    });
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'learning-progress.json';
    anchor.click();
    URL.revokeObjectURL(url);
  }

  /** Restores a report picked from the hidden file input. */
  protected async importReport(event: Event): Promise<void> {
    const target = event.target;
    if (!(target instanceof HTMLInputElement) || target.files === null) return;
    const file = target.files[0];
    if (file === undefined) return;
    const ok = this.progress.importJson(await file.text());
    this.importResult.set(ok ? 'imported' : 'invalid');
    target.value = '';
  }

  protected readonly importResult = signal<'imported' | 'invalid' | null>(null);

  // ---------------------------------------------------------------- recall

  protected readonly isRecall = computed(() => firstParamValue(this.mode()) === 'recall');

  /** Every recallable area (lane + layer) with its Korean labels. */
  protected readonly areas = computed(() => {
    const curated = this.curatedStore.curated();
    if (curated === undefined) return [];
    return CURATED_LANES.flatMap((lane) =>
      [
        ...new Set(
          curated.products
            .flatMap((entry) => entry.placements)
            .filter((placement) => placement.lane === lane)
            .map((placement) => placement.layer),
        ),
      ].map((layer) => ({
        lane,
        layer,
        laneLabel: LANE_LABELS[lane].short,
        layerLabel: LAYER_LABELS[layer],
      })),
    );
  });

  /** The validated recall area; unknown values collapse to null. */
  protected readonly recallArea = computed<{ lane: CuratedLane; layer: CuratedLayer } | null>(
    () => {
      const raw = firstParamValue(this.area());
      if (raw === undefined) return null;
      const match = this.areas().find((candidate) => candidate.layer === raw);
      return match === undefined ? null : { lane: match.lane, layer: match.layer };
    },
  );

  protected readonly pool = computed<RecallPool | null>(() => {
    const areaValue = this.recallArea();
    const catalog = this.store.catalog();
    const curated = this.curatedStore.curated();
    if (areaValue === null || catalog === undefined || curated === undefined) return null;
    return buildRecallPool(catalog, curated, areaValue.lane, areaValue.layer);
  });

  /** Picks of the in-progress session, capped at the slot count. */
  protected readonly picked = signal<ReadonlySet<string>>(new Set());
  protected readonly score = signal<RecallScore | null>(null);

  protected layerLabelOf(layer: CuratedLayer): string {
    return LAYER_LABELS[layer];
  }

  protected setMode(recall: boolean): void {
    this.picked.set(new Set());
    this.score.set(null);
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: recall ? { mode: 'recall' } : {},
    });
  }

  protected startArea(layer: string): void {
    this.picked.set(new Set());
    this.score.set(null);
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { mode: 'recall', area: layer },
    });
  }

  protected togglePick(productId: string): void {
    if (this.score() !== null) return; // Session already submitted.
    const pool = this.pool();
    if (pool === null) return;
    this.picked.update((picked) => {
      const next = new Set(picked);
      if (next.has(productId)) {
        next.delete(productId);
      } else if (next.size < pool.answers.length) {
        next.add(productId);
      }
      return next;
    });
  }

  protected submitRecall(): void {
    const pool = this.pool();
    const areaValue = this.recallArea();
    if (pool === null || areaValue === null || this.score() !== null) return;
    const result = scoreRecall(pool, this.picked());
    this.score.set(result);
    this.progress.recordRecall(
      areaValue.layer,
      result.results.map(({ productId, correct }) => ({ productId, correct })),
      result.totalSlots,
    );
  }
}
