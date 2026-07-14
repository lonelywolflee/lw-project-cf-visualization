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
      id: 'r2',
      name: 'R2',
      summary: 'Egress-free object storage.',
      familyId: 'compute',
      sourceIds: [source.id],
    },
    {
      id: 'newcomer',
      name: 'Newcomer',
      summary: 'No pricing curated yet.',
      familyId: 'compute',
      sourceIds: [source.id],
    },
  ],
  solutions: [],
  useCases: [],
  relationships: [],
};

const curatedData: CuratedData = {
  schemaVersion: '1',
  learningNotes: [],
  scenarios: [],
  products: [],
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
    {
      productId: 'r2',
      tiers: [
        {
          id: 'standard',
          name: 'Standard (종량)',
          monthlyUsd: 0,
          meters: [
            {
              metric: 'storage-gb-month',
              included: 10,
              per: 'month',
              overage: { usd: 0.015, perUnits: 1 },
              labelKo: '저장 용량(GB-월)',
            },
          ],
        },
      ],
      sourceUrl: 'https://developers.cloudflare.com/r2/pricing/',
      verifiedAt: '2026-07-14T00:00:00Z',
    },
  ],
};

describe('CalculatorPage', () => {
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

  it('offers only priced products and explains why others are absent', async () => {
    const harness = await RouterTestingHarness.create('/calculator');
    const element = harness.routeNativeElement;

    const chips = Array.from(element?.querySelectorAll<HTMLButtonElement>('.picker .chip') ?? []);
    expect(chips.map((chip) => chip.textContent?.trim())).toEqual(['R2', 'Workers']);
    expect(element?.querySelector('.picker-note')?.textContent).toContain('2개만 계산');
    expect(element?.querySelector('.picker-note')?.textContent).toContain('나머지 1개');
    expect(element?.querySelector('.calc-disclaimer')?.textContent).toContain('추정치');
    expect(element?.querySelector('.empty-state')).not.toBeNull();
  });

  it('selects a product into the URL and renders inputs with the metered default tier', async () => {
    const harness = await RouterTestingHarness.create('/calculator');
    const element = harness.routeNativeElement;

    Array.from(element?.querySelectorAll<HTMLButtonElement>('.picker .chip') ?? [])
      .find((chip) => chip.textContent?.includes('Workers'))
      ?.click();
    await harness.fixture.whenStable();

    expect(TestBed.inject(Location).path()).toBe('/calculator?products=workers');
    expect(element?.querySelector('.usage-label')?.textContent).toContain('요청 수');
    const checked = element?.querySelector<HTMLInputElement>('.tier-row input:checked');
    expect(checked?.value).toBe('paid');
    expect(element?.querySelector('.combined-total')?.textContent).toContain('$5.00');
  });

  it('reproduces a shared scenario URL as the same breakdown', async () => {
    const harness = await RouterTestingHarness.create(
      '/calculator?products=workers,r2&t.workers=paid&u.workers.requests=11500000&u.r2.storage-gb-month=110',
    );
    const element = harness.routeNativeElement;

    // Workers Paid: $5 + 1.5M × $0.30/1M = $5.45; R2: 100 GB over × $0.015 = $1.50.
    const totals = Array.from(element?.querySelectorAll('.tier-row.selected .tier-total') ?? []);
    expect(totals.map((node) => node.textContent?.trim())).toEqual(['$5.45/월', '$1.50/월']);
    expect(element?.querySelector('.combined-total')?.textContent).toContain('$6.95');
    const input = element?.querySelector<HTMLInputElement>('#u-workers-requests');
    expect(input?.value).toBe('11500000');
  });

  it('switching to a tier without meters warns about unsellable overage', async () => {
    const harness = await RouterTestingHarness.create(
      '/calculator?products=workers&u.workers.requests=11500000',
    );
    const element = harness.routeNativeElement;

    const freeRadio = Array.from(
      element?.querySelectorAll<HTMLInputElement>('.tier-row input[type="radio"]') ?? [],
    ).find((radio) => radio.value === 'free');
    freeRadio?.click();
    await harness.fixture.whenStable();

    expect(TestBed.inject(Location).path()).toContain('t.workers=free');
    expect(element?.querySelector('.tier-row.selected .tier-warning')?.textContent).toContain(
      '판매하지 않습니다',
    );
    expect(element?.querySelector('.combined-total')?.textContent).toContain('$0.00');
  });

  it('typing usage updates the estimate and mirrors into the URL', async () => {
    const harness = await RouterTestingHarness.create('/calculator?products=workers');
    const element = harness.routeNativeElement;

    const input = element?.querySelector<HTMLInputElement>('#u-workers-requests');
    expect(input).not.toBeNull();
    if (input === null || input === undefined) return;
    input.value = '11500000';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await harness.fixture.whenStable();

    expect(TestBed.inject(Location).path()).toContain('u.workers.requests=11500000');
    expect(element?.querySelector('.combined-total')?.textContent).toContain('$5.45');
  });

  it('collapses hostile scenario params to a safe state', async () => {
    const harness = await RouterTestingHarness.create(
      '/calculator?products=ghost,workers&t.workers=platinum&u.workers.requests=abc',
    );
    const element = harness.routeNativeElement;

    const cards = Array.from(element?.querySelectorAll('.product-card') ?? []);
    expect(cards).toHaveLength(1);
    expect(element?.querySelector('.combined-total')?.textContent).toContain('$5.00');
  });
});
