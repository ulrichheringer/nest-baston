import { normalizeLock } from './duration';
import { LockOptions, LockProvider, LockResult } from './types';
export class LockExecutor {
  constructor(private readonly provider: LockProvider) {}
  async execute<T>(options: LockOptions, task: () => T | Promise<T>): Promise<LockResult<T>> {
    const request = normalizeLock(options);
    const handle = await this.provider.acquire(request);
    if (!handle) return { executed: false };
    if (options.renewWhileRunning && !handle.renew) {
      await handle.release();
      throw new Error('Lock provider does not support renewal');
    }

    let timer: NodeJS.Timeout | undefined;
    let pending: Promise<void> | undefined;
    let renewalFailed = false;
    let renewalError: unknown;
    if (options.renewWhileRunning) {
      timer = setInterval(() => {
        if (pending) return;
        pending = Promise.resolve().then(() => handle.renew!(request.lockAtMostFor)).then(renewed => {
          if (!renewed) throw new Error(`Lock renewal lost ownership: ${request.name}`);
        }).catch(error => {
          renewalFailed = true;
          renewalError = error;
          clearInterval(timer);
        }).finally(() => { pending = undefined; });
      }, Math.max(1, Math.floor(request.lockAtMostFor / 3)));
      timer.unref?.();
    }

    let taskFailed = false;
    let taskError: unknown;
    try { return { executed: true, value: await task() }; }
    catch (error) { taskFailed = true; taskError = error; throw error; }
    finally {
      clearInterval(timer);
      await pending;
      let releaseFailed = false;
      let releaseError: unknown;
      try { await handle.release(); }
      catch (error) { releaseFailed = true; releaseError = error; }
      if ((taskFailed && (renewalFailed || releaseFailed)) || (renewalFailed && releaseFailed)) {
        const errors: unknown[] = [];
        if (taskFailed) errors.push(taskError);
        if (renewalFailed) errors.push(renewalError);
        if (releaseFailed) errors.push(releaseError);
        throw new AggregateError(errors, 'Task or lock lifecycle failed');
      }
      if (renewalFailed) throw renewalError;
      if (releaseFailed) throw releaseError;
    }
  }
}
