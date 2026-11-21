import { describe, it, expect } from 'vitest';
import { formatRelativeTime } from '../../../src/utils/formatRelativeTime';

const NOW = Date.parse('2026-11-21T12:00:00.000Z');
const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

const ago = (ms) => new Date(NOW - ms).toISOString();

describe('formatRelativeTime', () => {
  it.each([
    ['0 seconds', 0, 'just now'],
    ['59 seconds', 59 * SECOND, 'just now'],
    ['1 minute', MINUTE, '1m ago'],
    ['59 minutes', 59 * MINUTE, '59m ago'],
    ['1 hour', HOUR, '1h ago'],
    ['23 hours', 23 * HOUR, '23h ago'],
    ['1 day', DAY, '1d ago'],
    ['30 days', 30 * DAY, '30d ago'],
  ])('formats %s ago as "%s"', (_label, elapsed, expected) => {
    expect(formatRelativeTime(ago(elapsed), NOW)).toBe(expected);
  });

  it('shows a short date after 30 days', () => {
    const result = formatRelativeTime(ago(31 * DAY), NOW);

    expect(result).not.toMatch(/ago$/);
    expect(result).toMatch(/2026/);
  });

  it('treats a slightly future time (clock skew) as just now', () => {
    expect(formatRelativeTime(new Date(NOW + 5 * SECOND).toISOString(), NOW)).toBe('just now');
  });

  it('returns an empty string for an invalid date', () => {
    expect(formatRelativeTime('not-a-date', NOW)).toBe('');
  });
});
