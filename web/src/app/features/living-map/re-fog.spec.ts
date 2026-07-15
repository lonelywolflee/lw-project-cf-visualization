import type { RecallEntry } from '../../core/learning/progress-store';

import { addDays, areaReviewStates, nodeReviewStates } from './re-fog';

const AREA = 'application-security';

function session(date: string, correctSlots: number, totalSlots = 10, area = AREA): RecallEntry {
  return { date, area, kind: 'verify', correctSlots, totalSlots };
}

describe('addDays', () => {
  it('adds within a month', () => {
    expect(addDays('2026-07-15', 4)).toBe('2026-07-19');
  });

  it('rolls over month and year boundaries', () => {
    expect(addDays('2026-07-31', 1)).toBe('2026-08-01');
    expect(addDays('2026-12-31', 4)).toBe('2027-01-04');
  });
});

describe('areaReviewStates', () => {
  it('returns nothing for an empty log', () => {
    expect(areaReviewStates([], '2026-07-15').size).toBe(0);
  });

  it('schedules the first successful session one day out', () => {
    const states = areaReviewStates([session('2026-07-15', 10)], '2026-07-15');
    expect(states.get(AREA)).toMatchObject({
      streak: 1,
      lastSessionDate: '2026-07-15',
      dueDate: '2026-07-16',
      stale: false,
    });
  });

  it('re-fogs the area once today reaches the due date', () => {
    const states = areaReviewStates([session('2026-07-15', 10)], '2026-07-16');
    expect(states.get(AREA)?.stale).toBe(true);
  });

  it('widens the interval with the success streak: 1 → 4 → 14 days, capped', () => {
    const run = (dates: readonly string[]): string | undefined => {
      const states = areaReviewStates(
        dates.map((date) => session(date, 10)),
        '2026-07-20',
      );
      return states.get(AREA)?.dueDate;
    };
    expect(run(['2026-07-10', '2026-07-11'])).toBe('2026-07-15'); // streak 2 → +4d
    expect(run(['2026-07-01', '2026-07-05', '2026-07-10'])).toBe('2026-07-24'); // streak 3 → +14d
    expect(run(['2026-06-01', '2026-07-01', '2026-07-05', '2026-07-10'])).toBe('2026-07-24'); // capped
  });

  it('treats 80% correct as a success and anything below as a failure', () => {
    const pass = areaReviewStates([session('2026-07-15', 8)], '2026-07-15');
    expect(pass.get(AREA)?.streak).toBe(1);
    const fail = areaReviewStates([session('2026-07-15', 7)], '2026-07-15');
    expect(fail.get(AREA)?.streak).toBe(0);
  });

  it('resets the streak after a failed session — the area comes back in a day', () => {
    const states = areaReviewStates(
      [session('2026-07-10', 10), session('2026-07-12', 3)],
      '2026-07-15',
    );
    expect(states.get(AREA)).toMatchObject({ streak: 0, dueDate: '2026-07-13', stale: true });
  });

  it('counts the streak only from sessions after the last failure', () => {
    const states = areaReviewStates(
      [session('2026-07-08', 10), session('2026-07-10', 2), session('2026-07-12', 9)],
      '2026-07-12',
    );
    expect(states.get(AREA)).toMatchObject({ streak: 1, dueDate: '2026-07-13' });
  });

  it('never divides by zero: an empty-slot session counts as a failure', () => {
    const states = areaReviewStates([session('2026-07-15', 0, 0)], '2026-07-15');
    expect(states.get(AREA)?.streak).toBe(0);
  });

  it('tracks areas independently', () => {
    const states = areaReviewStates(
      [session('2026-07-01', 10), session('2026-07-15', 10, 10, 'compute-platform')],
      '2026-07-15',
    );
    expect(states.get(AREA)?.stale).toBe(true);
    expect(states.get('compute-platform')?.stale).toBe(false);
  });
});

describe('nodeReviewStates', () => {
  it('schedules each node by its own streak — the per-item SM-2 property', () => {
    const states = nodeReviewStates(
      {
        waf: { last: '2026-07-10', streak: 1 }, // +1d → due 07-11, stale
        cdn: { last: '2026-07-10', streak: 2 }, // +4d → due 07-14, stale today (07-15)
        dns: { last: '2026-07-10', streak: 3 }, // +14d → due 07-24, fresh
      },
      '2026-07-15',
    );
    expect(states.get('waf')).toMatchObject({ dueDate: '2026-07-11', stale: true });
    expect(states.get('cdn')).toMatchObject({ dueDate: '2026-07-14', stale: true });
    expect(states.get('dns')).toMatchObject({ dueDate: '2026-07-24', stale: false });
    expect(states.get('unknown')).toBeUndefined();
  });

  it('caps the interval at fourteen days for long streaks', () => {
    const states = nodeReviewStates({ waf: { last: '2026-07-01', streak: 9 } }, '2026-07-10');
    expect(states.get('waf')?.dueDate).toBe('2026-07-15');
  });
});
