import { Location } from '@angular/common';
import { computed, signal, type WritableSignal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, withComponentInputBinding } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import type { Catalog, CuratedData } from '@cf-viz/catalog';

import { routes } from '../../app.routes';
import type { CatalogState } from '../../core/catalog/catalog-state';
import { CatalogStore } from '../../core/catalog/catalog-store';
import { localToday, ProgressStore } from '../../core/learning/progress-store';
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
      summary: 'Not yet curated.',
      familyId: 'security',
      sourceIds: [source.id],
    },
    {
      id: 'cdn',
      name: 'CDN',
      summary: 'Caches content worldwide.',
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
      productId: 'workers',
      roleKo: '엣지 서버리스 코드입니다.',
      placements: [{ lane: 'public-web', layer: 'compute-platform' }],
      sourceUrl: 'https://www.cloudflare.com/products/workers/',
      verifiedAt: '2026-07-14T00:00:00Z',
    },
    {
      productId: 'r2',
      roleKo: 'Egress 무료 스토리지입니다.',
      placements: [{ lane: 'public-web', layer: 'compute-platform' }],
      sourceUrl: 'https://www.cloudflare.com/products/',
      verifiedAt: '2026-07-14T00:00:00Z',
    },
    {
      productId: 'cdn',
      roleKo: '콘텐츠를 캐싱합니다.',
      placements: [{ lane: 'public-web', layer: 'application-performance' }],
      sourceUrl: 'https://www.cloudflare.com/products/cdn/',
      verifiedAt: '2026-07-14T00:00:00Z',
    },
  ],
  compositions: [],
  pricing: [
    {
      productId: 'workers',
      tiers: [{ id: 'free', name: 'Free', monthlyUsd: 0 }],
      sourceUrl: 'https://developers.cloudflare.com/workers/platform/pricing/',
      verifiedAt: '2026-07-14T00:00:00Z',
    },
  ],
  learningNotes: [
    {
      productId: 'waf',
      whyKo: '공격 패턴은 요청 단계에서 잡는 게 싸다.',
      misconceptionKo: '방화벽이라 네트워크 장비라고 오해한다.',
      customerQuestionKo: '"AWS WAF 이미 쓰는데요?"',
      analogyKo: '공항 검색대와 같다.',
      sourceUrl: 'https://www.cloudflare.com/application-services/products/waf/',
      verifiedAt: '2026-07-15T00:00:00Z',
    },
  ],
};

describe('LivingMapPage', () => {
  let state: WritableSignal<CatalogState>;

  beforeEach(() => {
    localStorage.clear();
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

  afterEach(() => {
    localStorage.clear();
  });

  function nodeByName(element: HTMLElement | null, name: string): HTMLButtonElement | undefined {
    return Array.from(element?.querySelectorAll<HTMLButtonElement>('button.node') ?? []).find(
      (node) => node.textContent?.trim().replace(' ✓', '') === name,
    );
  }

  it('renders every node as clickable fog from the start — no locks', async () => {
    const harness = await RouterTestingHarness.create('/');
    const element = harness.routeNativeElement;

    const waf = nodeByName(element, 'WAF');
    expect(waf?.classList.contains('st-unvisited')).toBe(true);
    expect(waf?.disabled).toBe(false);
    expect(element?.textContent).toContain('밝힌 노드 0 / 67');
  });

  it('collapses the compute band by default with a readable unvisited count', async () => {
    const harness = await RouterTestingHarness.create('/');
    const element = harness.routeNativeElement;

    // Workers/R2 hide behind the collapsed family toggle.
    expect(nodeByName(element, 'Workers')).toBeUndefined();
    const toggle = Array.from(
      element?.querySelectorAll<HTMLButtonElement>('.family-toggle') ?? [],
    ).find((button) => button.textContent?.includes('Compute'));
    expect(toggle?.textContent).toContain('2개 중 안개 2');
    expect(toggle?.getAttribute('aria-expanded')).toBe('false');

    toggle?.click();
    await harness.fixture.whenStable();
    expect(nodeByName(element, 'Workers')).not.toBeUndefined();
  });

  it('opens the learning card on node click, records the visit, and clears the fog', async () => {
    const harness = await RouterTestingHarness.create('/');
    const element = harness.routeNativeElement;

    nodeByName(element, 'WAF')?.click();
    await harness.fixture.whenStable();

    expect(TestBed.inject(Location).path()).toBe('?product=waf');
    const card = element?.querySelector('.learning-card');
    expect(card?.querySelector('.p-name')?.textContent).toContain('WAF');
    expect(card?.textContent).toContain('공격 패턴은 요청 단계에서 잡는 게 싸다.');
    expect(card?.textContent).toContain('흔한 오해');
    expect(card?.textContent).toContain('공항 검색대');
    expect(card?.querySelector('.c-src a')?.getAttribute('href')).toContain('cloudflare.com');
    expect(TestBed.inject(ProgressStore).statusOf('waf')).toBe('visited');
    expect(nodeByName(element, 'WAF')?.classList.contains('st-visited')).toBe(true);
  });

  it('shows the explicit fallback card for a product without a learning note', async () => {
    const harness = await RouterTestingHarness.create('/?product=newcomer');
    const element = harness.routeNativeElement;

    const card = element?.querySelector('.learning-card');
    expect(card?.querySelector('.fallback-badge')?.textContent).toContain('학습 노트 준비 중');
    expect(card?.textContent).toContain('Not yet curated.');
  });

  it('marks a node as learned from the card and reflects it on the map', async () => {
    const harness = await RouterTestingHarness.create('/?product=waf');
    const element = harness.routeNativeElement;

    element?.querySelector<HTMLButtonElement>('.learn-button')?.click();
    await harness.fixture.whenStable();

    expect(TestBed.inject(ProgressStore).statusOf('waf')).toBe('marked');
    expect(nodeByName(element, 'WAF')?.classList.contains('st-marked')).toBe(true);
    expect(element?.querySelector('.learned-state')?.textContent).toContain('익혔음으로 표시됨');
  });

  it('links the calculator only for priced products', async () => {
    const harness = await RouterTestingHarness.create('/?product=workers');
    expect(
      harness.routeNativeElement?.querySelector('.deeper a[href="/calculator?products=workers"]'),
    ).not.toBeNull();

    // waf has no pricing in this fixture — the calculator link is absent.
    await harness.navigateByUrl('/?product=waf');
    expect(harness.routeNativeElement?.querySelector('.deeper a[href^="/calculator"]')).toBeNull();
  });

  it('ignores hostile product ids from the URL', async () => {
    const harness = await RouterTestingHarness.create('/?product=%3Cscript%3E');
    const element = harness.routeNativeElement;
    expect(element?.querySelector('.learning-card')).toBeNull();
  });

  it('records a session day on entry and offers the report tools', async () => {
    const harness = await RouterTestingHarness.create('/');
    const element = harness.routeNativeElement;
    expect(TestBed.inject(ProgressStore).state().sessionLog).toHaveLength(1);
    expect(element?.textContent).toContain('리포트 내보내기');
    expect(element?.querySelector('input[type="file"]')).not.toBeNull();
  });

  it('switches to recall mode via URL state and lists the recallable areas', async () => {
    const harness = await RouterTestingHarness.create('/');
    const element = harness.routeNativeElement;

    Array.from(element?.querySelectorAll<HTMLButtonElement>('.mode') ?? [])
      .find((button) => button.textContent?.includes('회상'))
      ?.click();
    await harness.fixture.whenStable();

    expect(TestBed.inject(Location).path()).toBe('?mode=recall');
    const areaNames = Array.from(element?.querySelectorAll('.area-name') ?? []).map((node) =>
      node.textContent?.trim(),
    );
    expect(areaNames).toContain('L7 보안');
    expect(areaNames).toContain('컴퓨팅');
    expect(element?.querySelector('.lanes')).toBeNull(); // 지도 대신 회상 화면
  });

  it('runs a full recall session: pick limit, scoring, verification, and demotion', async () => {
    const progress = TestBed.inject(ProgressStore);
    progress.markLearned('workers'); // 익힘 상태에서 놓치면 강등되어야 한다.
    const harness = await RouterTestingHarness.create('/?mode=recall&area=compute-platform');
    const element = harness.routeNativeElement;

    // The compute area has 2 slots (workers, r2); picks are capped at 2.
    expect(element?.textContent).toContain('슬롯이 2개');
    const chip = (name: string): HTMLButtonElement | undefined =>
      Array.from(element?.querySelectorAll<HTMLButtonElement>('.recall-chip') ?? []).find(
        (button) => button.textContent?.trim() === name,
      );
    // The decoy pool draws from adjacent layers.
    expect(element?.querySelectorAll('.recall-chip').length).toBeGreaterThan(2);

    chip('R2')?.click();
    await harness.fixture.whenStable();
    chip('CDN')?.click(); // 함정 픽 — 선택 한도 1자리를 낭비한다.
    await harness.fixture.whenStable();
    chip('Workers')?.click(); // 한도(2) 초과 → 무시되어야 한다.
    await harness.fixture.whenStable();
    expect(element?.querySelectorAll('.recall-chip.picked')).toHaveLength(2);

    element?.querySelector<HTMLButtonElement>('.recall-submit')?.click();
    await harness.fixture.whenStable();

    expect(element?.querySelector('.result-line')?.textContent).toContain('정답 1 / 2');
    expect(progress.statusOf('r2')).toBe('verified');
    expect(progress.statusOf('workers')).toBe('visited'); // marked → 강등
    expect(progress.state().recallLog).toHaveLength(1);
    expect(progress.state().recallLog[0]).toMatchObject({
      area: 'compute-platform',
      correctSlots: 1,
      totalSlots: 2,
    });
  });

  it('collapses an unknown recall area back to the area list', async () => {
    const harness = await RouterTestingHarness.create('/?mode=recall&area=%3Cscript%3E');
    const element = harness.routeNativeElement;
    expect(element?.querySelector('.recall-session')).toBeNull();
    expect(element?.querySelectorAll('.area-card').length).toBeGreaterThan(0);
  });

  function importProgress(recallDate: string): void {
    const ok = TestBed.inject(ProgressStore).importJson(
      JSON.stringify({
        schemaVersion: 1,
        nodeStates: { waf: 'verified' },
        recallLog: [
          { date: recallDate, area: 'application-security', correctSlots: 1, totalSlots: 1 },
        ],
        sessionLog: [],
      }),
    );
    expect(ok).toBe(true);
  }

  it('re-fogs a verified area past its due date: nudge, node fog, and area badge', async () => {
    importProgress('2026-01-01'); // 기한(1일)이 한참 지난 검증 기록.
    const harness = await RouterTestingHarness.create('/');
    const element = harness.routeNativeElement;

    expect(element?.querySelector('.refog-nudge')?.textContent).toContain('안개가 다시');
    expect(element?.textContent).toContain('재안개 1');
    const waf = nodeByName(element, 'WAF');
    expect(waf?.classList.contains('st-verified')).toBe(true);
    expect(waf?.classList.contains('refog')).toBe(true);

    await harness.navigateByUrl('/?mode=recall');
    const recallElement = harness.routeNativeElement;
    const staleCard = Array.from(recallElement?.querySelectorAll('.area-card') ?? []).find((card) =>
      card.textContent?.includes('L7 보안'),
    );
    expect(staleCard?.classList.contains('stale')).toBe(true);
    expect(staleCard?.querySelector('.stale-badge')).not.toBeNull();
  });

  it('stays quiet on the day an area was verified — no premature nudge', async () => {
    importProgress(localToday());
    const harness = await RouterTestingHarness.create('/');
    const element = harness.routeNativeElement;

    expect(element?.querySelector('.refog-nudge')).toBeNull();
    expect(element?.textContent).not.toContain('재안개');
    expect(nodeByName(element, 'WAF')?.classList.contains('refog')).toBe(false);
  });
});
