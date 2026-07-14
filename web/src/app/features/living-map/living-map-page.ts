import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';

import { CatalogStore } from '../../core/catalog/catalog-store';
import { CuratedStore } from '../../core/catalog/curated-store';
import { ProgressStore, type NodeStatus } from '../../core/learning/progress-store';
import { firstParamValue } from '../../core/routing/query-params';
import { buildMapModel, type MapModel } from '../map/map-selectors';
import {
  learningCardView,
  totalSlots,
  verifiedSlots,
  type LearningCardView,
} from './living-map-selectors';

/**
 * The Living Map: one full-screen map where learning happens as modes.
 * This page owns exploration mode — free clicking with fog-of-war
 * motivation (no locks: every node is clickable from the start; nodes the
 * learner has worked on render progressively brighter) and the learning
 * card overlay. Selection is URL state (`?product=`), validated against
 * the catalog like every v2 screen. Recall mode mounts on top in the
 * recall commit of #33.
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
}
