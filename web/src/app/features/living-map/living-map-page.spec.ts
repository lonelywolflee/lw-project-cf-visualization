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
    {
      id: 'gateway',
      name: 'Gateway',
      summary: 'Filters outbound traffic.',
      familyId: 'security',
      sourceIds: [source.id],
    },
    {
      id: 'secure-web-gateway',
      name: 'Secure Web Gateway',
      summary: 'DNS filtering category.',
      familyId: 'security',
      sourceIds: [source.id],
    },
  ],
  solutions: [
    {
      id: 'sase',
      name: 'Cloudflare One',
      summary: 'SASE platform.',
      sourceIds: [source.id],
    },
    {
      id: 'security',
      name: 'Security',
      summary: 'Inbound security bundle.',
      sourceIds: [source.id],
    },
  ],
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
    {
      productId: 'gateway',
      roleKo: '아웃바운드 트래픽을 거릅니다.',
      placements: [{ lane: 'zero-trust', layer: 'access-control' }],
      sourceUrl: 'https://www.cloudflare.com/zero-trust/products/gateway/',
      verifiedAt: '2026-07-14T00:00:00Z',
    },
    {
      productId: 'secure-web-gateway',
      roleKo: 'DNS 필터링 범주입니다.',
      placements: [{ lane: 'zero-trust', layer: 'access-control' }],
      sourceUrl: 'https://www.cloudflare.com/zero-trust/products/gateway/',
      verifiedAt: '2026-07-14T00:00:00Z',
    },
  ],
  compositions: [
    {
      solutionId: 'sase',
      productIds: ['waf', 'cdn'],
      sourceUrl: 'https://www.cloudflare.com/sase/',
      verifiedAt: '2026-07-14T00:00:00Z',
    },
    {
      solutionId: 'security',
      productIds: ['waf'],
      sourceUrl: 'https://www.cloudflare.com/solutions/security/',
      verifiedAt: '2026-07-14T00:00:00Z',
    },
  ],
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
      se: { opsKo: '로그 모드로 시작해 차단 모드로 올린다.' },
      ae: {
        pitchKo: '오탐 걱정부터 풀어주며 연다.',
        objections: [{ q: '이미 Akamai 쓰는데요?', a: '통합 엣지 경로로 정면 대응한다.' }],
      },
      battlecard: [
        {
          competitor: 'Akamai',
          vsKo: '엣지 통합은 강점, 전담 PS 조직은 열세.',
          grounding: 'internal-reviewed',
          sourceUrl: 'https://www.cloudflare.com/application-services/products/cdn/',
        },
        {
          competitor: 'AWS WAF',
          vsKo: '관리형 룰 자동 갱신 주기가 강점.',
          grounding: 'official',
          sourceUrl: 'https://www.cloudflare.com/application-services/products/waf/',
        },
      ],
      sourceUrl: 'https://www.cloudflare.com/application-services/products/waf/',
      verifiedAt: '2026-07-15T00:00:00Z',
    },
  ],
  scenarios: [
    {
      id: 'login-abuse',
      titleKo: '로그인 공격 방어',
      situationKo: '정상처럼 보이는 로그인 시도가 반복되는 상황입니다.',
      productIds: ['waf', 'cdn'],
      talkTrackKo: '로그인 실패율 급증 경험을 물으며 시작하세요.',
      sourceUrl: 'https://www.cloudflare.com/application-services/products/waf/',
      verifiedAt: '2026-07-15T00:00:00Z',
    },
  ],
  narration: [
    {
      productId: 'waf',
      captionKo: '요청의 내용을 열어 공격 패턴을 거릅니다.',
      sourceUrl: 'https://www.cloudflare.com/application-services/products/waf/',
      verifiedAt: '2026-07-15T00:00:00Z',
    },
    {
      productId: 'cdn',
      captionKo: '캐시 적중이면 여정은 여기서 끝납니다.',
      sourceUrl: 'https://www.cloudflare.com/products/cdn/',
      verifiedAt: '2026-07-15T00:00:00Z',
    },
    {
      productId: 'workers',
      captionKo: '엣지에서 코드가 직접 응답을 만듭니다.',
      sourceUrl: 'https://www.cloudflare.com/products/workers/',
      verifiedAt: '2026-07-15T00:00:00Z',
    },
  ],
  solutionNotes: [
    {
      solutionId: 'sase',
      oneLinerKo: '직원 접속을 신원 기반으로 지키는 Zero Trust 묶음입니다.',
      whyKo: 'VPN을 대체하는 접근 모델입니다.',
      misconceptionKo: 'VPN의 신형이 아니라 접근 모델의 교체입니다.',
      customerQuestionKo: '"뭐부터 도입하나요?" — Access부터 단계 도입.',
      boundariesKo: [{ solutionId: 'security', noteKo: '인바운드 vs 아웃바운드의 방향 차이.' }],
      sourceUrl: 'https://www.cloudflare.com/sase/',
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

  it('runs a chip practice session: pick limit, scoring, and the marked cap', async () => {
    const progress = TestBed.inject(ProgressStore);
    progress.markLearned('workers');
    const harness = await RouterTestingHarness.create(
      '/?mode=recall&area=compute-platform&kind=practice',
    );
    const element = harness.routeNativeElement;

    // Practice keeps the slot scaffold; picks are capped at 2.
    expect(element?.textContent).toContain('슬롯이 2개');
    expect(element?.textContent).toContain('익혔음까지만');
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
    // Recognition is a scaffold: marked at most, no verification, no demotion.
    expect(progress.statusOf('r2')).toBe('marked');
    expect(progress.statusOf('workers')).toBe('marked');
    expect(progress.state().recallLog[0]).toMatchObject({
      area: 'compute-platform',
      kind: 'practice',
      correctSlots: 1,
      totalSlots: 2,
    });
  });

  it('verifies through free recall: typed input, hidden slot count, wrong entries', async () => {
    const progress = TestBed.inject(ProgressStore);
    const harness = await RouterTestingHarness.create('/?mode=recall&area=compute-platform');
    const element = harness.routeNativeElement;

    // The verify session never reveals how many slots the area has.
    expect(element?.textContent).toContain('몇 개인지는 알려주지 않습니다');
    expect(element?.textContent).not.toContain('슬롯이 2개');
    const input = element?.querySelector<HTMLInputElement>('.verify-input input');
    expect(input).not.toBeNull();

    const type = async (value: string): Promise<void> => {
      if (input === null || input === undefined) return;
      input.value = value;
      input.dispatchEvent(new Event('input'));
      await harness.fixture.whenStable();
    };

    await type('Wo'); // two characters — the gate stays closed
    expect(element?.querySelectorAll('.suggestion')).toHaveLength(0);
    await type('Wor');
    const workersSuggestion = Array.from(
      element?.querySelectorAll<HTMLButtonElement>('.suggestion') ?? [],
    ).find((button) => button.textContent?.trim() === 'Workers');
    workersSuggestion?.click();
    await harness.fixture.whenStable();

    await type('CDN'); // wrong-area entry: graded as such, no penalty logic
    Array.from(element?.querySelectorAll<HTMLButtonElement>('.suggestion') ?? [])
      .find((button) => button.textContent?.trim() === 'CDN')
      ?.click();
    await harness.fixture.whenStable();

    element?.querySelector<HTMLButtonElement>('.recall-submit')?.click();
    await harness.fixture.whenStable();

    expect(element?.querySelector('.result-line')?.textContent).toContain('정답 1 / 2');
    expect(element?.querySelector('.wrong-entries')?.textContent).toContain('CDN');
    expect(progress.statusOf('workers')).toBe('verified');
    expect(progress.state().nodeReviews['workers']).toMatchObject({ streak: 1 });
    expect(progress.state().recallLog[0]).toMatchObject({ kind: 'verify' });
  });

  it('enters a verify session from the area card buttons', async () => {
    const harness = await RouterTestingHarness.create('/?mode=recall');
    const element = harness.routeNativeElement;

    element?.querySelector<HTMLButtonElement>('.area-card .area-verify')?.click();
    await harness.fixture.whenStable();
    expect(TestBed.inject(Location).path()).toContain('kind=verify');
    expect(harness.routeNativeElement?.querySelector('.verify-input')).not.toBeNull();
  });

  it('demotes a sprayed verify session to practice — browsing is not recall', async () => {
    const progress = TestBed.inject(ProgressStore);
    const harness = await RouterTestingHarness.create('/?mode=recall&area=compute-platform');
    const element = harness.routeNativeElement;
    const input = element?.querySelector<HTMLInputElement>('.verify-input input');
    const pick = async (query: string, name: string): Promise<void> => {
      if (input === null || input === undefined) return;
      input.value = query;
      input.dispatchEvent(new Event('input'));
      await harness.fixture.whenStable();
      Array.from(element?.querySelectorAll<HTMLButtonElement>('.suggestion') ?? [])
        .find((button) => button.textContent?.trim() === name)
        ?.click();
      await harness.fixture.whenStable();
    };

    await pick('Wor', 'Workers'); // 정답 1
    await pick('WAF', 'WAF'); // 오답 1
    await pick('CDN', 'CDN'); // 오답 2 → 오답 > 정답 → 강등
    element?.querySelector<HTMLButtonElement>('.recall-submit')?.click();
    await harness.fixture.whenStable();

    expect(element?.querySelector('.spray-warning')?.textContent).toContain('연습으로만');
    expect(progress.statusOf('workers')).toBe('marked'); // verified 아님
    expect(progress.state().nodeReviews['workers']).toBeUndefined();
    expect(progress.state().recallLog[0]?.kind).toBe('practice');
  });

  it('reaches two-letter products through exact-match suggestions', async () => {
    const progress = TestBed.inject(ProgressStore);
    const harness = await RouterTestingHarness.create('/?mode=recall&area=compute-platform');
    const element = harness.routeNativeElement;
    const input = element?.querySelector<HTMLInputElement>('.verify-input input');
    if (input) {
      input.value = 'r2';
      input.dispatchEvent(new Event('input'));
    }
    await harness.fixture.whenStable();

    const suggestion = Array.from(
      element?.querySelectorAll<HTMLButtonElement>('.suggestion') ?? [],
    ).find((button) => button.textContent?.trim() === 'R2');
    expect(suggestion).not.toBeUndefined();
    suggestion?.click();
    await harness.fixture.whenStable();
    element?.querySelector<HTMLButtonElement>('.recall-submit')?.click();
    await harness.fixture.whenStable();

    expect(progress.statusOf('r2')).toBe('verified');
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

  it('re-fogs per node once its own review interval passes', async () => {
    const ok = TestBed.inject(ProgressStore).importJson(
      JSON.stringify({
        schemaVersion: 1,
        nodeStates: { waf: 'verified', cdn: 'verified' },
        nodeReviews: {
          waf: { last: '2026-01-01', streak: 1 }, // long past due → stale
          cdn: { last: localToday(), streak: 1 }, // verified today → fresh
        },
        recallLog: [],
        sessionLog: [],
      }),
    );
    expect(ok).toBe(true);
    const harness = await RouterTestingHarness.create('/');
    const element = harness.routeNativeElement;

    expect(nodeByName(element, 'WAF')?.classList.contains('refog')).toBe(true);
    expect(nodeByName(element, 'CDN')?.classList.contains('refog')).toBe(false);
    expect(element?.textContent).toContain('재안개 1');
  });

  it('offers scenario and solution lenses in the lens bar', async () => {
    const harness = await RouterTestingHarness.create('/');
    const chips = Array.from(harness.routeNativeElement?.querySelectorAll('.lens-chip') ?? []).map(
      (chip) => chip.textContent?.replace(/\s+/g, ' ').trim(),
    );

    expect(chips[0]).toBe('렌즈 없음');
    expect(chips).toContain('딜 상황 로그인 공격 방어');
    expect(chips).toContain('솔루션 Cloudflare One');
  });

  it('lights up scenario members, dims the rest, and shows the narrative panel', async () => {
    const harness = await RouterTestingHarness.create('/?lens=login-abuse');
    const element = harness.routeNativeElement;

    const waf = nodeByName(element, 'WAF');
    expect(waf?.classList.contains('lens-hit')).toBe(true);
    expect(waf?.classList.contains('lens-dim')).toBe(false);
    const newcomer = nodeByName(element, 'Newcomer'); // unplaced — still dims
    expect(newcomer?.classList.contains('lens-dim')).toBe(true);
    // The collapsed compute group holds no members — it dims as a whole.
    const computeToggle = Array.from(
      element?.querySelectorAll<HTMLButtonElement>('.family-toggle') ?? [],
    ).find((button) => button.textContent?.includes('Compute'));
    expect(computeToggle?.classList.contains('lens-dim')).toBe(true);

    const panel = element?.querySelector('.lens-panel');
    expect(panel?.textContent).toContain('정상처럼 보이는 로그인 시도');
    expect(panel?.textContent).toContain('대화의 문');
    expect(
      panel?.querySelector(
        'a[href="https://www.cloudflare.com/application-services/products/waf/"]',
      ),
    ).not.toBeNull();
  });

  it('links the composition graph from a solution lens', async () => {
    const harness = await RouterTestingHarness.create('/?lens=sase');
    const element = harness.routeNativeElement;

    expect(nodeByName(element, 'CDN')?.classList.contains('lens-hit')).toBe(true);
    expect(element?.querySelector('.lens-panel a[href="/solutions?solution=sase"]')).not.toBeNull();
  });

  it('keeps the lens while opening a learning card, and survives hostile ids', async () => {
    const harness = await RouterTestingHarness.create('/?lens=login-abuse');
    const element = harness.routeNativeElement;

    nodeByName(element, 'WAF')?.click();
    await harness.fixture.whenStable();
    expect(TestBed.inject(Location).path()).toBe('?product=waf&lens=login-abuse');
    expect(element?.querySelector('.learning-card')).not.toBeNull();
    expect(element?.querySelector('.lens-panel')).not.toBeNull();

    await harness.navigateByUrl('/?lens=%3Cscript%3E');
    const hostile = harness.routeNativeElement;
    expect(hostile?.querySelector('.lens-panel')).toBeNull();
    expect(nodeByName(hostile, 'WAF')?.classList.contains('lens-dim')).toBe(false);
  });

  it('replays the journey from the first stop with the caption panel', async () => {
    const harness = await RouterTestingHarness.create('/?mode=replay');
    const element = harness.routeNativeElement;

    const panel = element?.querySelector('.replay-panel');
    expect(panel?.textContent).toContain('정거장 1 / 3');
    expect(panel?.querySelector('.replay-name')?.textContent).toContain('WAF');
    expect(panel?.textContent).toContain('요청의 내용을 열어');
    expect(nodeByName(element, 'WAF')?.classList.contains('replay-current')).toBe(true);
    expect(element?.querySelector('.lens-bar')).toBeNull(); // 재생 중엔 렌즈 바 대신 자막
  });

  it('advances stops without spraying history and marks passed stations', async () => {
    const harness = await RouterTestingHarness.create('/?mode=replay');
    const element = harness.routeNativeElement;

    const next = Array.from(
      element?.querySelectorAll<HTMLButtonElement>('.replay-controls .tool') ?? [],
    ).find((button) => button.textContent?.includes('다음'));
    next?.click();
    await harness.fixture.whenStable();

    expect(TestBed.inject(Location).path()).toBe('?mode=replay&stop=2');
    expect(element?.querySelector('.replay-name')?.textContent).toContain('CDN');
    expect(nodeByName(element, 'WAF')?.classList.contains('replay-passed')).toBe(true);
  });

  it('auto-expands the compute group when the journey stops inside it', async () => {
    const harness = await RouterTestingHarness.create('/?mode=replay&stop=3');
    const element = harness.routeNativeElement;

    // Workers hides behind the collapsed family toggle in exploration —
    // the replay stop must surface it.
    const workers = nodeByName(element, 'Workers');
    expect(workers).not.toBeUndefined();
    expect(workers?.classList.contains('replay-current')).toBe(true);
  });

  it('collapses hostile stop values to the first station', async () => {
    const harness = await RouterTestingHarness.create('/?mode=replay&stop=999');
    expect(harness.routeNativeElement?.querySelector('.replay-panel')?.textContent).toContain(
      '정거장 1 / 3',
    );
  });

  it('cross-links name-trap pairs on the card', async () => {
    const harness = await RouterTestingHarness.create('/?product=gateway');
    const element = harness.routeNativeElement;

    const pairButton = element?.querySelector<HTMLButtonElement>('.pair-link button');
    expect(pairButton?.textContent).toContain('Secure Web Gateway');
    pairButton?.click();
    await harness.fixture.whenStable();
    expect(TestBed.inject(Location).path()).toBe('?product=secure-web-gateway');
    // WAF has no name-trap sibling — no pair link on its card.
    await harness.navigateByUrl('/?product=waf');
    expect(harness.routeNativeElement?.querySelector('.pair-link')).toBeNull();
  });

  it('opens the canonical solution card from its lens and keeps the filter on close', async () => {
    const harness = await RouterTestingHarness.create('/');
    const element = harness.routeNativeElement;

    Array.from(element?.querySelectorAll<HTMLButtonElement>('.lens-chip') ?? [])
      .find((chip) => chip.textContent?.includes('Cloudflare One'))
      ?.click();
    await harness.fixture.whenStable();

    expect(TestBed.inject(Location).path()).toBe('?lens=sase&solution=sase');
    const card = element?.querySelector('aside[aria-label="솔루션 카드"]');
    expect(card?.querySelector('.p-name')?.textContent).toContain('Cloudflare One');
    expect(card?.querySelector('.s-oneliner')?.textContent).toContain('Zero Trust 묶음');
    expect(card?.textContent).toContain('구성 제품 2');
    // 경계: 자기 노트의 boundariesKo + 공유 제품(교집합 파생 — WAF)
    expect(card?.textContent).toContain('인바운드 vs 아웃바운드');
    expect(card?.textContent).toContain('공유:');

    // 카드 닫기 → 필터는 유지
    card?.querySelector<HTMLButtonElement>('.card-close')?.click();
    await harness.fixture.whenStable();
    expect(TestBed.inject(Location).path()).toBe('?lens=sase');
    expect(element?.querySelector('aside[aria-label="솔루션 카드"]')).toBeNull();
  });

  it('clears the lens and the solution card together on a re-click', async () => {
    const harness = await RouterTestingHarness.create('/?lens=sase&solution=sase');
    const element = harness.routeNativeElement;

    Array.from(element?.querySelectorAll<HTMLButtonElement>('.lens-chip') ?? [])
      .find((chip) => chip.textContent?.includes('Cloudflare One'))
      ?.click();
    await harness.fixture.whenStable();

    expect(TestBed.inject(Location).path()).toBe('');
    expect(element?.querySelector('aside[aria-label="솔루션 카드"]')).toBeNull();
  });

  it('swaps to a product card from a composition chip, keeping the lens', async () => {
    const harness = await RouterTestingHarness.create('/?lens=sase&solution=sase');
    const element = harness.routeNativeElement;

    Array.from(
      element?.querySelectorAll<HTMLButtonElement>(
        'aside[aria-label="솔루션 카드"] .recall-chip',
      ) ?? [],
    )
      .find((chip) => chip.textContent?.trim() === 'WAF')
      ?.click();
    await harness.fixture.whenStable();

    expect(TestBed.inject(Location).path()).toBe('?product=waf&lens=sase');
    expect(
      harness.routeNativeElement?.querySelector('.learning-card .p-name')?.textContent,
    ).toContain('WAF');
  });

  it('mirrors one-directional boundaries onto the neighbour and falls back without a note', async () => {
    const harness = await RouterTestingHarness.create('/?solution=security');
    const element = harness.routeNativeElement;

    const card = element?.querySelector('aside[aria-label="솔루션 카드"]');
    // security has no note — fallback badge with the crawled summary.
    expect(card?.querySelector('.fallback-badge')?.textContent).toContain('학습 노트 준비 중');
    expect(card?.textContent).toContain('Inbound security bundle.');
    // sase's boundary toward security mirrors back here.
    expect(card?.textContent).toContain('인바운드 vs 아웃바운드');
    expect(card?.textContent).toContain('Cloudflare One');

    // Hostile ids collapse to no card.
    await harness.navigateByUrl('/?solution=%3Cscript%3E');
    expect(harness.routeNativeElement?.querySelector('aside[aria-label="솔루션 카드"]')).toBeNull();
  });

  it('renders the SE/AE layers and battlecards with grounding marks', async () => {
    const harness = await RouterTestingHarness.create('/?product=waf');
    const card = harness.routeNativeElement?.querySelector('.learning-card');

    // Discoverability pills at the top announce what the card holds below.
    const pills = Array.from(card?.querySelectorAll('.layer-pills .pill') ?? []).map((pill) =>
      pill.textContent?.trim(),
    );
    expect(pills).toContain('SE 심화 ↓');
    expect(pills).toContain('경쟁 비교 2 ↓');
    expect(card?.textContent).toContain('SE 심화');
    expect(card?.textContent).toContain('운영·튜닝');
    expect(card?.textContent).toContain('AE 어필');
    expect(card?.textContent).toContain('이미 Akamai 쓰는데요?');
    expect(card?.textContent).toContain('경쟁 비교');
    // internal-reviewed renders a badge; official renders a citation link.
    expect(card?.querySelector('.bc-badge')?.textContent).toContain('사내 검수 자료');
    const cardLinks = Array.from(card?.querySelectorAll('.bc-head a') ?? []);
    expect(cardLinks.some((link) => link.textContent?.includes('공식 근거'))).toBe(true);
    // An internal-reviewed card with a sourceUrl shows "우리 측 근거" too.
    expect(cardLinks.some((link) => link.textContent?.includes('우리 측 근거'))).toBe(true);
  });
});
