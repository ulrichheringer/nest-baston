import { normalizeLock } from './duration';
import { LockOptions, LockProvider, LockResult } from './types';
export class LockExecutor {
  constructor(private readonly provider: LockProvider) {}
  async execute<T>(options: LockOptions, task: () => T | Promise<T>): Promise<LockResult<T>> {
    const handle = await this.provider.acquire(normalizeLock(options));
    if (!handle) return { executed: false };
    let failed = false;
    let taskError: unknown;
    try { return { executed: true, value: await task() }; }
    catch (error) { failed = true; taskError = error; throw error; }
    finally {
      try { await handle.release(); }
      catch (releaseError) {
        if (failed) throw new AggregateError([taskError, releaseError], 'Task and lock release failed');
        throw releaseError;
      }
    }
  }
}
