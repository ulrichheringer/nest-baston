import { Duration, LockOptions, LockRequest } from './types';
export function durationMs(value: Duration): number {
  const units: Record<string, number> = { ms: 1, s: 1000, m: 60000, h: 3600000, d: 86400000 };
  const match = typeof value === 'string' ? /^(\d+(?:\.\d+)?)(ms|s|m|h|d)$/.exec(value) : null;
  const result = typeof value === 'number' ? value : match ? Number(match[1]) * units[match[2]] : NaN;
  if (!Number.isSafeInteger(result) || result < 0) throw new Error(`Invalid duration: ${value}`);
  return result;
}
export function normalizeLock(options: LockOptions): LockRequest {
  if (!options.name?.trim()) throw new Error('Lock name must not be empty');
  const lockAtMostFor = durationMs(options.lockAtMostFor);
  const lockAtLeastFor = durationMs(options.lockAtLeastFor ?? 0);
  if (lockAtMostFor === 0 || lockAtLeastFor > lockAtMostFor) throw new Error('Require 0 <= lockAtLeastFor <= lockAtMostFor and lockAtMostFor > 0');
  return { name: options.name, lockAtMostFor, lockAtLeastFor };
}
