import { Injectable, computed, effect, signal } from '@angular/core';

/**
 * Node learning states, strictly ordered. A node the learner has never
 * touched is simply absent from the record ("미방문" — rendered as fog).
 *
 *   visited  — opened the learning card at least once
 *   marked   — self-declared "익혔음"
 *   verified — placed correctly in a recall session
 *
 * A wrong recall answer demotes the node back to `visited` (the design's
 * "검증/익힘이 해제되고 다시 흐려진다").
 */
export type NodeStatus = 'visited' | 'marked' | 'verified';

const STATUS_RANK: Record<NodeStatus, number> = { visited: 0, marked: 1, verified: 2 };

/**
 * Session kinds: `practice` is chip recognition (a scaffold — it can mark
 * a node, never verify it), `verify` is free recall by typed input and is
 * the only path to `verified`. Records from before this split were all
 * chip sessions graded as verification; they parse as 'verify' so the
 * learner's history keeps its meaning at the time it was written.
 */
export type RecallKind = 'practice' | 'verify';

/** One finished recall session over a single map area (layer). */
export interface RecallEntry {
  /** Local date, YYYY-MM-DD. */
  readonly date: string;
  /** The layer the session covered. */
  readonly area: string;
  readonly kind: RecallKind;
  readonly correctSlots: number;
  readonly totalSlots: number;
}

/** Per-node verify tracking; drives node-level re-fog intervals. */
export interface NodeReview {
  /** Local date (YYYY-MM-DD) of the last correct verify placement. */
  readonly last: string;
  /** Consecutive verify successes; a miss clears the whole record. */
  readonly streak: number;
}

/** The whole persisted record; see the versioning policy in the store. */
export interface ProgressState {
  readonly schemaVersion: 1;
  readonly nodeStates: Readonly<Record<string, NodeStatus>>;
  /** Absent in pre-v2 records; parsed as empty (legacy area fallback). */
  readonly nodeReviews: Readonly<Record<string, NodeReview>>;
  /**
   * Products whose learning card was actually opened. Distinct from
   * nodeStates because a verify hit grants `verified` without a visit —
   * the content-learning metric must not count those as "read".
   */
  readonly openedIds: readonly string[];
  readonly recallLog: readonly RecallEntry[];
  /** Distinct local dates (YYYY-MM-DD) with at least one visit. */
  readonly sessionLog: readonly string[];
}

const STORAGE_KEY = 'cf-viz-learning-progress';

/**
 * Namespace for solution learning states inside nodeStates/nodeReviews.
 * Product ids and solution ids COLLIDE in the catalog (`workflows` is
 * both), so a raw solution id as a progress key would corrupt the
 * product's verified/streak/re-fog record. Every solution read or write
 * must go through this key — the curated contract enforces the snapshot
 * of known collisions (KNOWN_PRODUCT_SOLUTION_COLLISIONS), this prefix
 * enforces the runtime side.
 */
export const SOLUTION_KEY_PREFIX = 'solution:';

/** The namespaced progress key for one solution. */
export function solutionKey(solutionId: string): string {
  return `${SOLUTION_KEY_PREFIX}${solutionId}`;
}

/**
 * How a finished solution session lands in the record. The log kind and
 * the state effect are independent axes (design 상태 전이표):
 *   verify  — ① passed (≥80% + spray guard): verified + streak+1
 *   demote  — ① failed or ③ missed: back to visited, streak deleted
 *   none    — spray-guarded ① (logged as practice) or a correct ③
 *             (③ is only ever a demotion trigger, never an upgrade)
 */
export type SolutionRecallEffect = 'verify' | 'demote' | 'none';

const EMPTY_STATE: ProgressState = {
  schemaVersion: 1,
  nodeStates: {},
  nodeReviews: {},
  openedIds: [],
  recallLog: [],
  sessionLog: [],
};

function isNodeStatus(value: unknown): value is NodeStatus {
  return value === 'visited' || value === 'marked' || value === 'verified';
}

/**
 * Structural validation for loaded/imported records. Anything that does
 * not match the current schema version is discarded wholesale — the
 * design explicitly rejects migrations as over-engineering for an
 * internal tool, so a mismatch starts a fresh record.
 */
function parseState(raw: unknown): ProgressState | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const candidate = raw as Record<string, unknown>;
  if (candidate['schemaVersion'] !== 1) return null;
  const nodeStates = candidate['nodeStates'];
  const recallLog = candidate['recallLog'];
  const sessionLog = candidate['sessionLog'];
  if (typeof nodeStates !== 'object' || nodeStates === null) return null;
  if (!Array.isArray(recallLog) || !Array.isArray(sessionLog)) return null;

  const states: Record<string, NodeStatus> = {};
  for (const [key, value] of Object.entries(nodeStates)) {
    if (!isNodeStatus(value)) return null;
    states[key] = value;
  }
  const reviews: Record<string, NodeReview> = {};
  const nodeReviews = candidate['nodeReviews'];
  if (nodeReviews !== undefined) {
    if (typeof nodeReviews !== 'object' || nodeReviews === null) return null;
    for (const [key, value] of Object.entries(nodeReviews)) {
      if (typeof value !== 'object' || value === null) return null;
      const review = value as Record<string, unknown>;
      if (typeof review['last'] !== 'string' || typeof review['streak'] !== 'number') return null;
      reviews[key] = { last: review['last'], streak: review['streak'] };
    }
  }
  const openedIds = candidate['openedIds'];
  if (openedIds !== undefined) {
    if (!Array.isArray(openedIds)) return null;
    if (!(openedIds as unknown[]).every((id) => typeof id === 'string')) return null;
  }
  const log: RecallEntry[] = [];
  for (const entry of recallLog as unknown[]) {
    if (typeof entry !== 'object' || entry === null) return null;
    const record = entry as Record<string, unknown>;
    if (
      typeof record['date'] !== 'string' ||
      typeof record['area'] !== 'string' ||
      typeof record['correctSlots'] !== 'number' ||
      typeof record['totalSlots'] !== 'number'
    ) {
      return null;
    }
    // Pre-split records carry no kind; they were graded as verification.
    const kind = record['kind'] ?? 'verify';
    if (kind !== 'practice' && kind !== 'verify') return null;
    log.push({
      date: record['date'],
      area: record['area'],
      kind,
      correctSlots: record['correctSlots'],
      totalSlots: record['totalSlots'],
    });
  }
  if (!(sessionLog as unknown[]).every((day) => typeof day === 'string')) return null;
  return {
    schemaVersion: 1,
    nodeStates: states,
    nodeReviews: reviews,
    openedIds: (openedIds as string[] | undefined) ?? [],
    recallLog: log,
    sessionLog: sessionLog as string[],
  };
}

/**
 * Local date as YYYY-MM-DD (the learner's clock, not UTC). Exported as the
 * single definition of the record's date format — derived features (e.g.
 * re-fog) must compare against the same calendar the log was written in.
 */
export function localToday(): string {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${String(now.getFullYear())}-${month}-${day}`;
}

/**
 * Learning progress record: the node state machine, recall history, and
 * session days, persisted to localStorage under a versioned schema. The
 * JSON export/import pair doubles as backup and as the measurement
 * channel — there is no server, so the report file is how an evaluator
 * ever sees a learner's numbers.
 */
@Injectable({ providedIn: 'root' })
export class ProgressStore {
  private readonly stateSignal = signal<ProgressState>(loadInitialState());

  /** Read-only view of the whole record. */
  readonly state = this.stateSignal.asReadonly();

  /**
   * Count of nodes at or above each status, for map summaries. Solution
   * keys are excluded — "밝힌 노드 X/67" and the verified metrics count
   * products only; solutions get their own counter below.
   */
  readonly revealedCount = computed(
    () =>
      Object.keys(this.stateSignal().nodeStates).filter(
        (key) => !key.startsWith(SOLUTION_KEY_PREFIX),
      ).length,
  );
  readonly verifiedCount = computed(
    () =>
      Object.entries(this.stateSignal().nodeStates).filter(
        ([key, status]) => status === 'verified' && !key.startsWith(SOLUTION_KEY_PREFIX),
      ).length,
  );
  readonly solutionVerifiedCount = computed(
    () =>
      Object.entries(this.stateSignal().nodeStates).filter(
        ([key, status]) => status === 'verified' && key.startsWith(SOLUTION_KEY_PREFIX),
      ).length,
  );

  constructor() {
    effect(() => {
      const state = this.stateSignal();
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      } catch {
        // Storage may be unavailable (private mode, quota); learning still
        // works for the session, it just will not survive a reload.
      }
    });
  }

  statusOf(productId: string): NodeStatus | undefined {
    return this.stateSignal().nodeStates[productId];
  }

  /** Marks today as a session day (deduplicated); call on page entry. */
  touchSession(): void {
    const day = localToday();
    this.stateSignal.update((state) =>
      state.sessionLog.includes(day) ? state : { ...state, sessionLog: [...state.sessionLog, day] },
    );
  }

  /** Card opened: upgrade to at least `visited`, never downgrade. */
  recordVisit(productId: string): void {
    this.stateSignal.update((state) =>
      state.openedIds.includes(productId)
        ? state
        : { ...state, openedIds: [...state.openedIds, productId] },
    );
    this.upgrade(productId, 'visited');
  }

  /** "익혔음": upgrade to at least `marked`, never downgrade. */
  markLearned(productId: string): void {
    this.upgrade(productId, 'marked');
  }

  /**
   * Applies one finished recall session. A `verify` session (free recall)
   * is the only path to `verified`: correct placements upgrade and start
   * or extend the node's review streak, wrong ones demote to `visited`
   * and clear the streak. A `practice` session (chip recognition) is a
   * scaffold — a correct pick raises a node to at most `marked`, a miss
   * changes nothing. Both land in the recall log with their kind.
   */
  recordRecall(
    area: string,
    placements: readonly { readonly productId: string; readonly correct: boolean }[],
    totalSlots: number,
    kind: RecallKind,
  ): void {
    const correctSlots = placements.filter((placement) => placement.correct).length;
    const day = localToday();
    this.stateSignal.update((state) => {
      const nodeStates = { ...state.nodeStates };
      const nodeReviews = { ...state.nodeReviews };
      for (const placement of placements) {
        if (kind === 'practice') {
          if (placement.correct) {
            const current = nodeStates[placement.productId];
            if (current === undefined || STATUS_RANK[current] < STATUS_RANK.marked) {
              nodeStates[placement.productId] = 'marked';
            }
          }
          continue;
        }
        if (placement.correct) {
          nodeStates[placement.productId] = 'verified';
          const previous = nodeReviews[placement.productId];
          nodeReviews[placement.productId] = { last: day, streak: (previous?.streak ?? 0) + 1 };
        } else {
          if (nodeStates[placement.productId] !== undefined) {
            nodeStates[placement.productId] = 'visited';
          }
          delete nodeReviews[placement.productId];
        }
      }
      return {
        ...state,
        nodeStates,
        nodeReviews,
        recallLog: [...state.recallLog, { date: day, area, kind, correctSlots, totalSlots }],
      };
    });
  }

  /** Solution card opened: at least `solution:<id>` visited. Deliberately
   *  NOT in openedIds — that list feeds the product noteReadRate. */
  recordSolutionVisit(solutionId: string): void {
    this.upgrade(solutionKey(solutionId), 'visited');
  }

  /** ② 정의 자가 선언: marked is the ceiling (self-grading ≠ verification). */
  markSolutionLearned(solutionId: string): void {
    this.upgrade(solutionKey(solutionId), 'marked');
  }

  /**
   * Applies one solution session question (① or ③) to the NAMESPACED key
   * only. Product global state is never touched from here — the entered
   * product ids exist for grading alone (design: 맥락 오염 방지). Only a
   * 'verify' effect (question ① passed) starts or extends the streak.
   */
  recordSolutionRecall(
    solutionId: string,
    correctSlots: number,
    totalSlots: number,
    kind: RecallKind,
    effect: SolutionRecallEffect,
  ): void {
    const key = solutionKey(solutionId);
    const day = localToday();
    this.stateSignal.update((state) => {
      const nodeStates = { ...state.nodeStates };
      const nodeReviews = { ...state.nodeReviews };
      if (effect === 'verify') {
        nodeStates[key] = 'verified';
        const previous = nodeReviews[key];
        nodeReviews[key] = { last: day, streak: (previous?.streak ?? 0) + 1 };
      } else if (effect === 'demote') {
        if (nodeStates[key] !== undefined) {
          nodeStates[key] = 'visited';
        }
        delete nodeReviews[key];
      }
      return {
        ...state,
        nodeStates,
        nodeReviews,
        recallLog: [...state.recallLog, { date: day, area: key, kind, correctSlots, totalSlots }],
      };
    });
  }

  /** The measurement report; `extras` lets the caller add derived stats. */
  exportJson(extras?: Readonly<Record<string, unknown>>): string {
    return JSON.stringify({ ...this.stateSignal(), ...(extras ?? {}) }, null, 2);
  }

  /** Replaces the record from an exported report; false on invalid input. */
  importJson(text: string): boolean {
    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch {
      return false;
    }
    const parsed = parseState(raw);
    if (parsed === null) return false;
    this.stateSignal.set(parsed);
    return true;
  }

  private upgrade(productId: string, status: NodeStatus): void {
    this.stateSignal.update((state) => {
      const current = state.nodeStates[productId];
      if (current !== undefined && STATUS_RANK[current] >= STATUS_RANK[status]) {
        return state;
      }
      return { ...state, nodeStates: { ...state.nodeStates, [productId]: status } };
    });
  }
}

function loadInitialState(): ProgressState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === null) return EMPTY_STATE;
    return parseState(JSON.parse(raw)) ?? EMPTY_STATE;
  } catch {
    return EMPTY_STATE;
  }
}

export { EMPTY_STATE as EMPTY_PROGRESS, STORAGE_KEY as PROGRESS_STORAGE_KEY };
