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

/** One finished recall session over a single map area (layer). */
export interface RecallEntry {
  /** Local date, YYYY-MM-DD. */
  readonly date: string;
  /** The layer the session covered. */
  readonly area: string;
  readonly correctSlots: number;
  readonly totalSlots: number;
}

/** The whole persisted record; see the versioning policy in the store. */
export interface ProgressState {
  readonly schemaVersion: 1;
  readonly nodeStates: Readonly<Record<string, NodeStatus>>;
  readonly recallLog: readonly RecallEntry[];
  /** Distinct local dates (YYYY-MM-DD) with at least one visit. */
  readonly sessionLog: readonly string[];
}

const STORAGE_KEY = 'cf-viz-learning-progress';

const EMPTY_STATE: ProgressState = {
  schemaVersion: 1,
  nodeStates: {},
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
    log.push({
      date: record['date'],
      area: record['area'],
      correctSlots: record['correctSlots'],
      totalSlots: record['totalSlots'],
    });
  }
  if (!(sessionLog as unknown[]).every((day) => typeof day === 'string')) return null;
  return {
    schemaVersion: 1,
    nodeStates: states,
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

  /** Count of nodes at or above each status, for map summaries. */
  readonly revealedCount = computed(() => Object.keys(this.stateSignal().nodeStates).length);
  readonly verifiedCount = computed(
    () =>
      Object.values(this.stateSignal().nodeStates).filter((status) => status === 'verified').length,
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
    this.upgrade(productId, 'visited');
  }

  /** "익혔음": upgrade to at least `marked`, never downgrade. */
  markLearned(productId: string): void {
    this.upgrade(productId, 'marked');
  }

  /**
   * Applies one finished recall session: correct placements upgrade to
   * `verified`, wrong ones demote to `visited` (re-fogging the node), and
   * the session lands in the recall log.
   */
  recordRecall(
    area: string,
    placements: readonly { readonly productId: string; readonly correct: boolean }[],
    totalSlots: number,
  ): void {
    const correctSlots = placements.filter((placement) => placement.correct).length;
    this.stateSignal.update((state) => {
      const nodeStates = { ...state.nodeStates };
      for (const placement of placements) {
        if (placement.correct) {
          nodeStates[placement.productId] = 'verified';
        } else if (nodeStates[placement.productId] !== undefined) {
          nodeStates[placement.productId] = 'visited';
        }
      }
      return {
        ...state,
        nodeStates,
        recallLog: [...state.recallLog, { date: localToday(), area, correctSlots, totalSlots }],
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
