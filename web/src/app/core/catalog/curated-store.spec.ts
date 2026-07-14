import { ApplicationRef } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';

import { CURATED_URL, CuratedStore } from './curated-store';

const emptyCurated = {
  schemaVersion: '1',
  products: [],
  compositions: [],
  pricing: [],
};

const validCurated = {
  ...emptyCurated,
  products: [
    {
      productId: 'waf',
      roleKo: '웹 공격 패턴을 차단합니다.',
      placements: [{ lane: 'public-web', layer: 'application-security' }],
      sourceUrl: 'https://www.cloudflare.com/application-services/products/waf/',
      verifiedAt: '2026-07-14T00:00:00Z',
    },
  ],
};

describe('CuratedStore', () => {
  let store: CuratedStore;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    store = TestBed.inject(CuratedStore);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
  });

  /** Zoneless pattern: tick BEFORE flush so the resource dispatches. */
  function expectCuratedRequest() {
    TestBed.tick();
    return httpMock.expectOne(CURATED_URL);
  }

  /** Zoneless pattern: only await stability AFTER the flush. */
  async function whenStable(): Promise<void> {
    await TestBed.inject(ApplicationRef).whenStable();
  }

  it('starts in the loading state until the response arrives', async () => {
    expect(store.state().kind).toBe('loading');
    expect(store.isLoading()).toBe(true);
    expect(store.curated()).toBeUndefined();

    expectCuratedRequest().flush(validCurated);
    await whenStable();
    expect(store.isLoading()).toBe(false);
  });

  it('moves to success for a valid document', async () => {
    expectCuratedRequest().flush(validCurated);
    await whenStable();

    const state = store.state();
    expect(state.kind).toBe('success');
    if (state.kind === 'success') {
      expect(state.curated.products[0]?.productId).toBe('waf');
    }
  });

  it('treats a document with empty collections as success, not as a blocker', async () => {
    expectCuratedRequest().flush(emptyCurated);
    await whenStable();

    expect(store.state().kind).toBe('success');
    expect(store.curated()?.products).toHaveLength(0);
  });

  it('moves to invalid-data with issues when the document fails validation', async () => {
    expectCuratedRequest().flush({ schemaVersion: '999' });
    await whenStable();

    const state = store.state();
    expect(state.kind).toBe('invalid-data');
    if (state.kind === 'invalid-data') {
      expect(state.issues.length).toBeGreaterThan(0);
    }
    expect(store.curated()).toBeUndefined();
  });

  it('moves to fetch-error with the HTTP status on server errors', async () => {
    expectCuratedRequest().flush('missing', { status: 404, statusText: 'Not Found' });
    await whenStable();

    expect(store.state()).toEqual({ kind: 'fetch-error', status: 404 });
  });

  it('reload() re-requests the document after a fetch error', async () => {
    expectCuratedRequest().flush('nope', { status: 500, statusText: 'Server Error' });
    await whenStable();
    expect(store.state().kind).toBe('fetch-error');

    store.reload();
    const request = expectCuratedRequest();
    expect(store.state().kind).toBe('loading');
    request.flush(validCurated);
    await whenStable();

    expect(store.state().kind).toBe('success');
  });
});
