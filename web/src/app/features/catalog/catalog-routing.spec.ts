import { computed, signal, type WritableSignal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, withComponentInputBinding } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import type { Catalog } from '@cf-viz/catalog';

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
        curatedStoreStub().provider,
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

  it('renders the overview at the root route', async () => {
    const harness = await RouterTestingHarness.create('/');
    const element = harness.routeNativeElement;

    expect(element?.querySelector('h1')?.textContent).toContain('Cloudflare 제품 카탈로그');
    expect(element?.querySelector('#family-heading-application-security')?.textContent).toContain(
      'Application security',
    );
    const productLink = element?.querySelector<HTMLAnchorElement>('a[href="/products/waf"]');
    expect(productLink?.textContent).toContain('Web Application Firewall');
    expect(element?.querySelector('a[href="/solutions/sase"]')).not.toBeNull();
  });

  it('navigates from an overview product link to the bound detail page', async () => {
    const harness = await RouterTestingHarness.create('/');

    const link =
      harness.routeNativeElement?.querySelector<HTMLAnchorElement>('a[href="/products/waf"]');
    expect(link).not.toBeNull();
    link?.click();
    await harness.fixture.whenStable();

    const element = harness.routeNativeElement;
    expect(element?.querySelector('h1')?.textContent).toContain('Web Application Firewall');
    const external = element?.querySelector<HTMLAnchorElement>('a[target="_blank"]');
    expect(external?.rel).toBe('noopener noreferrer');
  });

  it('binds the solution route param through withComponentInputBinding', async () => {
    const harness = await RouterTestingHarness.create('/solutions/sase');

    expect(harness.routeNativeElement?.querySelector('h1')?.textContent).toContain('SASE');
  });

  it('shows in-page not-found for an unknown product id without redirecting', async () => {
    const harness = await RouterTestingHarness.create('/products/does-not-exist');
    const element = harness.routeNativeElement;

    const status = element?.querySelector('[role="status"]');
    expect(status?.textContent).toContain('찾을 수 없습니다');
    expect(status?.textContent).toContain('does-not-exist');
    expect(element?.querySelector('a[href="/"]')).not.toBeNull();
  });

  it('gates a detail deep link behind the loading state until success', async () => {
    state.set({ kind: 'loading' });
    const harness = await RouterTestingHarness.create('/products/waf');

    const shell = harness.fixture.nativeElement as HTMLElement;
    expect(shell.textContent).toContain('불러오는 중');
    expect(shell.querySelector('article.detail')).toBeNull();

    state.set({ kind: 'success', catalog });
    await harness.fixture.whenStable();

    expect(shell.querySelector('h1')?.textContent).toContain('Web Application Firewall');
  });
});
