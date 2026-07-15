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
import {
  localToday,
  ProgressStore,
  type NodeStatus,
  type RecallKind,
} from '../../core/learning/progress-store';
import { firstParamValue } from '../../core/routing/query-params';
import { buildMapModel, LANE_LABELS, LAYER_LABELS, type MapModel } from '../map/map-selectors';
import {
  buildLensViews,
  learningCardView,
  solutionCardView,
  totalSlots,
  verifiedSlots,
  type LearningCardView,
  type LensView,
  type SolutionCardView,
} from './living-map-selectors';
import { areaReviewStates, nodeReviewStates } from './re-fog';
import {
  buildRecallPool,
  scoreRecall,
  suggestProducts,
  type RecallChip,
  type RecallPool,
  type RecallScore,
} from './recall-session';

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
  /** Raw `?kind=` value; 'practice' for chips, anything else = verify. */
  readonly kind = input<string | undefined>();
  /** Raw `?lens=` value; a scenario or solution id, validated below. */
  readonly lens = input<string | undefined>();
  /** Raw `?solution=` value; opens the canonical solution card. */
  readonly solution = input<string | undefined>();
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
    const curated = this.curatedStore.curated();
    // Content-learning rate: of the products that HAVE a note, how many
    // cards the learner actually OPENED. Based on openedIds, not node
    // status — a verify hit grants `verified` without a visit, and that
    // is exactly the decoupling this metric exists to surface.
    const noteIds = curated?.learningNotes.map((note) => note.productId) ?? [];
    const opened = new Set(this.progress.state().openedIds);
    const openedNotes = noteIds.filter((id) => opened.has(id)).length;
    const json = this.progress.exportJson({
      recallRate: total === 0 ? null : this.verifiedSlotCount() / total,
      slotTotal: total,
      noteReadRate: noteIds.length === 0 ? null : openedNotes / noteIds.length,
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

  /** True for a chip practice session; free-recall verify otherwise. */
  protected readonly recallKind = computed<RecallKind>(() =>
    firstParamValue(this.kind()) === 'practice' ? 'practice' : 'verify',
  );

  private resetSession(): void {
    this.picked.set(new Set());
    this.score.set(null);
    this.query.set('');
    this.entered.set(new Set());
    this.wrongEntries.set([]);
    this.demotedToPractice.set(false);
  }

  protected setMode(mode: 'explore' | 'recall' | 'replay'): void {
    this.resetSession();
    this.playing.set(false);
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: mode === 'explore' ? {} : { mode },
    });
  }

  protected startArea(layer: string, kind: RecallKind): void {
    this.resetSession();
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { mode: 'recall', area: layer, kind },
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

  /** Chip practice submit: recognition scaffold, marks at most. */
  protected submitPractice(): void {
    const pool = this.pool();
    const areaValue = this.recallArea();
    if (pool === null || areaValue === null || this.score() !== null) return;
    const result = scoreRecall(pool, this.picked());
    this.score.set(result);
    this.progress.recordRecall(
      areaValue.layer,
      result.results.map(({ productId, correct }) => ({ productId, correct })),
      result.totalSlots,
      'practice',
    );
  }

  // ------------------------------------------------------ verify (free recall)

  protected readonly query = signal('');
  protected readonly entered = signal<ReadonlySet<string>>(new Set());
  /** Entered products that belong elsewhere — shown after grading. */
  protected readonly wrongEntries = signal<readonly RecallChip[]>([]);
  /** True when the spray guard downgraded the session to practice. */
  protected readonly demotedToPractice = signal(false);

  /** Autocomplete candidates; empty until three typed characters. */
  protected readonly suggestions = computed(() => {
    const catalog = this.store.catalog();
    if (catalog === undefined) return [];
    return suggestProducts(catalog, this.query(), this.entered());
  });

  protected readonly enteredChips = computed<readonly RecallChip[]>(() => {
    const catalog = this.store.catalog();
    if (catalog === undefined) return [];
    const nameById = new Map(catalog.products.map((product) => [product.id, product.name]));
    return [...this.entered()].map((id) => ({ id, name: nameById.get(id) ?? id }));
  });

  protected onQueryInput(event: Event): void {
    const target = event.target;
    if (target instanceof HTMLInputElement) this.query.set(target.value);
  }

  protected addEntry(productId: string): void {
    if (this.score() !== null) return;
    this.entered.update((entered) => new Set(entered).add(productId));
    this.query.set('');
  }

  protected removeEntry(productId: string): void {
    if (this.score() !== null) return;
    this.entered.update((entered) => {
      const next = new Set(entered);
      next.delete(productId);
      return next;
    });
  }

  /** Free-recall submit: the only path to `verified`. */
  protected submitVerify(): void {
    const pool = this.pool();
    const areaValue = this.recallArea();
    if (pool === null || areaValue === null || this.score() !== null) return;
    const result = scoreRecall(pool, this.entered());
    this.score.set(result);
    const answerIds = new Set(pool.answers.map((answer) => answer.id));
    const wrong = this.enteredChips().filter((chip) => !answerIds.has(chip.id));
    this.wrongEntries.set(wrong);
    // Spray guard: when off-area entries outnumber the hits (precision
    // below one half), the session was catalogue-browsing, not recall —
    // it records as practice and grants no verification.
    const demoted = wrong.length > result.correctSlots;
    this.demotedToPractice.set(demoted);
    this.progress.recordRecall(
      areaValue.layer,
      result.results.map(({ productId, correct }) => ({ productId, correct })),
      result.totalSlots,
      demoted ? 'practice' : 'verify',
    );
  }

  // ---------------------------------------------------------------- re-fog

  /** Page-load date; a session crossing midnight just misses one nudge. */
  private readonly todayDate = localToday();

  /**
   * Legacy fallback: area posture from verify sessions only. Nodes
   * verified before per-node reviews existed have no node record, so
   * their area's last verify session stands in for their date.
   */
  private readonly legacyAreaReviews = computed(() =>
    areaReviewStates(
      this.progress.state().recallLog.filter((entry) => entry.kind === 'verify'),
      this.todayDate,
    ),
  );

  /** Primary re-fog signal: per-node verify dates and streaks. */
  private readonly nodeReviews = computed(() =>
    nodeReviewStates(this.progress.state().nodeReviews, this.todayDate),
  );

  /** Node staleness — node record first, legacy area fallback second. */
  private isNodeStale(productId: string): boolean {
    const nodeState = this.nodeReviews().get(productId);
    if (nodeState !== undefined) return nodeState.stale;
    const layers = this.layersByProduct().get(productId);
    if (layers === undefined) return false;
    const areaReviews = this.legacyAreaReviews();
    return layers.some((layer) => areaReviews.get(layer)?.stale === true);
  }

  /**
   * Areas due for review: still holding verified nodes whose review date
   * passed — an area with nothing verified has nothing to lose, so it
   * never nags.
   */
  protected readonly staleAreas = computed(() => {
    const curated = this.curatedStore.curated();
    if (curated === undefined) return [];
    const states = this.progress.state().nodeStates;
    return this.areas().filter(({ layer }) =>
      curated.products.some(
        (entry) =>
          states[entry.productId] === 'verified' &&
          entry.placements.some((placement) => placement.layer === layer) &&
          this.isNodeStale(entry.productId),
      ),
    );
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

  /** Verified but past its review date — rendered as re-fogged. */
  protected isRefogged(productId: string): boolean {
    if (this.statusOf(productId) !== 'verified') return false;
    return this.isNodeStale(productId);
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

  /**
   * Lens semantics (design §Recommended 2): picking a solution lens opens
   * its canonical card alongside the filter; clicking the active lens
   * again clears both. Scenario lenses keep their narrative panel — the
   * asymmetry is a role difference, not an omission.
   */
  protected setLens(lensId: string | null): void {
    const lens = lensId === null ? null : (this.lenses().find((c) => c.id === lensId) ?? null);
    const params: Record<string, string> = {};
    if (lens !== null) {
      params['lens'] = lens.id;
      if (lens.kind === 'solution') {
        params['solution'] = lens.id; // open the canonical card
      }
    }
    const selected = this.selectedId();
    if (selected !== null && lens?.kind !== 'solution') {
      params['product'] = selected; // solution card and product card are exclusive
    }
    void this.router.navigate([], { relativeTo: this.route, queryParams: params });
  }

  protected toggleLens(lensId: string): void {
    this.setLens(this.activeLens()?.id === lensId ? null : lensId);
  }

  // --------------------------------------------------------- solution card

  /** The canonical solution card; hostile ids collapse to null. */
  protected readonly solutionCard = computed<SolutionCardView | null>(() => {
    const raw = firstParamValue(this.solution());
    if (raw === undefined || raw === '') return null;
    const catalog = this.store.catalog();
    const curated = this.curatedStore.curated();
    if (catalog === undefined || curated === undefined) return null;
    return solutionCardView(catalog, curated, raw) ?? null;
  });

  /** Closes the card but keeps the lens filter (design semantics). */
  protected closeSolutionCard(): void {
    void this.router.navigate([], { relativeTo: this.route, queryParams: this.lensParam() });
  }

  /** Boundary-neighbour navigation: swap the card, keep the lens. */
  protected openSolutionCard(solutionId: string): void {
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { ...this.lensParam(), solution: solutionId },
    });
  }

  /**
   * Solution re-fog visibility (design §Recommended 4): stale solutions
   * dim their lens chip. Reads the namespaced progress key — inert until
   * V6-3 starts writing `solution:<id>` reviews, alive the moment it does.
   */
  protected isLensStale(lensId: string): boolean {
    return this.nodeReviews().get(`solution:${lensId}`)?.stale === true;
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
