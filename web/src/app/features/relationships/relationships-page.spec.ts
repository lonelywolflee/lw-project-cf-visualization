import { Location } from '@angular/common';
import { computed, signal, type WritableSignal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, withComponentInputBinding } from '@angular/router';
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
    { id: 'compute', name: 'Compute', summary: 'Compute products.', sourceIds: [source.id] },
  ],
  products: [
    {
      id: 'workers',
      name: 'Workers',
      summary: 'Serverless compute at the edge.',
      familyId: 'compute',
      sourceIds: [source.id],
    },
    {
      id: 'cdn',
      name: 'CDN',
      summary: 'Content delivery network.',
      familyId: 'compute',
      sourceIds: [source.id],
    },
    {
      id: 'waf',
      name: 'Web Application Firewall',
      summary: 'Filters malicious HTTP traffic.',
      familyId: 'compute',
      sourceIds: [source.id],
    },
  ],
  solutions: [
    { id: 'sase', name: 'SASE', summary: 'Zero trust platform.', sourceIds: [source.id] },
  ],
  useCases: [
    {
      id: 'edge-compute',
      name: 'Edge compute',
      summary: 'Run code close to users.',
      sourceIds: [source.id],
    },
    {
      id: 'remote-access',
      name: 'Remote access',
      summary: 'Modernize remote access.',
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
    {
      type: 'product-use-case',
      fromId: 'cdn',
      toId: 'edge-compute',
      sourceIds: [source.id],
    },
    {
      type: 'solution-use-case',
      fromId: 'sase',
      toId: 'remote-access',
      sourceIds: [source.id],
    },
  ],
};

describe('RelationshipsPage', () => {
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

  it('renders the same filtered projection in the SVG and the list', async () => {
    const harness = await RouterTestingHarness.create('/relationships');
    const element = harness.routeNativeElement!;

    // 3 edges, 5 connected nodes (waf has no edge) in both representations.
    expect(element.querySelectorAll('svg.graph path.edge').length).toBe(3);
    expect(element.querySelectorAll('svg.graph g.node').length).toBe(5);
    expect(element.querySelectorAll('.edge-list .edge-button').length).toBe(3);
    expect(element.querySelector('.result-count')?.textContent).toContain('관계 3건');
  });

  it('groups the list by relationship type with counts', async () => {
    const harness = await RouterTestingHarness.create('/relationships');
    const element = harness.routeNativeElement!;

    const headings = Array.from(element.querySelectorAll('.edge-group h3'));
    expect(headings.map((h) => h.querySelector('[lang="en"]')?.textContent?.trim())).toEqual([
      'Product – Use case',
      'Solution – Use case',
    ]);
    expect(headings.map((h) => h.querySelector('.count')?.textContent?.trim())).toEqual([
      '2건',
      '1건',
    ]);
  });

  it('selecting an edge from the list shows type, endpoints, and sources', async () => {
    const harness = await RouterTestingHarness.create('/relationships');
    const element = harness.routeNativeElement!;

    const button = Array.from(
      element.querySelectorAll<HTMLButtonElement>('.edge-list .edge-button'),
    ).find((candidate) => candidate.textContent?.includes('Workers'));
    button!.click();
    await harness.fixture.whenStable();

    expect(button!.getAttribute('aria-pressed')).toBe('true');
    const panel = element.querySelector('.detail-panel')!;
    expect(panel.querySelector('.selection-status')?.textContent).toContain(
      'Product – Use case: Workers → Edge compute',
    );
    expect(panel.textContent).toContain('product-use-case');
    // Product endpoint links to the catalog detail route; use case is text + summary.
    const link = panel.querySelector<HTMLAnchorElement>('a[href="/products/workers"]');
    expect(link?.textContent).toContain('Workers');
    expect(panel.textContent).toContain('Run code close to users.');
    // Source uses the safe-link markup.
    const sourceLink = panel.querySelector<HTMLAnchorElement>('.source-list a');
    expect(sourceLink?.getAttribute('href')).toBe(source.url);
    expect(sourceLink?.getAttribute('rel')).toBe('noopener noreferrer');
    expect(sourceLink?.getAttribute('target')).toBe('_blank');
  });

  it('reaches the node detail by keyboard through the edge-detail pivot button', async () => {
    const harness = await RouterTestingHarness.create('/relationships');
    const element = harness.routeNativeElement!;

    const edgeButton = Array.from(
      element.querySelectorAll<HTMLButtonElement>('.edge-list .edge-button'),
    ).find((candidate) => candidate.textContent?.includes('Workers'));
    edgeButton!.click();
    await harness.fixture.whenStable();

    // The pivot buttons make node detail reachable without the pointer-only SVG.
    const pivot = element.querySelector<HTMLButtonElement>('.detail-panel .pivot-button');
    expect(pivot?.getAttribute('aria-label')).toContain('이 항목의 관계 보기');
    pivot!.click();
    await harness.fixture.whenStable();

    const panel = element.querySelector('.detail-panel')!;
    expect(panel.querySelector('.node-title')).not.toBeNull();
    expect(panel.querySelectorAll('.connected-list .edge-button').length).toBeGreaterThan(0);
  });

  it('clicking an SVG node selects it and lists its connected edges', async () => {
    const harness = await RouterTestingHarness.create('/relationships');
    const element = harness.routeNativeElement!;

    const nodes = Array.from(element.querySelectorAll<SVGGElement>('svg.graph g.node'));
    const edgeCompute = nodes.find((node) => node.textContent?.includes('Edge compute'));
    edgeCompute!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await harness.fixture.whenStable();

    const panel = element.querySelector('.detail-panel')!;
    expect(panel.querySelector('.selection-status')?.textContent).toContain('Edge compute');
    const connected = Array.from(panel.querySelectorAll('.connected-list .edge-button')).map(
      (button) => button.textContent?.trim(),
    );
    expect(connected).toEqual([
      'Product – Use case: CDN → Edge compute',
      'Product – Use case: Workers → Edge compute',
    ]);
    expect(edgeCompute!.classList.contains('selected')).toBe(true);
  });

  it('type filter from the URL narrows BOTH representations consistently', async () => {
    const harness = await RouterTestingHarness.create('/relationships?type=solution-use-case');
    const element = harness.routeNativeElement!;

    expect(element.querySelectorAll('svg.graph path.edge').length).toBe(1);
    expect(element.querySelectorAll('svg.graph g.node').length).toBe(2);
    expect(element.querySelectorAll('.edge-list .edge-button').length).toBe(1);
    expect(element.querySelector('.result-count')?.textContent).toContain('관계 1건');
    const select = element.querySelector<HTMLSelectElement>('#relationships-type');
    expect(select?.value).toBe('solution-use-case');
  });

  it('category filter keeps edges touching the kind and updates the URL', async () => {
    const harness = await RouterTestingHarness.create('/relationships');
    const location = TestBed.inject(Location);
    const element = harness.routeNativeElement!;

    const select = element.querySelector<HTMLSelectElement>('#relationships-category')!;
    select.value = 'product';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    await harness.fixture.whenStable();

    expect(location.path()).toBe('/relationships?category=product');
    expect(element.querySelectorAll('svg.graph path.edge').length).toBe(2);
    expect(element.querySelectorAll('.edge-list .edge-button').length).toBe(2);
  });

  it('drops invalid filter params without failing', async () => {
    const harness = await RouterTestingHarness.create('/relationships?type=bogus&category=nope');
    const element = harness.routeNativeElement!;
    expect(element.querySelector('.result-count')?.textContent).toContain('관계 3건');
  });

  it('a selection hidden by a later filter falls back to the placeholder', async () => {
    const harness = await RouterTestingHarness.create('/relationships');
    const element = harness.routeNativeElement!;

    const button = Array.from(
      element.querySelectorAll<HTMLButtonElement>('.edge-list .edge-button'),
    ).find((candidate) => candidate.textContent?.includes('Workers'));
    button!.click();
    await harness.fixture.whenStable();
    expect(element.querySelector('.detail-panel .facts')).not.toBeNull();

    const select = element.querySelector<HTMLSelectElement>('#relationships-type')!;
    select.value = 'solution-use-case';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    await harness.fixture.whenStable();

    expect(element.querySelector('.detail-panel .facts')).toBeNull();
    expect(element.querySelector('.detail-panel .placeholder')).not.toBeNull();
    expect(element.querySelector('.selection-status')?.textContent).toContain(
      '선택된 항목이 없습니다',
    );
  });

  it('activating a pressed edge button toggles the selection off', async () => {
    const harness = await RouterTestingHarness.create('/relationships');
    const element = harness.routeNativeElement!;

    const button = element.querySelector<HTMLButtonElement>('.edge-list .edge-button')!;
    button.click();
    await harness.fixture.whenStable();
    expect(button.getAttribute('aria-pressed')).toBe('true');

    button.click();
    await harness.fixture.whenStable();
    expect(button.getAttribute('aria-pressed')).toBe('false');
    expect(element.querySelector('.detail-panel .placeholder')).not.toBeNull();
  });

  it('keeps focus on the activating button when the detail panel changes', async () => {
    const harness = await RouterTestingHarness.create('/relationships');
    const element = harness.routeNativeElement!;

    const button = element.querySelector<HTMLButtonElement>('.edge-list .edge-button')!;
    button.focus();
    button.click();
    await harness.fixture.whenStable();

    expect(document.activeElement).toBe(button);
  });

  it('reports the honest disconnected counts', async () => {
    const harness = await RouterTestingHarness.create('/relationships');
    const note = harness.routeNativeElement!.querySelector('.disconnected-note');
    // waf has no edge; every solution and use case in the fixture is connected.
    expect(note?.textContent).toContain('product 1개');
    expect(note?.textContent).toContain('solution 0개');
    expect(note?.textContent).toContain('use case 0개');
  });

  it('renders a clear empty state when the catalog has no relationships', async () => {
    state.set({ kind: 'success', catalog: { ...catalog, relationships: [] } });
    const harness = await RouterTestingHarness.create('/relationships');
    const element = harness.routeNativeElement!;

    expect(element.querySelector('.state-empty')?.textContent).toContain(
      '아직 수집된 관계가 없습니다',
    );
    expect(element.querySelector('svg.graph')).toBeNull();
    expect(element.querySelector('.edge-list')).toBeNull();
  });

  it('hides the SVG from assistive tech and keeps it free of focusable elements', async () => {
    const harness = await RouterTestingHarness.create('/relationships');
    const element = harness.routeNativeElement!;

    const svg = element.querySelector('svg.graph')!;
    expect(svg.getAttribute('aria-hidden')).toBe('true');
    expect(svg.querySelectorAll('[tabindex], a, button').length).toBe(0);
    // The legend explains the non-color encodings and stays visible to AT.
    const legend = element.querySelector('.legend')!;
    expect(legend.textContent).toContain('Product – Use case');
    expect(legend.textContent).toContain('Solution – Use case');
  });

  it('gates a deep link behind the shell loading state', async () => {
    state.set({ kind: 'loading' });
    const harness = await RouterTestingHarness.create('/relationships?type=product-use-case');

    const shell = harness.fixture.nativeElement as HTMLElement;
    expect(shell.textContent).toContain('불러오는 중');
    expect(shell.querySelector('.edge-list')).toBeNull();

    state.set({ kind: 'success', catalog });
    await harness.fixture.whenStable();
    expect(shell.querySelectorAll('.edge-list .edge-button').length).toBe(2);
  });
});
