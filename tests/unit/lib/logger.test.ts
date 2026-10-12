import { describe, expect, it } from 'vitest';
import { createLogger } from '@/lib/logger';

function capture() {
  const lines: { level: string; entry: Record<string, unknown> }[] = [];
  const sink = (level: string, line: string) =>
    lines.push({ level, entry: JSON.parse(line) as Record<string, unknown> });
  return { lines, sink };
}

describe('createLogger', () => {
  it('writes one JSON object per entry with level, message and fields', () => {
    const { lines, sink } = capture();
    createLogger({ level: 'info', sink }).info('Employee created', { employeeId: '7' });

    expect(lines).toHaveLength(1);
    expect(lines[0]!.entry).toMatchObject({
      level: 'info',
      message: 'Employee created',
      employeeId: '7',
    });
    expect(typeof lines[0]!.entry.time).toBe('string');
  });

  it('drops entries below the configured level', () => {
    const { lines, sink } = capture();
    const log = createLogger({ level: 'warn', sink });
    log.debug('d');
    log.info('i');
    log.warn('w');
    log.error('e');
    expect(lines.map((l) => l.level)).toEqual(['warn', 'error']);
  });

  it('adds child fields to every entry', () => {
    const { lines, sink } = capture();
    createLogger({ level: 'info', sink }).child({ requestId: 'r1' }).info('hello');
    expect(lines[0]!.entry.requestId).toBe('r1');
  });

  it('serialises errors with name and message', () => {
    const { lines, sink } = capture();
    createLogger({ level: 'info', sink }).error('failed', { error: new TypeError('boom') });
    expect(lines[0]!.entry.error).toMatchObject({ name: 'TypeError', message: 'boom' });
  });
});
