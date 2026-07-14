import { DatePipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  inject,
  input,
  signal,
} from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { CURATED_LANES, type CuratedLane, type CuratedLayer } from '@cf-viz/catalog';

import { CatalogStore } from '../../core/catalog/catalog-store';
import { CuratedStore } from '../../core/catalog/curated-store';
import { localToday, ProgressStore, type NodeStatus } from '../../core/learning/progress-store';
import { firstParamValue } from '../../core/routing/query-params';
import { buildMapModel, LANE_LABELS, LAYER_LABELS, type MapModel } from '../map/map-selectors';
import {
  buildLensViews,
  learningCardView,
  totalSlots,
  verifiedSlots,
  type LearningCardView,
  type LensView,
} from './living-map-selectors';
import { areaReviewStates } from './re-fog';
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
  /** Raw `?lens=` value; a scenario or solution id, validated below. */
  readonly lens = input<string | undefined>();
  /** Raw `?stop=` value; the 1-based replay stop, clamped to the journey. */
  readonly stop = input<string | undefined>();

  private readonly store = inject(CatalogStore);
  private readonly curatedStore = inject(CuratedStore);
  protected readonly progress = inject(ProgressStore);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  /** Family groups the learner expanded in the compute band. */
  private readonly expandedGroups = signal<ReadonlySet<string>>(new Set());

  constructor() {
    this.progress.touchSession();
    // Replay's autoplay heartbeat: one interval for the component's life,
    // inert unless playing. URL updates use replaceUrl, so a documentary
    // run does not spray history entries.
    const timer = setInterval(() => {
      if (!this.playing()) return;
      const next = this.stopIndex() + 1;
      if (next > this.replayStops().length) {
        this.playing.set(false);
        return;
      }
      this.goToStop(next);
    }, 4000);
    inject(DestroyRef).onDestroy(() => {
      clearInterval(timer);
    });
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
    if (this.expandedGroups().has(familyId)) return true;
    // Replay auto-expands the group holding the current stop — a stop the
    // learner cannot see is not a stop.
    return this.currentStop()?.familyId === familyId;
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
      queryParams: { product: productId, ...this.lensParam() },
    });
  }

  protected close(): void {
    void this.router.navigate([], { relativeTo: this.route, queryParams: this.lensParam() });
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
      staleAreas: this.staleAreas().map((area) => area.layer),
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

  protected setMode(mode: 'explore' | 'recall' | 'replay'): void {
    this.picked.set(new Set());
    this.score.set(null);
    this.playing.set(false);
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: mode === 'explore' ? {} : { mode },
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

  // ---------------------------------------------------------------- re-fog

  /** Page-load date; a session crossing midnight just misses one nudge. */
  private readonly todayDate = localToday();

  private readonly reviewStates = computed(() =>
    areaReviewStates(this.progress.state().recallLog, this.todayDate),
  );

  /**
   * Areas due for review: past their re-fog date AND still holding
   * verified nodes — an area with nothing verified has nothing to lose,
   * so it never nags.
   */
  protected readonly staleAreas = computed(() => {
    const curated = this.curatedStore.curated();
    if (curated === undefined) return [];
    const reviews = this.reviewStates();
    const states = this.progress.state().nodeStates;
    return this.areas().filter(({ layer }) => {
      if (reviews.get(layer)?.stale !== true) return false;
      return curated.products.some(
        (entry) =>
          states[entry.productId] === 'verified' &&
          entry.placements.some((placement) => placement.layer === layer),
      );
    });
  });

  private readonly staleLayerSet = computed(
    () => new Set<string>(this.staleAreas().map((area) => area.layer)),
  );

  private readonly layersByProduct = computed(() => {
    const map = new Map<string, readonly CuratedLayer[]>();
    const curated = this.curatedStore.curated();
    if (curated === undefined) return map;
    for (const entry of curated.products) {
      map.set(
        entry.productId,
        entry.placements.map((placement) => placement.layer),
      );
    }
    return map;
  });

  /** Verified but past due in one of its areas — rendered as re-fogged. */
  protected isRefogged(productId: string): boolean {
    if (this.statusOf(productId) !== 'verified') return false;
    const layers = this.layersByProduct().get(productId);
    if (layers === undefined) return false;
    const stale = this.staleLayerSet();
    return layers.some((layer) => stale.has(layer));
  }

  protected isAreaStale(layer: string): boolean {
    return this.staleLayerSet().has(layer);
  }

  // ----------------------------------------------------------------- lenses

  /** Every lens the bar offers: scenarios first, then solutions. */
  protected readonly lenses = computed<readonly LensView[]>(() => {
    const catalog = this.store.catalog();
    const curated = this.curatedStore.curated();
    return catalog !== undefined && curated !== undefined ? buildLensViews(catalog, curated) : [];
  });

  /** The validated active lens; hostile or unknown ids collapse to null. */
  protected readonly activeLens = computed<LensView | null>(() => {
    const raw = firstParamValue(this.lens());
    if (raw === undefined || raw === '') return null;
    return this.lenses().find((candidate) => candidate.id === raw) ?? null;
  });

  /** URL fragment that keeps the lens across product open/close. */
  private lensParam(): Record<string, string> {
    const lens = this.activeLens();
    return lens === null ? {} : { lens: lens.id };
  }

  protected setLens(lensId: string | null): void {
    const selected = this.selectedId();
    const productParam = selected === null ? {} : { product: selected };
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: lensId === null ? productParam : { ...productParam, lens: lensId },
    });
  }

  protected inLens(productId: string): boolean {
    return this.activeLens()?.productIds.has(productId) ?? false;
  }

  protected dimmedByLens(productId: string): boolean {
    const lens = this.activeLens();
    return lens !== null && !lens.productIds.has(productId);
  }

  /** Lens members inside a collapsed family group (badge + dim decision). */
  protected lensCountIn(products: readonly { readonly id: string }[]): number {
    const lens = this.activeLens();
    if (lens === null) return 0;
    return products.filter((product) => lens.productIds.has(product.id)).length;
  }

  // ----------------------------------------------------------------- replay

  protected readonly isReplay = computed(() => firstParamValue(this.mode()) === 'replay');

  /** True when the OS asks for reduced motion — autoplay is not offered. */
  protected readonly reducedMotion =
    typeof window.matchMedia === 'function'
      ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
      : false;

  protected readonly playing = signal(false);

  /** The journey script joined with catalog names, in narration order. */
  protected readonly replayStops = computed(() => {
    const catalog = this.store.catalog();
    const curated = this.curatedStore.curated();
    if (catalog === undefined || curated === undefined) return [];
    const productById = new Map(catalog.products.map((product) => [product.id, product]));
    return curated.narration.flatMap((stop) => {
      const product = productById.get(stop.productId);
      return product === undefined
        ? []
        : [
            {
              productId: stop.productId,
              name: product.name,
              familyId: product.familyId,
              captionKo: stop.captionKo,
              sourceUrl: stop.sourceUrl,
              verifiedAt: stop.verifiedAt,
            },
          ];
    });
  });

  /** 1-based stop index; hostile or out-of-range values collapse to 1. */
  protected readonly stopIndex = computed(() => {
    const total = this.replayStops().length;
    if (total === 0) return 0;
    const raw = Number(firstParamValue(this.stop()) ?? '1');
    return Number.isInteger(raw) && raw >= 1 && raw <= total ? raw : 1;
  });

  protected readonly currentStop = computed(() => {
    if (!this.isReplay()) return null;
    const index = this.stopIndex();
    return index === 0 ? null : (this.replayStops()[index - 1] ?? null);
  });

  protected isReplayCurrent(productId: string): boolean {
    return this.currentStop()?.productId === productId;
  }

  protected isReplayPassed(productId: string): boolean {
    if (this.currentStop() === null) return false;
    return this.replayStops()
      .slice(0, this.stopIndex() - 1)
      .some((stop) => stop.productId === productId);
  }

  protected goToStop(index: number): void {
    if (index < 1 || index > this.replayStops().length) return;
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { mode: 'replay', stop: index },
      replaceUrl: true,
    });
  }

  protected togglePlay(): void {
    this.playing.update((value) => !value);
  }
}
