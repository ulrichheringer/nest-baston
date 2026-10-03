export type Duration = number | `${number}${'ms' | 's' | 'm' | 'h' | 'd'}`;
export interface LockOptions {
  name: string;
  lockAtMostFor: Duration;
  lockAtLeastFor?: Duration;
}
export interface LockRequest { name: string; lockAtMostFor: number; lockAtLeastFor: number }
export interface LockHandle { release(): Promise<void> }
/** Acquisition must be atomic. Release must only affect its own ownership token. */
export interface LockProvider { acquire(request: LockRequest): Promise<LockHandle | null> }
export type LockResult<T> = { executed: true; value: T } | { executed: false };
