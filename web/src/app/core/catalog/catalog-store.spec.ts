import { ApplicationRef } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';

import { CATALOG_URL, CatalogStore } from './catalog-store';

const emptyCatalog = {
  schemaVersion: '1',
  generatedAt: '2026-07-14T00:00:00Z',
  sources: [],
  productFamilies: [],
  products: [],
  solutions: [],
  useCases: [],
  relationships: [],
};

const validCatalog = {
  ...emptyCatalog,
  sources: [
    {
      id: 'waf-product-page',
      url: 'https://www.cloudflare.com/application-services/products/waf/',
      pageKind: 'marketing-product',
      title: 'Cloudflare Web Application Firewall',
      retrievedAt: '2026-07-14T00:00:00Z',
    },
  ],
  productFamilies: [
    {
      id: 'application-security',
      name: 'Application security',
      summary: 'Products that protect web applications and APIs at the edge.',
      sourceIds: ['waf-product-page'],
    },
  ],
  products: [
    {
      id: 'waf',
      name: 'Web Application Firewall',
      summary: 'Filters and blocks malicious HTTP traffic.',
      familyId: 'application-security',
      sourceIds: ['waf-product-page'],
    },
  ],
};

describe('CatalogStore', () => {
  let store: CatalogStore;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    store = TestBed.inject(CatalogStore);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
  });

  /**
   * Zoneless pattern: `TestBed.tick()` runs the effect that makes the
   * httpResource dispatch its request — it must happen BEFORE `flush`.
   */
  function expectCatalogRequest() {
    TestBed.tick();
    return httpMock.expectOne(CATALOG_URL);
  }

  /**
   * Zoneless pattern: awaiting `whenStable()` BEFORE flushing deadlocks — the
   * app never stabilises while the request is pending. Only await it AFTER
   * the mock backend has flushed a response.
   */
  async function whenStable(): Promise<void> {
    await TestBed.inject(ApplicationRef).whenStable();
  }

  it('starts in the loading state until the response arrives', async () => {
    expect(store.state().kind).toBe('loading');
    expect(store.isLoading()).toBe(true);
    expect(store.catalog()).toBeUndefined();

    expectCatalogRequest().flush(validCatalog);
    await whenStable();
    expect(store.isLoading()).toBe(false);
  });

  it('moves to success for a valid, non-empty catalog', async () => {
    expectCatalogRequest().flush(validCatalog);
    await whenStable();

    const state = store.state();
    expect(state.kind).toBe('success');
    if (state.kind === 'success') {
      expect(state.catalog.products[0]?.id).toBe('waf');
    }
    expect(store.catalog()?.productFamilies).toHaveLength(1);
  });

  it('moves to empty when every entity collection is empty', async () => {
    expectCatalogRequest().flush(emptyCatalog);
    await whenStable();

    const state = store.state();
    expect(state.kind).toBe('empty');
    expect(store.catalog()?.products).toHaveLength(0);
  });

  it('moves to invalid-data with issues when the document fails validation', async () => {
    expectCatalogRequest().flush({ schemaVersion: '999' });
    await whenStable();

    const state = store.state();
    expect(state.kind).toBe('invalid-data');
    if (state.kind === 'invalid-data') {
      expect(state.issues.length).toBeGreaterThan(0);
      expect(state.issues[0]).toMatchObject({
        code: expect.any(String),
        path: expect.any(String),
        message: expect.any(String),
      });
    }
    expect(store.catalog()).toBeUndefined();
  });

  it('moves to fetch-error with the HTTP status on server errors', async () => {
    expectCatalogRequest().flush('missing', { status: 404, statusText: 'Not Found' });
    await whenStable();

    expect(store.state()).toEqual({ kind: 'fetch-error', status: 404 });
  });

  it('reports status 0 for network-level failures', async () => {
    expectCatalogRequest().error(new ProgressEvent('error'));
    await whenStable();

    expect(store.state()).toEqual({ kind: 'fetch-error', status: 0 });
  });

  it('reload() re-requests the document after a fetch error', async () => {
    expectCatalogRequest().flush('nope', { status: 500, statusText: 'Server Error' });
    await whenStable();
    expect(store.state().kind).toBe('fetch-error');

    store.reload();
    expectCatalogRequest().flush(validCatalog);
    await whenStable();

    expect(store.state().kind).toBe('success');
  });
});
