import { Location } from '@angular/common';
import { computed, signal, type WritableSignal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, withComponentInputBinding } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import type { Catalog, CuratedData } from '@cf-viz/catalog';

import { routes } from '../../app.routes';
import type { CatalogState } from '../../core/catalog/catalog-state';
import { CatalogStore } from '../../core/catalog/catalog-store';
import { curatedStoreStub } from '../../testing/curated-store-stub';

const catalog: Catalog = {
  schemaVersion: '1',
  generatedAt: '2026-07-14T00:00:00Z',
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
  solutions: [
    {
      id: 'sase',
      name: 'SASE',
      summary: 'Secure access service edge.',
      sourceIds: ['waf-product-page'],
    },
  ],
  useCases: [],
  relationships: [],
};

const curated: CuratedData = {
  schemaVersion: '1',
  products: [],
  compositions: [
    {
      solutionId: 'sase',
      productIds: ['waf'],
      sourceUrl: 'https://www.cloudflare.com/sase/',
      verifiedAt: '2026-07-14T00:00:00Z',
    },
  ],
  pricing: [],
};

/**
 * Route-level contract of the v2 surface: the two visualization routes and
 * one redirect per retired v1 route, so old deep links land on the
 * equivalent view instead of a dead end.
 */
describe('catalog routing', () => {
  let state: WritableSignal<CatalogState>;

  beforeEach(() => {
    state = signal<CatalogState>({ kind: 'success', catalog });
    const catalogSignal = computed(() => {
      const current = state();
      return current.kind === 'success' || current.kind === 'empty' ? current.catalog : undefined;
    });
    TestBed.configureTestingModule({
      providers: [
        provideRouter(routes, withComponentInputBinding()),
        curatedStoreStub({ kind: 'success', curated }).provider,
        {
          provide: CatalogStore,
          useValue: {
            state: state.asReadonly(),
            catalog: catalogSignal,
            isLoading: computed(() => state().kind === 'loading'),
            reload: vi.fn(),
          },
        },
      ],
    });
  });

  function path(): string {
    return TestBed.inject(Location).path();
  }

  it('renders the map at the root route', async () => {
    const harness = await RouterTestingHarness.create('/');
    expect(harness.routeNativeElement?.querySelector('h1')?.textContent).toContain(
      'Cloudflare 제품 지도',
    );
  });

  it('renders the composition graph at /solutions', async () => {
    const harness = await RouterTestingHarness.create('/solutions');
    expect(harness.routeNativeElement?.querySelector('h1')?.textContent).toContain(
      '솔루션 구성 그래프',
    );
  });

  it('redirects the retired /browse route to the map', async () => {
    const harness = await RouterTestingHarness.create('/browse');
    expect(path()).toBe('');
    expect(harness.routeNativeElement?.querySelector('h1')?.textContent).toContain(
      'Cloudflare 제품 지도',
    );
  });

  it('redirects the retired /discovery route to the map', async () => {
    await RouterTestingHarness.create('/discovery');
    expect(path()).toBe('');
  });

  it('redirects the retired /relationships route to the graph', async () => {
    const harness = await RouterTestingHarness.create('/relationships');
    expect(path()).toBe('/solutions');
    expect(harness.routeNativeElement?.querySelector('h1')?.textContent).toContain(
      '솔루션 구성 그래프',
    );
  });

  it('maps a retired product detail deep link onto the map panel selection', async () => {
    const harness = await RouterTestingHarness.create('/products/waf');
    expect(path()).toBe('?product=waf');
    expect(harness.routeNativeElement?.querySelector('.p-name')?.textContent).toContain(
      'Web Application Firewall',
    );
  });

  it('maps a retired solution detail deep link onto the graph focus', async () => {
    const harness = await RouterTestingHarness.create('/solutions/sase');
    expect(path()).toBe('/solutions?solution=sase');
    expect(harness.routeNativeElement?.querySelector('.hub text')?.textContent).toContain('SASE');
  });

  it('sends unknown routes to the map via the wildcard', async () => {
    await RouterTestingHarness.create('/no-such-page');
    expect(path()).toBe('');
  });

  it('gates a redirected deep link behind the loading state until success', async () => {
    state.set({ kind: 'loading' });
    const harness = await RouterTestingHarness.create('/products/waf');

    const shell = harness.fixture.nativeElement as HTMLElement;
    expect(path()).toBe('?product=waf');
    expect(shell.textContent).toContain('불러오는 중');
    expect(shell.querySelector('.map-page')).toBeNull();

    state.set({ kind: 'success', catalog });
    await harness.fixture.whenStable();
    expect(shell.querySelector('.p-name')?.textContent).toContain('Web Application Firewall');
  });
});
