import { computed, signal, type Provider, type WritableSignal } from '@angular/core';
import type { CuratedData } from '@cf-viz/catalog';

import type { CuratedState } from '../core/catalog/curated-state';
import { CuratedStore } from '../core/catalog/curated-store';

/** A valid curated document with zero coverage — the neutral test default. */
export const EMPTY_CURATED: CuratedData = {
  schemaVersion: '1',
  learningNotes: [],
  scenarios: [],
  narration: [],
  products: [],
  compositions: [],
  pricing: [],
};

export interface CuratedStoreStub {
  /** Writable state the test drives. */
  readonly state: WritableSignal<CuratedState>;
  /** Call counters (this file is compiled by the app tsconfig, so no vi.fn). */
  readonly calls: { reload: number };
  /** Drop-in provider replacing the real {@link CuratedStore}. */
  readonly provider: Provider;
}

/**
 * Signal-backed CuratedStore replacement for specs that route through the
 * shell gate. Defaults to `success` with {@link EMPTY_CURATED} so existing
 * catalog-focused tests keep their behavior; pass an initial state to drive
 * the curated branch of the gate.
 */
export function curatedStoreStub(
  initial: CuratedState = { kind: 'success', curated: EMPTY_CURATED },
): CuratedStoreStub {
  const state = signal<CuratedState>(initial);
  const calls = { reload: 0 };
  const provider: Provider = {
    provide: CuratedStore,
    useValue: {
      state: state.asReadonly(),
      curated: computed(() => {
        const current = state();
        return current.kind === 'success' ? current.curated : undefined;
      }),
      isLoading: computed(() => state().kind === 'loading'),
      reload: () => {
        calls.reload += 1;
      },
    },
  };
  return { state, calls, provider };
}
