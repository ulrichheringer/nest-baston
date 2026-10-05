export type Duration = number | `${number}${'ms' | 's' | 'm' | 'h' | 'd'}`;
export interface LockOptions {
  name: string;
  lockAtMostFor: Duration;
  lockAtLeastFor?: Duration;
  /** Extend the lock while the task is running. Requires a provider with renewal support. */
  renewWhileRunning?: boolean;
}
export interface LockRequest { name: string; lockAtMostFor: number; lockAtLeastFor: number }
export interface LockHandle {
  release(): Promise<void>;
  /** Extend only if this handle still owns an unexpired lock. */
  renew?(lockAtMostFor: number): Promise<boolean>;
}
/** Acquisition must be atomic. Release and renewal must only affect their own ownership token. */
export interface LockProvider { acquire(request: LockRequest): Promise<LockHandle | null> }
export type LockResult<T> = { executed: true; value: T } | { executed: false };
