import { Location } from '@angular/common';
import { computed, signal, type WritableSignal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter, withComponentInputBinding } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import type { Catalog } from '@cf-viz/catalog';

import { routes } from '../../app.routes';
import type { CatalogState } from '../../core/catalog/catalog-state';
import { CatalogStore } from '../../core/catalog/catalog-store';
import { curatedStoreStub } from '../../testing/curated-store-stub';

const source = {
  id: 'products-overview',
  url: 'https://www.cloudflare.com/products/',
  pageKind: 'marketing-overview',
  title: 'Our products',
  retrievedAt: '2026-07-14T00:00:00Z',
} as const;

const catalog: Catalog = {
  schemaVersion: '1',
  generatedAt: '2026-07-14T00:00:00Z',
  sources: [source],
  productFamilies: [
    { id: 'security', name: 'Security', summary: 'Security products.', sourceIds: [source.id] },
    { id: 'compute', name: 'Compute', summary: 'Compute products.', sourceIds: [source.id] },
  ],
  products: [
    {
      id: 'waf',
      name: 'Web Application Firewall',
      summary: 'Filters malicious HTTP traffic.',
      familyId: 'security',
      sourceIds: [source.id],
    },
    {
      id: 'workers',
      name: 'Workers',
      summary: 'Serverless compute at the edge.',
      familyId: 'compute',
      sourceIds: [source.id],
    },
    {
      id: 'containers',
      name: 'Containers',
      summary: 'Run containers on the edge.',
      familyId: 'compute',
      sourceIds: [source.id],
    },
  ],
  solutions: [
    {
      id: 'sase',
      name: 'SASE',
      summary: 'Secure access service edge platform.',
      sourceIds: [source.id],
    },
  ],
  useCases: [
    {
      id: 'edge-compute',
      name: 'Edge compute',
      summary: 'Run code close to users.',
      sourceIds: [source.id],
    },
  ],
  relationships: [
    {
      type: 'product-use-case',
      fromId: 'workers',
      toId: 'edge-compute',
      sourceIds: [source.id],
    },
  ],
};

describe('DiscoveryPage', () => {
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

  it('binds query params to same-named inputs on a deep link', async () => {
    const harness = await RouterTestingHarness.create('/discovery?q=firewall&family=security');
    const element = harness.routeNativeElement;

    const input = element?.querySelector<HTMLInputElement>('#discovery-q');
    expect(input?.value).toBe('firewall');
    const familySelect = element?.querySelector<HTMLSelectElement>('#discovery-family');
    expect(familySelect?.value).toBe('security');

    const links = Array.from(element?.querySelectorAll<HTMLAnchorElement>('.link-list a') ?? []);
    expect(links.map((a) => a.getAttribute('href'))).toEqual(['/products/waf']);
    expect(element?.querySelector('.result-count')?.textContent).toContain('결과 1건');
  });

  it('restores all three params on a deep link, including the selects’ selected options', async () => {
    const harness = await RouterTestingHarness.create(
      '/discovery?q=serverless&family=compute&useCase=edge-compute',
    );
    const element = harness.routeNativeElement;

    expect(element?.querySelector<HTMLInputElement>('#discovery-q')?.value).toBe('serverless');

    // The [selected]-per-option binding must survive the initial render:
    // assert the actual selected <option>, not only the select's value.
    const familySelect = element?.querySelector<HTMLSelectElement>('#discovery-family');
    expect(familySelect?.value).toBe('compute');
    const selectedFamily = Array.from(familySelect?.options ?? []).find((o) => o.selected);
    expect(selectedFamily?.textContent).toContain('Compute');

    const useCaseSelect = element?.querySelector<HTMLSelectElement>('#discovery-use-case');
    expect(useCaseSelect?.value).toBe('edge-compute');
    const selectedUseCase = Array.from(useCaseSelect?.options ?? []).find((o) => o.selected);
    expect(selectedUseCase?.textContent).toContain('Edge compute');

    const links = Array.from(element?.querySelectorAll<HTMLAnchorElement>('.link-list a') ?? []);
    expect(links.map((a) => a.getAttribute('href'))).toEqual(['/products/workers']);
    expect(element?.querySelector('.result-count')?.textContent).toContain('결과 1건');
  });

  it('matches case-insensitively over name and summary', async () => {
    const harness = await RouterTestingHarness.create('/discovery?q=SERVERLESS');
    const element = harness.routeNativeElement;
    const links = Array.from(element?.querySelectorAll<HTMLAnchorElement>('.link-list a') ?? []);
    expect(links.map((a) => a.getAttribute('href'))).toEqual(['/products/workers']);
  });

  it('drops invalid family/useCase params without failing', async () => {
    const harness = await RouterTestingHarness.create('/discovery?family=bogus&useCase=nope');
    const element = harness.routeNativeElement;

    expect(element?.querySelector('.result-count')?.textContent).toContain('결과 4건');
    expect(element?.querySelectorAll('.chip').length).toBe(0);
    const familySelect = element?.querySelector<HTMLSelectElement>('#discovery-family');
    expect(familySelect?.value).toBe('');
  });

  it('tolerates repeated params (array values) by taking the first occurrence', async () => {
    const harness = await RouterTestingHarness.create(
      '/discovery?family=security&family=compute&q=a&q=b',
    );
    const element = harness.routeNativeElement;
    const familySelect = element?.querySelector<HTMLSelectElement>('#discovery-family');
    expect(familySelect?.value).toBe('security');
    const input = element?.querySelector<HTMLInputElement>('#discovery-q');
    expect(input?.value).toBe('a');
  });

  it('typing updates the URL via replaceUrl and recomputes results', async () => {
    const harness = await RouterTestingHarness.create('/discovery');
    const location = TestBed.inject(Location);
    const element = harness.routeNativeElement;
    const input = element?.querySelector<HTMLInputElement>('#discovery-q');
    expect(input).toBeTruthy();

    input!.value = 'container';
    input!.dispatchEvent(new Event('input', { bubbles: true }));
    await harness.fixture.whenStable();

    expect(location.path()).toBe('/discovery?q=container');
    expect(input!.value).toBe('container'); // no feedback clobber
    const links = Array.from(element?.querySelectorAll<HTMLAnchorElement>('.link-list a') ?? []);
    expect(links.map((a) => a.getAttribute('href'))).toEqual(['/products/containers']);
  });

  it('settles rapid input events on the last value; keystrokes leave no history entries', async () => {
    const harness = await RouterTestingHarness.create('/');
    await harness.navigateByUrl('/discovery');
    const router = TestBed.inject(Router);
    const input = harness.routeNativeElement?.querySelector<HTMLInputElement>('#discovery-q');

    input!.value = 'w';
    input!.dispatchEvent(new Event('input', { bubbles: true }));
    input!.value = 'wo';
    input!.dispatchEvent(new Event('input', { bubbles: true }));
    input!.value = 'wor';
    input!.dispatchEvent(new Event('input', { bubbles: true }));
    await harness.fixture.whenStable();

    expect(router.url).toBe('/discovery?q=wor');
    expect(input!.value).toBe('wor');

    // replaceUrl semantics: typing replaces the current /discovery entry,
    // so back() skips every keystroke and returns to the previous page.
    // Router.url lags popstate-driven navigation, so assert history via
    // Location.path() after a macrotask wait.
    const location = TestBed.inject(Location);
    location.back();
    await new Promise((resolve) => setTimeout(resolve));
    await harness.fixture.whenStable();
    expect(location.path()).toBe(''); // root: keystrokes left no entries
  });

  it('composes filters with AND and removes them independently', async () => {
    const harness = await RouterTestingHarness.create('/discovery?q=edge');
    const location = TestBed.inject(Location);
    const element = harness.routeNativeElement;

    // q=edge matches workers (summary), containers (summary), sase (summary).
    expect(element?.querySelector('.result-count')?.textContent).toContain('결과 3건');

    // Add useCase filter: only workers has the edge.
    const useCaseSelect = element?.querySelector<HTMLSelectElement>('#discovery-use-case');
    useCaseSelect!.value = 'edge-compute';
    useCaseSelect!.dispatchEvent(new Event('change', { bubbles: true }));
    await harness.fixture.whenStable();

    expect(location.path()).toBe('/discovery?q=edge&useCase=edge-compute');
    expect(element?.querySelector('.result-count')?.textContent).toContain('결과 1건');

    // Remove only the q chip; the useCase filter stays applied.
    const qChipRemove = element?.querySelector<HTMLButtonElement>(
      'button[aria-label^="검색어 제거"]',
    );
    qChipRemove!.click();
    await harness.fixture.whenStable();

    expect(location.path()).toBe('/discovery?useCase=edge-compute');
    expect(element?.querySelector('.result-count')?.textContent).toContain('결과 1건');
  });

  it('clears every criterion to the bare route via the 모두 지우기 chip', async () => {
    const harness = await RouterTestingHarness.create('/discovery?q=edge&useCase=edge-compute');
    const location = TestBed.inject(Location);
    const element = harness.routeNativeElement;

    expect(element?.querySelector('.result-count')?.textContent).toContain('결과 1건');
    const clearAll = element?.querySelector<HTMLButtonElement>('.chip-clear button');
    expect(clearAll?.textContent).toContain('모두 지우기');
    clearAll!.click();
    await harness.fixture.whenStable();

    expect(location.path()).toBe('/discovery');
    expect(element?.querySelectorAll('.chip').length).toBe(0);
    expect(element?.querySelector('.result-count')?.textContent).toContain('결과 4건');
  });

  it('excludes solutions under a family filter with an explanatory note', async () => {
    const harness = await RouterTestingHarness.create('/discovery?family=compute');
    const element = harness.routeNativeElement;

    expect(element?.querySelector('.result-count')?.textContent).toContain('결과 2건');
    const solutionSection = element?.querySelector(
      '[aria-labelledby="discovery-solutions-heading"]',
    );
    expect(solutionSection?.textContent).toContain('family 필터 적용 중에는 제외됩니다');
    expect(solutionSection?.querySelectorAll('a').length).toBe(0);
  });

  it('offers a reset in the no-results state that empties the query string', async () => {
    const harness = await RouterTestingHarness.create('/discovery?q=zzzznothing');
    const location = TestBed.inject(Location);
    const element = harness.routeNativeElement;

    expect(element?.querySelector('.result-count')?.textContent).toContain('결과 0건');
    const reset = element?.querySelector<HTMLButtonElement>('.no-results button');
    expect(reset?.textContent).toContain('필터 초기화');
    reset!.click();
    await harness.fixture.whenStable();

    expect(location.path()).toBe('/discovery');
    expect(element?.querySelector('.result-count')?.textContent).toContain('결과 4건');
  });

  it('links results to the product and solution detail routes', async () => {
    const harness = await RouterTestingHarness.create('/discovery');
    const element = harness.routeNativeElement;

    const hrefs = Array.from(
      element?.querySelectorAll<HTMLAnchorElement>('.link-list a') ?? [],
    ).map((a) => a.getAttribute('href'));
    expect(hrefs).toEqual([
      '/products/containers',
      '/products/waf',
      '/products/workers',
      '/solutions/sase',
    ]);
  });

  it('gates a discovery deep link behind the shell loading state', async () => {
    state.set({ kind: 'loading' });
    const harness = await RouterTestingHarness.create('/discovery?q=firewall');

    const shell = harness.fixture.nativeElement as HTMLElement;
    expect(shell.textContent).toContain('불러오는 중');
    expect(shell.querySelector('#discovery-q')).toBeNull();

    state.set({ kind: 'success', catalog });
    await harness.fixture.whenStable();

    const input = shell.querySelector<HTMLInputElement>('#discovery-q');
    expect(input?.value).toBe('firewall');
    expect(shell.querySelector('.result-count')?.textContent).toContain('결과 1건');
  });

  it('wires labels to controls, names chip remove buttons, and announces the count politely', async () => {
    const harness = await RouterTestingHarness.create(
      '/discovery?q=edge&family=security&useCase=edge-compute',
    );
    const element = harness.routeNativeElement;

    for (const id of ['discovery-q', 'discovery-family', 'discovery-use-case']) {
      const label = element?.querySelector(`label[for="${id}"]`);
      expect(label, `label for #${id}`).not.toBeNull();
      expect(element?.querySelector(`#${id}`), `control #${id}`).not.toBeNull();
    }

    expect(element?.querySelector('ul[aria-label="적용된 필터"]')).not.toBeNull();
    expect(element?.querySelector('button[aria-label^="검색어 제거"]')).not.toBeNull();
    expect(
      element?.querySelector('button[aria-label="family 필터 제거: Security"]'),
    ).not.toBeNull();
    expect(
      element?.querySelector('button[aria-label="use case 필터 제거: Edge compute"]'),
    ).not.toBeNull();

    expect(element?.querySelector('.result-count')?.getAttribute('role')).toBe('status');
  });
});
