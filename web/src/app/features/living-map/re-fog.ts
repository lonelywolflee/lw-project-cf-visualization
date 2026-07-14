import type { RecallEntry } from '../../core/learning/progress-store';

/**
 * Spaced-repetition re-fog, derived entirely from the recall log. The only
 * way a node becomes `verified` is a recall session, and every session
 * appends a log entry for its area — so "when was this area last verified"
 * is already in the record. Deriving instead of storing means no schema
 * change: the learner's existing progress survives untouched, and there is
 * no migration code to maintain.
 *
 * Interval policy (fixes the design's Open Question 4 defaults): an area
 * is due again [1, 4, 14] days after its last session, indexed by the
 * length of its ending streak of successful sessions. A session counts as
 * successful at 80% of slots correct; anything less resets the streak, so
 * a shaky area comes back after a single day.
 *
 * The nudge this feeds is in-app only, per the design — there is no
 * server or notification channel.
 */

export const REFOG_INTERVALS_DAYS = [1, 4, 14] as const;
export const REFOG_SUCCESS_THRESHOLD = 0.8;

/** Review posture of one map area (layer) that has recall history. */
export interface AreaReviewState {
  readonly area: string;
  /** Date (YYYY-MM-DD) of the area's most recent recall session. */
  readonly lastSessionDate: string;
  /** Successful sessions in a row, counted back from the latest. */
  readonly streak: number;
  /** First local date on which the area counts as re-fogged. */
  readonly dueDate: string;
  /** True once `todayDate` reaches the due date. */
  readonly stale: boolean;
}

function isSuccess(entry: RecallEntry): boolean {
  return entry.totalSlots > 0 && entry.correctSlots / entry.totalSlots >= REFOG_SUCCESS_THRESHOLD;
}

/** Adds days to a local YYYY-MM-DD date; Date normalises the overflow. */
export function addDays(isoDate: string, days: number): string {
  const [year = 0, month = 1, day = 1] = isoDate.split('-').map(Number);
  const date = new Date(year, month - 1, day + days);
  const paddedMonth = String(date.getMonth() + 1).padStart(2, '0');
  const paddedDay = String(date.getDate()).padStart(2, '0');
  return `${String(date.getFullYear())}-${paddedMonth}-${paddedDay}`;
}

/**
 * Computes the review state of every area present in the recall log. The
 * log is trusted to be append-only in time order (recordRecall only ever
 * appends "today"). `todayDate` is injected so the function stays pure and
 * the specs stay clock-free; fixed-width ISO dates make staleness a plain
 * lexicographic comparison.
 */
export function areaReviewStates(
  recallLog: readonly RecallEntry[],
  todayDate: string,
): ReadonlyMap<string, AreaReviewState> {
  const byArea = new Map<string, RecallEntry[]>();
  for (const entry of recallLog) {
    const entries = byArea.get(entry.area);
    if (entries === undefined) {
      byArea.set(entry.area, [entry]);
    } else {
      entries.push(entry);
    }
  }

  const states = new Map<string, AreaReviewState>();
  for (const [area, entries] of byArea) {
    const last = entries[entries.length - 1];
    if (last === undefined) continue;
    let streak = 0;
    for (let index = entries.length - 1; index >= 0; index -= 1) {
      const entry = entries[index];
      if (entry === undefined || !isSuccess(entry)) break;
      streak += 1;
    }
    const intervalIndex = Math.min(Math.max(streak, 1), REFOG_INTERVALS_DAYS.length) - 1;
    const interval = REFOG_INTERVALS_DAYS[intervalIndex] ?? 1;
    const dueDate = addDays(last.date, interval);
    states.set(area, {
      area,
      lastSessionDate: last.date,
      streak,
      dueDate,
      stale: todayDate >= dueDate,
    });
  }
  return states;
}
