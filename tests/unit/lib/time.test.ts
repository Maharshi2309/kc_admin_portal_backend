import { describe, expect, it } from 'vitest';
import {
  addDays,
  companyDateOf,
  companyInstant,
  companyTimeOf,
  companyToday,
  dateFromDb,
  dateToDb,
  eachDate,
  formatInstant,
  isCalendarDate,
  isMonth,
  isTimeOfDay,
  isoWeekday,
  minutesBetween,
  minutesOfDay,
  monthAsDate,
  monthRange,
  startOfCompanyDay,
  timeFromDb,
  timeFromMinutes,
  timeToDb,
} from '@/lib/time';

const IST = 'Asia/Kolkata';

describe('instants in the company zone', () => {
  it('formats with the +05:30 offset and whole seconds', () => {
    expect(formatInstant(new Date('2026-09-28T04:05:00.123Z'), IST)).toBe(
      '2026-09-28T09:35:00+05:30',
    );
  });

  it('decides the date of a punch in company time, not UTC', () => {
    // 20:00 UTC on the 27th is 01:30 on the 28th in India.
    const late = new Date('2026-09-27T20:00:00Z');
    expect(companyDateOf(late, IST)).toBe('2026-09-28');
    expect(companyTimeOf(late, IST)).toBe('01:30');
  });

  it('gives "today" from an injected clock', () => {
    expect(companyToday(() => new Date('2026-09-30T19:00:00Z'), IST)).toBe('2026-10-01');
  });

  it('builds the instant of a shift start', () => {
    expect(companyInstant('2026-09-28', '09:30', IST).toISOString()).toBe(
      '2026-09-28T04:00:00.000Z',
    );
    expect(startOfCompanyDay('2026-09-28', IST).toISOString()).toBe('2026-09-27T18:30:00.000Z');
  });

  it('follows daylight saving in zones that have it (zone-aware, not a fixed offset)', () => {
    const london = 'Europe/London';
    expect(formatInstant(new Date('2026-01-15T12:00:00Z'), london)).toBe(
      '2026-01-15T12:00:00Z'.replace('Z', '+00:00'),
    );
    expect(formatInstant(new Date('2026-07-15T12:00:00Z'), london)).toBe(
      '2026-07-15T13:00:00+01:00',
    );
  });

  it('rounds worked minutes down', () => {
    expect(minutesBetween(new Date('2026-09-28T03:28:00Z'), new Date('2026-09-28T13:30:59Z'))).toBe(
      602,
    );
  });
});

describe('calendar dates', () => {
  it('validates dates, months and times strictly', () => {
    expect(isCalendarDate('2026-09-28')).toBe(true);
    expect(isCalendarDate('2026-02-30')).toBe(false);
    expect(isCalendarDate('2026-9-28')).toBe(false);
    expect(isMonth('2026-09')).toBe(true);
    expect(isMonth('2026-13')).toBe(false);
    expect(isTimeOfDay('09:30')).toBe(true);
    expect(isTimeOfDay('24:00')).toBe(false);
    expect(isTimeOfDay('9:30')).toBe(false);
  });

  it('does date arithmetic without time zones', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(eachDate('2026-09-29', '2026-10-02')).toEqual([
      '2026-09-29',
      '2026-09-30',
      '2026-10-01',
      '2026-10-02',
    ]);
    expect(eachDate('2026-10-02', '2026-10-01')).toEqual([]);
  });

  it('uses ISO weekdays (1 = Monday, 7 = Sunday)', () => {
    expect(isoWeekday('2026-09-28')).toBe(1);
    expect(isoWeekday('2026-10-04')).toBe(7);
  });

  it('gives month ranges and the response form of a month', () => {
    expect(monthRange('2026-02')).toEqual({ first: '2026-02-01', last: '2026-02-28' });
    expect(monthRange('2028-02')).toEqual({ first: '2028-02-01', last: '2028-02-29' });
    expect(monthAsDate('2026-09')).toBe('2026-09-01');
  });
});

describe('database mapping', () => {
  it('round-trips DATE values without shifting a day', () => {
    expect(dateToDb('2026-09-28').toISOString()).toBe('2026-09-28T00:00:00.000Z');
    expect(dateFromDb(dateToDb('2026-01-01'))).toBe('2026-01-01');
  });

  it('round-trips TIME values', () => {
    expect(timeFromDb(timeToDb('18:30'))).toBe('18:30');
  });

  it('converts times of day to and from minutes', () => {
    expect(minutesOfDay('09:30')).toBe(570);
    expect(timeFromMinutes(570)).toBe('09:30');
    expect(() => timeFromMinutes(1440)).toThrow(RangeError);
  });
});
