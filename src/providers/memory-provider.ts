import { LockHandle, LockProvider, LockRequest } from '../core/types';
/** Local process only; use a shared provider for multiple replicas. */
export class MemoryLockProvider implements LockProvider {
  private readonly locks = new Map<string, { token: symbol; until: number }>();
  constructor(private readonly now: () => number = Date.now) {}
  async acquire(request: LockRequest): Promise<LockHandle | null> {
    const now = this.now();
    if ((this.locks.get(request.name)?.until ?? 0) > now) return null;
    const token = Symbol(request.name);
    this.locks.set(request.name, { token, until: now + request.lockAtMostFor });
    let released = false;
    return { release: async () => {
      if (released) return;
      released = true;
      if (this.locks.get(request.name)?.token !== token) return;
      const until = now + request.lockAtLeastFor;
      if (until > this.now()) this.locks.set(request.name, { token, until });
      else this.locks.delete(request.name);
    } };
  }
}
