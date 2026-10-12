import { describe, expect, it } from 'vitest';
import { type DayInput, computeDay } from '@/modules/day-engine/compute-day';

/**
 * Every rule of DATABASE_V2.md §3, including its worked examples, plus the
 * app's reference behaviour where the spec is silent (T-10, T-14, T-15).
 */

const IST = 'Asia/Kolkata';
/** An instant from company wall-clock time. */
const at = (date: string, time: string) => new Date(`${date}T${time}:00+05:30`);

// Mon 2026-10-05; Sunday off. 09:00–17:30 with a 13:00–14:00 break = 450 min.
const withWindow = {
  startTime: '09:00',
  endTime: '17:30',
  breakMinutes: 60,
  breakStart: '13:00',
  breakEnd: '14:00',
  weeklyOffDays: [7],
  expectedMinutes: 450,
};
const noWindow = { ...withWindow, startTime: '09:30', endTime: '18:30', breakStart: null, breakEnd: null, expectedMinutes: 480 };

const day = (overrides: Partial<DayInput> = {}): DayInput => ({
  date: '2026-10-05',
  now: at('2026-10-10', '12:00'), // a later day, so 2026-10-05 is in the past
  schedule: withWindow,
  isHoliday: false,
  leave: 'none',
  punchIn: null,
  punchOut: null,
  zone: IST,
  ...overrides,
});

describe('computeDay: day type (§3.1)', () => {
  it('is a weekly off on a schedule off day', () => {
    expect(computeDay(day({ date: '2026-10-04' }))).toMatchObject({ dayType: 'week_off', status: 'weekly_off', expectedMinutes: 0 });
  });

  it('lets a holiday win over a weekly off', () => {
    expect(computeDay(day({ date: '2026-10-04', isHoliday: true }))).toMatchObject({ dayType: 'holiday', status: 'holiday' });
  });
});

describe('computeDay: worked and overtime (§3.3 worked examples)', () => {
  it('08:58–19:00 covering the break: worked 542, overtime 92', () => {
    const result = computeDay(day({ punchIn: at('2026-10-05', '08:58'), punchOut: at('2026-10-05', '19:00') }));
    expect(result).toMatchObject({ workedMinutes: 542, overtimeMinutes: 92, status: 'present', workedPercent: 100 });
  });

  it('a holiday 10:00–15:00: 300 worked, all of it overtime, no break deducted', () => {
    const result = computeDay(day({ isHoliday: true, punchIn: at('2026-10-05', '10:00'), punchOut: at('2026-10-05', '15:00') }));
    expect(result).toMatchObject({
      dayType: 'holiday',
      dayKind: 'holiday_worked',
      status: 'present',
      expectedMinutes: 0,
      workedMinutes: 300,
      overtimeMinutes: 300,
      workedPercent: null,
    });
  });

  it('work on a weekly off is week_off_worked and all overtime', () => {
    const result = computeDay(day({ date: '2026-10-04', punchIn: at('2026-10-04', '10:00'), punchOut: at('2026-10-04', '12:30') }));
    expect(result).toMatchObject({ dayKind: 'week_off_worked', workedMinutes: 150, overtimeMinutes: 150 });
  });

  it('deducts a windowed break only when the stay covers the whole window', () => {
    const leftAtLunch = computeDay(day({ punchIn: at('2026-10-05', '09:00'), punchOut: at('2026-10-05', '13:30') }));
    expect(leftAtLunch.workedMinutes).toBe(270);
    const cameAfterLunch = computeDay(day({ punchIn: at('2026-10-05', '13:05'), punchOut: at('2026-10-05', '17:30') }));
    expect(cameAfterLunch.workedMinutes).toBe(265);
  });

  it('without a window, deducts the break only when the stay is longer than it', () => {
    const short = computeDay(day({ schedule: noWindow, punchIn: at('2026-10-05', '09:30'), punchOut: at('2026-10-05', '10:30') }));
    expect(short.workedMinutes).toBe(60);
    const long = computeDay(day({ schedule: noWindow, punchIn: at('2026-10-05', '09:30'), punchOut: at('2026-10-05', '10:31') }));
    expect(long.workedMinutes).toBe(1);
  });

  it('never counts a shortfall as negative overtime', () => {
    const result = computeDay(day({ punchIn: at('2026-10-05', '09:00'), punchOut: at('2026-10-05', '15:00') }));
    expect(result).toMatchObject({ workedMinutes: 300, overtimeMinutes: 0 });
  });

  it('rounds worked minutes down and the percentage to one decimal', () => {
    const result = computeDay(
      day({ schedule: noWindow, punchIn: at('2026-10-05', '10:08'), punchOut: new Date(at('2026-10-05', '14:30').getTime() + 59_000) }),
    );
    // 262 min stay > 60 min break, so 202 worked of 480 = 42.08 %.
    expect(result).toMatchObject({ workedMinutes: 202, workedPercent: 42.1 });
  });
});

describe('computeDay: open punches', () => {
  it('counts an open punch up to now, today', () => {
    // The contract example: 10:08 punch, 14:30 now, 09:30–18:30 with a 60-min break (no window).
    const result = computeDay(
      day({ schedule: noWindow, now: at('2026-10-05', '14:30'), punchIn: at('2026-10-05', '10:08') }),
    );
    expect(result).toMatchObject({ status: 'late', note: null, lateMinutes: 38, workedMinutes: 202, workedPercent: 42.1 });
  });

  it('has no worked time on a past day without a punch out (T-15)', () => {
    const result = computeDay(day({ punchIn: at('2026-10-05', '09:00') }));
    expect(result).toMatchObject({ workedMinutes: null, overtimeMinutes: 0, workedPercent: null });
  });
});

describe('computeDay: status and late (§3.4)', () => {
  it('is late only after start + 15 minutes, counted from the start time', () => {
    expect(computeDay(day({ punchIn: at('2026-10-05', '09:15'), punchOut: at('2026-10-05', '17:30') }))).toMatchObject({
      status: 'present',
      lateMinutes: null,
    });
    expect(computeDay(day({ punchIn: at('2026-10-05', '09:16'), punchOut: at('2026-10-05', '17:30') }))).toMatchObject({
      status: 'late',
      note: null,
      lateMinutes: 16,
    });
  });

  it('is absent on a past working day without a punch', () => {
    expect(computeDay(day())).toMatchObject({ status: 'absent', note: null, due: true, expectedMinutes: 450 });
  });

  it('shows "Not in yet" before start + grace today, not yet due (T-14)', () => {
    const early = computeDay(day({ now: at('2026-10-05', '09:10') }));
    expect(early).toMatchObject({ status: 'absent', note: 'Not in yet', due: false });
    const after = computeDay(day({ now: at('2026-10-05', '09:16') }));
    expect(after).toMatchObject({ status: 'absent', note: null, due: true });
  });

  it('is on_leave with nothing expected on approved full-day leave', () => {
    expect(computeDay(day({ leave: 'full_day' }))).toMatchObject({ status: 'on_leave', expectedMinutes: 0 });
  });

  it('halves the expected time on half-day leave (T-10 for status)', () => {
    const worked = computeDay(day({ leave: 'half_day', punchIn: at('2026-10-05', '13:30'), punchOut: at('2026-10-05', '17:30') }));
    expect(worked).toMatchObject({ status: 'half_day', expectedMinutes: 225, workedMinutes: 240, overtimeMinutes: 15 });
    expect(computeDay(day({ leave: 'half_day' }))).toMatchObject({ status: 'absent', expectedMinutes: 225 });
  });

  it('never makes a holiday or weekly off an absence', () => {
    expect(computeDay(day({ isHoliday: true })).status).toBe('holiday');
    expect(computeDay(day({ date: '2026-10-04' })).status).toBe('weekly_off');
  });
});
