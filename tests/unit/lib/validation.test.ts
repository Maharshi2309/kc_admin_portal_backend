import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { fromZodError } from '@/lib/errors';
import {
  calendarDate,
  ecNumber,
  email,
  id,
  instant,
  mobile,
  month,
  oneOf,
  optionalQuery,
  optionalText,
  requiredText,
  searchQuery,
  timeOfDay,
} from '@/lib/validation';

/** The message for [input], or 'ok' when it passes. */
function check(schema: z.ZodType, input: unknown): string {
  const result = schema.safeParse(input);
  return result.success ? 'ok' : result.error.issues[0]!.message;
}

describe('field rules', () => {
  it('parses ids sent as strings or numbers', () => {
    expect(id().parse('7')).toBe(7);
    expect(id().parse(7)).toBe(7);
    expect(check(id('department'), 'abc')).toBe('Choose a valid department');
    expect(check(id(), '0')).toBe('Choose a valid id');
    expect(check(id(), '99999999999')).toBe('Choose a valid id');
    expect(check(id(), '-1')).toBe('Choose a valid id');
  });

  it('trims and limits required text', () => {
    expect(requiredText('Name', 100).parse('  Asha  ')).toBe('Asha');
    expect(check(requiredText('Name', 100), '   ')).toBe('Name is required');
    expect(check(requiredText('Name', 100), undefined)).toBe('Name is required');
    expect(check(requiredText('Name', 3), 'Asha')).toBe('Use at most 3 characters');
  });

  it('turns blank optional text into null', () => {
    expect(optionalText(500).parse('  ')).toBeNull();
    expect(optionalText(500).parse(undefined)).toBeNull();
    expect(optionalText(500).parse(null)).toBeNull();
    expect(optionalText(500).parse(' note ')).toBe('note');
  });

  it('checks and lower-cases emails', () => {
    expect(email().parse(' Rahul.Sharma@Keshav.in ')).toBe('rahul.sharma@keshav.in');
    expect(check(email(), 'rahul@')).toBe('Enter a valid email address');
    expect(check(email(), '')).toBe('Email address is required');
  });

  it('checks EC numbers like the app (KC + digits, no case change)', () => {
    expect(ecNumber().parse(' KC1129 ')).toBe('KC1129');
    expect(check(ecNumber(), 'kc1129')).toBe('Use KC followed by numbers, e.g. KC1001');
    expect(check(ecNumber(), 'KC')).toBe('Use KC followed by numbers, e.g. KC1001');
  });

  it('checks 10-digit mobile numbers', () => {
    expect(mobile().parse('9876543210')).toBe('9876543210');
    expect(check(mobile(), '+919876543210')).toBe('Enter a 10-digit mobile number');
  });

  it('checks dates, months and times', () => {
    expect(calendarDate().parse('2026-09-28')).toBe('2026-09-28');
    expect(check(calendarDate(), '2026-02-30')).toBe('Use a date in the form YYYY-MM-DD');
    expect(check(calendarDate('Start date'), undefined)).toBe('Start date is required');
    expect(month().parse('2026-09')).toBe('2026-09');
    expect(timeOfDay().parse('18:30')).toBe('18:30');
    expect(check(timeOfDay(), '6:30 pm')).toBe('Use a time in the form HH:mm');
  });

  it('requires an offset on instants', () => {
    expect(instant().parse('2026-09-28T09:35:00+05:30').toISOString()).toBe(
      '2026-09-28T04:05:00.000Z',
    );
    expect(instant().parse('2026-09-28T04:05:00Z').toISOString()).toBe(
      '2026-09-28T04:05:00.000Z',
    );
    expect(check(instant(), '2026-09-28T09:35:00')).toMatch(/time zone offset/);
  });

  it('accepts only listed enum values', () => {
    const status = oneOf(['active', 'inactive'] as const, 'Choose active or inactive');
    expect(status.parse('inactive')).toBe('inactive');
    expect(check(status, 'deleted')).toBe('Choose active or inactive');
  });

  it('treats blank search and filters as not set', () => {
    expect(searchQuery().parse('  ')).toBeUndefined();
    expect(searchQuery().parse(' KC10 ')).toBe('KC10');
    const filter = optionalQuery(id('department'));
    expect(filter.parse('')).toBeUndefined();
    expect(filter.parse(undefined)).toBeUndefined();
    expect(filter.parse('4')).toBe(4);
  });
});

describe('default messages', () => {
  it('replaces Zod jargon for fields a schema does not word itself', () => {
    const schema = z.object({ count: z.number(), flags: z.array(z.string()) });
    const error = fromZodError(schema.safeParse({ flags: 'x' }).error!);
    expect(error.fieldErrors).toEqual({
      count: ['This field is required'],
      flags: ['Must be a list'],
    });
  });

  it('builds dotted field keys for nested schedule fields', () => {
    const schema = z.object({ schedule: z.object({ startTime: timeOfDay('Start time') }) });
    const error = fromZodError(schema.safeParse({ schedule: { startTime: '25:00' } }).error!);
    expect(error.fieldErrors).toEqual({ 'schedule.startTime': ['Use a time in the form HH:mm'] });
  });
});
