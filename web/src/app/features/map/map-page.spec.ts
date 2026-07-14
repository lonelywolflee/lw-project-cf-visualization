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
      name: 'WAF',
      summary: 'Filters malicious HTTP traffic.',
      familyId: 'security',
      sourceIds: [source.id],
    },
    {
      id: 'ddos',
      name: 'DDoS Protection',
      summary: 'Absorbs attacks across layers.',
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
      id: 'newcomer',
      name: 'Newcomer',
      summary: 'Not yet curated.',
      familyId: 'security',
      sourceIds: [source.id],
    },
  ],
  solutions: [],
  useCases: [],
  relationships: [],
};

const curatedData: CuratedData = {
  schemaVersion: '1',
  products: [
    {
      productId: 'waf',
      roleKo: '웹 공격 패턴을 차단합니다.',
      placements: [{ lane: 'public-web', layer: 'application-security' }],
      sourceUrl: 'https://www.cloudflare.com/application-services/products/waf/',
      verifiedAt: '2026-07-14T00:00:00Z',
    },
    {
      productId: 'ddos',
      roleKo: 'L3~L7 DDoS를 흡수합니다.',
      placements: [
        { lane: 'public-web', layer: 'network-l3-l4' },
        { lane: 'public-web', layer: 'application-security' },
      ],
      sourceUrl: 'https://www.cloudflare.com/products/',
      verifiedAt: '2026-07-14T00:00:00Z',
    },
    {
      productId: 'workers',
      roleKo: '엣지 서버리스 코드입니다.',
      placements: [{ lane: 'public-web', layer: 'compute-platform' }],
      sourceUrl: 'https://www.cloudflare.com/products/workers/',
      verifiedAt: '2026-07-14T00:00:00Z',
    },
  ],
  compositions: [],
  pricing: [
    {
      productId: 'workers',
      tiers: [
        {
          id: 'free',
          name: 'Free',
          monthlyUsd: 0,
          limits: [{ metric: 'requests', included: 100_000, per: 'day', labelKo: '요청 수' }],
        },
        {
          id: 'paid',
          name: 'Paid',
          monthlyUsd: 5,
          meters: [
            {
              metric: 'requests',
              included: 10_000_000,
              per: 'month',
              overage: { usd: 0.3, perUnits: 1_000_000 },
              labelKo: '요청 수',
            },
          ],
        },
      ],
      sourceUrl: 'https://developers.cloudflare.com/workers/platform/pricing/',
      verifiedAt: '2026-07-14T00:00:00Z',
    },
  ],
};

describe('MapPage', () => {
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
        curatedStoreStub({ kind: 'success', curated: curatedData }).provider,
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

  function chips(element: HTMLElement | null): HTMLButtonElement[] {
    return Array.from(element?.querySelectorAll<HTMLButtonElement>('button.chip') ?? []);
  }

  function chipByName(element: HTMLElement | null, name: string): HTMLButtonElement | undefined {
    return chips(element).find((chip) => chip.textContent?.trim() === name);
  }

  it('renders both lanes with their layers in traversal order', async () => {
    const harness = await RouterTestingHarness.create('/');
    const element = harness.routeNativeElement;

    const lanes = Array.from(element?.querySelectorAll('.lane:not(.lane-unplaced)') ?? []);
    expect(lanes).toHaveLength(2);
    expect(lanes[0]?.getAttribute('aria-label')).toContain('공개 웹');
    expect(lanes[1]?.getAttribute('aria-label')).toContain('Zero Trust');

    const layerNames = Array.from(
      lanes[0]?.querySelectorAll<HTMLElement>('.layer .layer-name') ?? [],
    ).map((node) => node.textContent?.trim() ?? '');
    expect(layerNames[0]).toContain('DNS · 연결');
    expect(layerNames.at(-1)).toContain('관측');
    expect(layerNames.at(-1)).toContain('경로 밖');
  });

  it('groups the compute band by family and shows the origin-bypass note', async () => {
    const harness = await RouterTestingHarness.create('/');
    const element = harness.routeNativeElement;

    const compute = element?.querySelector('.layer.origin-bypass');
    expect(compute?.querySelector('.family-name')?.textContent).toContain('Compute');
    expect(compute?.querySelector('.bypass-note')?.textContent).toContain('Origin 서버가 필요');
  });

  it('places a multi-placement product on every one of its layers', async () => {
    const harness = await RouterTestingHarness.create('/');
    const element = harness.routeNativeElement;

    const ddosChips = chips(element).filter(
      (chip) => chip.textContent?.trim() === 'DDoS Protection',
    );
    expect(ddosChips).toHaveLength(2);
  });

  it('lists products without curated placement under 배치 미정', async () => {
    const harness = await RouterTestingHarness.create('/');
    const element = harness.routeNativeElement;

    const unplaced = element?.querySelector('.lane-unplaced');
    expect(unplaced?.textContent).toContain('큐레이션 대기 1개');
    expect(unplaced?.textContent).toContain('Newcomer');
  });

  it('selecting a chip writes the product query param and fills the panel', async () => {
    const harness = await RouterTestingHarness.create('/');
    const element = harness.routeNativeElement;

    chipByName(element, 'Workers')?.click();
    await harness.fixture.whenStable();

    // Location.path() renders the root URL without a leading slash.
    expect(TestBed.inject(Location).path()).toBe('?product=workers');
    const panel = element?.querySelector('.panel');
    expect(panel?.querySelector('.p-name')?.textContent).toContain('Workers');
    expect(panel?.textContent).toContain('엣지 서버리스 코드입니다.');
    expect(panel?.textContent).toContain('Free');
    expect(panel?.textContent).toContain('$5/월');
    expect(panel?.textContent).toContain('초과 $0.3 / 1,000,000');
    const priceSource = panel?.querySelector<HTMLAnchorElement>('.p-src a');
    expect(priceSource?.textContent).toContain('(새 창)');
    expect(priceSource?.rel).toBe('noopener noreferrer');
    // Every placement instance of the selected product is marked pressed.
    const workersChip = chipByName(element, 'Workers');
    expect(workersChip?.getAttribute('aria-pressed')).toBe('true');
  });

  it('clicking the selected chip again clears the selection', async () => {
    const harness = await RouterTestingHarness.create('/?product=workers');
    const element = harness.routeNativeElement;

    chipByName(element, 'Workers')?.click();
    await harness.fixture.whenStable();

    // Location.path() renders the bare root URL as an empty string.
    expect(TestBed.inject(Location).path()).toBe('');
    expect(element?.querySelector('.panel .p-hint')).not.toBeNull();
  });

  it('restores the selection from a deep link', async () => {
    const harness = await RouterTestingHarness.create('/?product=waf');
    const element = harness.routeNativeElement;

    expect(element?.querySelector('.panel .p-name')?.textContent).toContain('WAF');
    expect(chipByName(element, 'WAF')?.getAttribute('aria-pressed')).toBe('true');
  });

  it('ignores an unknown product id from the URL instead of crashing', async () => {
    const harness = await RouterTestingHarness.create('/?product=%3Cscript%3E');
    const element = harness.routeNativeElement;

    expect(element?.querySelector('.panel .p-hint')).not.toBeNull();
    expect(chips(element).every((chip) => chip.getAttribute('aria-pressed') !== 'true')).toBe(true);
  });

  it('shows an explicit placeholder for a selected product without pricing', async () => {
    const harness = await RouterTestingHarness.create('/?product=waf');
    const element = harness.routeNativeElement;

    expect(element?.querySelector('.panel .p-missing')?.textContent).toContain(
      '요금 데이터 큐레이션 예정',
    );
  });

  it('keeps every chip a real button for keyboard equivalence', async () => {
    const harness = await RouterTestingHarness.create('/');
    const element = harness.routeNativeElement;

    const allChips = chips(element);
    expect(allChips.length).toBeGreaterThan(0);
    expect(allChips.every((chip) => chip.getAttribute('type') === 'button')).toBe(true);
  });
});
