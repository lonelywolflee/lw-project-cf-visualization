import { TestBed } from '@angular/core/testing';

import { PROGRESS_STORAGE_KEY, ProgressStore, solutionKey } from './progress-store';

describe('ProgressStore', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-15T10:00:00'));
  });

  afterEach(() => {
    vi.useRealTimers();
    localStorage.clear();
  });

  function createStore(): ProgressStore {
    TestBed.configureTestingModule({});
    return TestBed.inject(ProgressStore);
  }

  it('starts empty: every node is unvisited fog', () => {
    const store = createStore();
    expect(store.statusOf('waf')).toBeUndefined();
    expect(store.revealedCount()).toBe(0);
    expect(store.state().sessionLog).toEqual([]);
  });

  it('runs the state machine forward and never downgrades on visit/mark', () => {
    const store = createStore();
    store.recordVisit('waf');
    expect(store.statusOf('waf')).toBe('visited');
    store.markLearned('waf');
    expect(store.statusOf('waf')).toBe('marked');
    // Re-visiting a marked node must not demote it.
    store.recordVisit('waf');
    expect(store.statusOf('waf')).toBe('marked');
    // Marking a verified node must not demote it either.
    store.recordRecall('application-security', [{ productId: 'waf', correct: true }], 5, 'verify');
    expect(store.statusOf('waf')).toBe('verified');
    store.markLearned('waf');
    expect(store.statusOf('waf')).toBe('verified');
  });

  it('verifies correct recalls and demotes wrong ones back to visited', () => {
    const store = createStore();
    store.markLearned('waf');
    store.markLearned('ddos');
    store.recordRecall(
      'application-security',
      [
        { productId: 'waf', correct: true },
        { productId: 'ddos', correct: false },
      ],
      4,
      'verify',
    );
    expect(store.statusOf('waf')).toBe('verified');
    expect(store.statusOf('ddos')).toBe('visited'); // 재안개: 익힘 해제
    expect(store.state().recallLog).toEqual([
      {
        date: '2026-07-15',
        area: 'application-security',
        kind: 'verify',
        correctSlots: 1,
        totalSlots: 4,
      },
    ]);
    expect(store.verifiedCount()).toBe(1);
  });

  it('does not resurrect a node the learner never touched on a wrong recall', () => {
    const store = createStore();
    store.recordRecall('l3', [{ productId: 'spectrum', correct: false }], 3, 'verify');
    expect(store.statusOf('spectrum')).toBeUndefined();
  });

  it('caps practice sessions at marked — verification needs free recall', () => {
    const store = createStore();
    store.recordRecall(
      'compute-platform',
      [{ productId: 'workers', correct: true }],
      2,
      'practice',
    );
    expect(store.statusOf('workers')).toBe('marked');
    expect(store.state().nodeReviews['workers']).toBeUndefined();
    // A practice miss neither demotes nor resurrects.
    store.recordRecall(
      'compute-platform',
      [{ productId: 'workers', correct: false }],
      2,
      'practice',
    );
    expect(store.statusOf('workers')).toBe('marked');
    // Practice never demotes a verified node either.
    store.recordRecall('compute-platform', [{ productId: 'workers', correct: true }], 2, 'verify');
    store.recordRecall(
      'compute-platform',
      [{ productId: 'workers', correct: true }],
      2,
      'practice',
    );
    expect(store.statusOf('workers')).toBe('verified');
    expect(store.state().recallLog.map((entry) => entry.kind)).toEqual([
      'practice',
      'practice',
      'verify',
      'practice',
    ]);
  });

  it('tracks per-node verify reviews: streak grows, a miss clears it', () => {
    const store = createStore();
    store.recordRecall('application-security', [{ productId: 'waf', correct: true }], 5, 'verify');
    expect(store.state().nodeReviews['waf']).toEqual({ last: '2026-07-15', streak: 1 });
    vi.setSystemTime(new Date('2026-07-16T09:00:00'));
    store.recordRecall('application-security', [{ productId: 'waf', correct: true }], 5, 'verify');
    expect(store.state().nodeReviews['waf']).toEqual({ last: '2026-07-16', streak: 2 });
    store.recordRecall('application-security', [{ productId: 'waf', correct: false }], 5, 'verify');
    expect(store.state().nodeReviews['waf']).toBeUndefined();
    expect(store.statusOf('waf')).toBe('visited');
  });

  it('tracks opened cards separately from verify-granted states', () => {
    const store = createStore();
    store.recordVisit('waf');
    store.recordVisit('waf'); // dedup
    store.recordRecall('compute-platform', [{ productId: 'workers', correct: true }], 2, 'verify');
    // workers is verified but its card was never opened — openedIds says so.
    expect(store.statusOf('workers')).toBe('verified');
    expect(store.state().openedIds).toEqual(['waf']);
  });

  it('parses pre-v2 records: kind defaults to verify, nodeReviews to empty', () => {
    localStorage.setItem(
      PROGRESS_STORAGE_KEY,
      JSON.stringify({
        schemaVersion: 1,
        nodeStates: { waf: 'verified' },
        recallLog: [
          { date: '2026-07-01', area: 'application-security', correctSlots: 3, totalSlots: 4 },
        ],
        sessionLog: ['2026-07-01'],
      }),
    );
    const store = createStore();
    expect(store.statusOf('waf')).toBe('verified');
    expect(store.state().recallLog[0]?.kind).toBe('verify');
    expect(store.state().nodeReviews).toEqual({});
  });

  it('deduplicates session days', () => {
    const store = createStore();
    store.touchSession();
    store.touchSession();
    expect(store.state().sessionLog).toEqual(['2026-07-15']);
    vi.setSystemTime(new Date('2026-07-16T09:00:00'));
    store.touchSession();
    expect(store.state().sessionLog).toEqual(['2026-07-15', '2026-07-16']);
  });

  it('persists to localStorage and loads the record back', () => {
    const store = createStore();
    store.recordVisit('waf');
    store.touchSession();
    // Zoneless + fake timers: whenStable() would stall; tick() flushes the
    // persistence effect synchronously.
    TestBed.tick();

    const raw = localStorage.getItem(PROGRESS_STORAGE_KEY);
    expect(raw).not.toBeNull();
    const persisted: unknown = JSON.parse(raw ?? '{}');
    expect(persisted).toMatchObject({
      schemaVersion: 1,
      nodeStates: { waf: 'visited' },
      sessionLog: ['2026-07-15'],
    });
  });

  it('discards a stored record with a different schema version', () => {
    localStorage.setItem(
      PROGRESS_STORAGE_KEY,
      JSON.stringify({
        schemaVersion: 0,
        nodeStates: { waf: 'marked' },
        recallLog: [],
        sessionLog: [],
      }),
    );
    const store = createStore();
    expect(store.statusOf('waf')).toBeUndefined();
  });

  it('discards corrupted storage instead of throwing', () => {
    localStorage.setItem(PROGRESS_STORAGE_KEY, '{ not json');
    const store = createStore();
    expect(store.revealedCount()).toBe(0);
  });

  it('round-trips through export and import, and rejects invalid imports', () => {
    const store = createStore();
    store.markLearned('waf');
    store.recordRecall('application-security', [{ productId: 'waf', correct: true }], 5, 'verify');
    const exported = store.exportJson({ recallRate: 0.2 });

    localStorage.clear();
    TestBed.resetTestingModule();
    const fresh = createStore();
    expect(fresh.statusOf('waf')).toBeUndefined();
    // Extras in the report are ignored by the structural parser? No — the
    // parser only reads known keys, extras must not break the import.
    expect(fresh.importJson(exported)).toBe(true);
    expect(fresh.statusOf('waf')).toBe('verified');
    expect(fresh.state().recallLog).toHaveLength(1);

    expect(fresh.importJson('nonsense')).toBe(false);
    expect(fresh.importJson(JSON.stringify({ schemaVersion: 2 }))).toBe(false);
    // Failed imports keep the current record.
    expect(fresh.statusOf('waf')).toBe('verified');
  });

  it('runs the solution state table on the namespaced key only', () => {
    const store = createStore();
    store.recordSolutionVisit('sase');
    expect(store.state().nodeStates[solutionKey('sase')]).toBe('visited');
    store.markSolutionLearned('sase');
    expect(store.state().nodeStates[solutionKey('sase')]).toBe('marked');

    // ① passed: verified + streak starts. Only ① ever touches the streak.
    store.recordSolutionRecall('sase', 4, 5, 'verify', 'verify');
    expect(store.state().nodeStates[solutionKey('sase')]).toBe('verified');
    expect(store.state().nodeReviews[solutionKey('sase')]?.streak).toBe(1);
    expect(store.solutionVerifiedCount()).toBe(1);

    // A correct ③ logs but changes nothing (demotion trigger only).
    store.recordSolutionRecall('sase', 2, 2, 'verify', 'none');
    expect(store.state().nodeStates[solutionKey('sase')]).toBe('verified');
    expect(store.state().nodeReviews[solutionKey('sase')]?.streak).toBe(1);

    // A missed ③ (or a failed ①) demotes and clears the streak.
    store.recordSolutionRecall('sase', 1, 2, 'verify', 'demote');
    expect(store.state().nodeStates[solutionKey('sase')]).toBe('visited');
    expect(store.state().nodeReviews[solutionKey('sase')]).toBeUndefined();

    // Spray-guarded ① records as practice with no state effect.
    store.recordSolutionRecall('sase', 1, 5, 'practice', 'none');
    expect(store.state().nodeStates[solutionKey('sase')]).toBe('visited');
    const log = store.state().recallLog;
    expect(log).toHaveLength(4);
    expect(log.every((entry) => entry.area === solutionKey('sase'))).toBe(true);
    expect(log[3]?.kind).toBe('practice');
  });

  it('keeps product and solution records apart for colliding ids (workflows)', () => {
    const store = createStore();
    // The catalog has BOTH a product and a solution named 'workflows' —
    // the snapshot in KNOWN_PRODUCT_SOLUTION_COLLISIONS. The namespace is
    // what keeps a solution session from corrupting the product's record.
    store.recordRecall(
      'compute-platform',
      [{ productId: 'workflows', correct: true }],
      5,
      'verify',
    );
    expect(store.statusOf('workflows')).toBe('verified');
    expect(store.state().nodeReviews['workflows']?.streak).toBe(1);

    // A failed solution session must not touch the product.
    store.recordSolutionRecall('workflows', 0, 4, 'verify', 'demote');
    expect(store.statusOf('workflows')).toBe('verified');
    expect(store.state().nodeReviews['workflows']?.streak).toBe(1);
    expect(store.state().nodeStates[solutionKey('workflows')]).toBeUndefined();

    // And the solution keys stay out of every product metric.
    store.recordSolutionRecall('workflows', 4, 4, 'verify', 'verify');
    expect(store.revealedCount()).toBe(1);
    expect(store.verifiedCount()).toBe(1);
    expect(store.solutionVerifiedCount()).toBe(1);
  });
});
