import { expect, it } from 'vitest';
import { durationMs, normalizeLock } from './duration';
it('parses durations and rejects invalid configurations', () => {
  expect(durationMs('1.5s')).toBe(1500);
  expect(durationMs('2m')).toBe(120000);
  for (const value of [-1, NaN, Infinity, 'oops', '1.2ms']) expect(() => durationMs(value as never)).toThrow();
  expect(() => normalizeLock({ name: '', lockAtMostFor: 100 })).toThrow();
  expect(() => normalizeLock({ name: 'job', lockAtMostFor: 0 })).toThrow();
  expect(() => normalizeLock({ name: 'job', lockAtMostFor: 100, lockAtLeastFor: 101 })).toThrow();
});
