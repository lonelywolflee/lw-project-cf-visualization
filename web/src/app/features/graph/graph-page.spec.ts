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
  id: 'solutions-overview',
  url: 'https://www.cloudflare.com/solutions/',
  pageKind: 'marketing-overview',
  title: 'Solutions',
  retrievedAt: '2026-07-14T00:00:00Z',
} as const;

const catalog: Catalog = {
  schemaVersion: '1',
  generatedAt: '2026-07-14T00:00:00Z',
  sources: [source],
  productFamilies: [
    { id: 'security', name: 'Security', summary: 'Security products.', sourceIds: [source.id] },
  ],
  products: [
    {
      id: 'waf',
      name: 'WAF',
      summary: 'Filters malicious traffic.',
      familyId: 'security',
      sourceIds: [source.id],
    },
    {
      id: 'ddos',
      name: 'DDoS Protection',
      summary: 'Absorbs attacks.',
      familyId: 'security',
      sourceIds: [source.id],
    },
    {
      id: 'gateway',
      name: 'Gateway',
      summary: 'Filters outbound traffic.',
      familyId: 'security',
      sourceIds: [source.id],
    },
  ],
  solutions: [
    { id: 'security', name: 'Security', summary: 'Protect apps.', sourceIds: [source.id] },
    { id: 'sase', name: 'Cloudflare One', summary: 'SASE platform.', sourceIds: [source.id] },
    { id: 'retail', name: 'Retail', summary: 'Retail experiences.', sourceIds: [source.id] },
  ],
  useCases: [],
  relationships: [],
};

const curatedData: CuratedData = {
  schemaVersion: '1',
  learningNotes: [],
  products: [
    {
      productId: 'ddos',
      roleKo: 'L3~L7 DDoS를 흡수합니다.',
      placements: [{ lane: 'public-web', layer: 'network-l3-l4' }],
      sourceUrl: 'https://www.cloudflare.com/products/',
      verifiedAt: '2026-07-14T00:00:00Z',
    },
  ],
  compositions: [
    {
      solutionId: 'security',
      productIds: ['waf', 'ddos'],
      sourceUrl: 'https://www.cloudflare.com/solutions/security/',
      verifiedAt: '2026-07-14T00:00:00Z',
    },
    {
      solutionId: 'sase',
      productIds: ['gateway', 'ddos'],
      sourceUrl: 'https://www.cloudflare.com/sase/',
      verifiedAt: '2026-07-14T00:00:00Z',
    },
  ],
  pricing: [
    {
      productId: 'ddos',
      tiers: [{ id: 'free', name: 'Free', monthlyUsd: 0 }],
      sourceUrl: 'https://www.cloudflare.com/plans/',
      verifiedAt: '2026-07-14T00:00:00Z',
    },
  ],
};

describe('GraphPage', () => {
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

  it('renders the overview grid with member counts and the uncurated badge', async () => {
    const harness = await RouterTestingHarness.create('/solutions');
    const element = harness.routeNativeElement;

    const cards = Array.from(element?.querySelectorAll<HTMLButtonElement>('.solution-card') ?? []);
    expect(cards.map((card) => card.querySelector('.card-name')?.textContent?.trim())).toEqual([
      'Cloudflare One',
      'Retail',
      'Security',
    ]);
    expect(cards[2]?.textContent).toContain('구성 제품 2개');
    expect(cards[1]?.textContent).toContain('구성 미확인');
    expect(cards.every((card) => card.getAttribute('type') === 'button')).toBe(true);
  });

  it('focuses a solution from a card click and renders every composition edge', async () => {
    const harness = await RouterTestingHarness.create('/solutions');
    const element = harness.routeNativeElement;

    Array.from(element?.querySelectorAll<HTMLButtonElement>('.solution-card') ?? [])
      .find((card) => card.textContent?.includes('Security'))
      ?.click();
    await harness.fixture.whenStable();

    expect(TestBed.inject(Location).path()).toBe('/solutions?solution=security');
    expect(element?.querySelectorAll('.graph-svg .edge')).toHaveLength(2);
    expect(element?.querySelector('.hub text')?.textContent).toContain('Security');
    const chips = Array.from(element?.querySelectorAll<HTMLButtonElement>('.chip') ?? []);
    expect(chips.map((chip) => chip.textContent?.trim().split('\n')[0]?.trim())).toHaveLength(2);
  });

  it('marks shared products on the edge, the chip badge, and the panel pivot', async () => {
    const harness = await RouterTestingHarness.create('/solutions?solution=security');
    const element = harness.routeNativeElement;

    expect(element?.querySelectorAll('.edge-shared')).toHaveLength(1);
    expect(element?.querySelectorAll('.shared-ring')).toHaveLength(1);
    const sharedChip = Array.from(element?.querySelectorAll<HTMLButtonElement>('.chip') ?? []).find(
      (chip) => chip.textContent?.includes('DDoS Protection'),
    );
    expect(sharedChip?.querySelector('.shared-badge')?.textContent).toContain('공유');

    sharedChip?.click();
    await harness.fixture.whenStable();

    expect(element?.querySelector('.p-name')?.textContent).toContain('DDoS Protection');
    const pivot = element?.querySelector<HTMLButtonElement>('.pivot-button');
    expect(pivot?.textContent).toContain('Cloudflare One 구성 보기');
  });

  it('pivots to the sharing solution while keeping the selected product', async () => {
    const harness = await RouterTestingHarness.create('/solutions?solution=security&product=ddos');
    const element = harness.routeNativeElement;

    element?.querySelector<HTMLButtonElement>('.pivot-button')?.click();
    await harness.fixture.whenStable();

    expect(TestBed.inject(Location).path()).toBe('/solutions?solution=sase&product=ddos');
    expect(element?.querySelector('.hub text')?.textContent).toContain('Cloudflare One');
    expect(element?.querySelector('.p-name')?.textContent).toContain('DDoS Protection');
  });

  it('shows the solution card with a calculator link preloading priced members', async () => {
    const harness = await RouterTestingHarness.create('/solutions?solution=security');
    const element = harness.routeNativeElement;

    expect(element?.querySelector('.s-name')?.textContent).toContain('Security');
    const costLink = element?.querySelector<HTMLAnchorElement>('.s-cost-link');
    expect(costLink?.textContent).toContain('요금 계산기');
    expect(costLink?.getAttribute('href')).toBe('/calculator?products=ddos');
  });

  it('renders the explicit empty state for a solution without a composition', async () => {
    const harness = await RouterTestingHarness.create('/solutions?solution=retail');
    const element = harness.routeNativeElement;

    const empty = element?.querySelector('.empty-composition');
    expect(empty?.getAttribute('role')).toBe('status');
    expect(empty?.textContent).toContain('아직 큐레이션되지 않았습니다');
    expect(element?.querySelector('.graph-svg')).toBeNull();
    // Without priced members there is nothing to calculate — explicit note.
    expect(element?.querySelector('.s-cost-note')?.textContent).toContain('계산할 수 없습니다');
  });

  it('restores focus and selection from a deep link with pressed chips', async () => {
    const harness = await RouterTestingHarness.create('/solutions?solution=security&product=ddos');
    const element = harness.routeNativeElement;

    const pressed = Array.from(
      element?.querySelectorAll<HTMLButtonElement>('.chip[aria-pressed="true"]') ?? [],
    );
    expect(pressed).toHaveLength(1);
    expect(pressed[0]?.textContent).toContain('DDoS Protection');
    expect(element?.querySelector('.p-name')?.textContent).toContain('DDoS Protection');
  });

  it('collapses unknown solution and product ids from the URL safely', async () => {
    const harness = await RouterTestingHarness.create(
      '/solutions?solution=%3Cscript%3E&product=ghost',
    );
    const element = harness.routeNativeElement;

    // Unknown solution → overview; unknown product → no selection anywhere.
    expect(element?.querySelectorAll('.solution-card').length).toBeGreaterThan(0);
    expect(element?.querySelector('.graph-svg')).toBeNull();
  });

  it('returns to the overview and clears both params via the back button', async () => {
    const harness = await RouterTestingHarness.create('/solutions?solution=security&product=ddos');
    const element = harness.routeNativeElement;

    element?.querySelector<HTMLButtonElement>('.back-button')?.click();
    await harness.fixture.whenStable();

    expect(TestBed.inject(Location).path()).toBe('/solutions');
    expect(element?.querySelectorAll('.solution-card').length).toBe(3);
  });
});
