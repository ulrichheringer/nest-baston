import { describe, it, expect, vi } from 'vitest';
import { LockExecutor } from './lock-executor';
import { MemoryLockProvider } from '../providers/memory-provider';
describe('lock lifecycle', () => {
  it('skips concurrent tasks and releases after completion', async () => {
    const executor = new LockExecutor(new MemoryLockProvider());
    let finish!: () => void;
    const first = executor.execute({ name: 'job', lockAtMostFor: '1m' }, () => new Promise<void>(resolve => { finish = resolve; }));
    await Promise.resolve();
    expect(await executor.execute({ name: 'job', lockAtMostFor: '1m' }, () => 2)).toEqual({ executed: false });
    finish(); await first;
    expect(await executor.execute({ name: 'job', lockAtMostFor: '1m' }, () => 3)).toEqual({ executed: true, value: 3 });
  });
  it('enforces minimum duration and protects a replacement lock', async () => {
    let now = 100;
    const provider = new MemoryLockProvider(() => now);
    const request = { name: 'job', lockAtMostFor: 100, lockAtLeastFor: 50 };
    const first = (await provider.acquire(request))!;
    await first.release(); now = 149;
    expect(await provider.acquire(request)).toBeNull(); now = 150;
    const second = (await provider.acquire(request))!; now = 250;
    const third = (await provider.acquire(request))!;
    await second.release(); expect(await provider.acquire(request)).toBeNull();
    await third.release(); now = 300; expect(await provider.acquire(request)).not.toBeNull();
  });
  it('releases on error and preserves both errors when release also fails', async () => {
    const executor = new LockExecutor(new MemoryLockProvider());
    await expect(executor.execute({ name: 'job', lockAtMostFor: 1000 }, () => { throw new Error('task'); })).rejects.toThrow('task');
    expect((await executor.execute({ name: 'job', lockAtMostFor: 1000 }, () => 1)).executed).toBe(true);
    const broken = new LockExecutor({ acquire: async () => ({ release: async () => { throw new Error('release'); } }) });
    await expect(broken.execute({ name: 'job', lockAtMostFor: 1000 }, () => { throw new Error('task'); })).rejects.toBeInstanceOf(AggregateError);
  });
  it('renews throughout a long task and stops renewal after completion', async () => {
    vi.useFakeTimers();
    try {
      const provider = new MemoryLockProvider();
      const executor = new LockExecutor(provider);
      let finish!: () => void;
      const first = executor.execute({ name: 'long', lockAtMostFor: 90, renewWhileRunning: true },
        () => new Promise<void>(resolve => { finish = resolve; }));
      await vi.advanceTimersByTimeAsync(280);
      expect(await provider.acquire({ name: 'long', lockAtMostFor: 90, lockAtLeastFor: 0 })).toBeNull();
      finish();
      await first;
      expect(await executor.execute({ name: 'long', lockAtMostFor: 90 }, () => 'next'))
        .toEqual({ executed: true, value: 'next' });
    } finally { vi.useRealTimers(); }
  });
  it('never renews an expired or replaced owner', async () => {
    let now = 0;
    const provider = new MemoryLockProvider(() => now);
    const request = { name: 'job', lockAtMostFor: 90, lockAtLeastFor: 0 };
    const old = (await provider.acquire(request))!;
    now = 90;
    expect(await old.renew!(90)).toBe(false);
    const replacement = (await provider.acquire(request))!;
    expect(await old.renew!(90)).toBe(false);
    await old.release();
    now = 179;
    expect(await provider.acquire(request)).toBeNull();
    expect(await replacement.renew!(90)).toBe(true);
    await replacement.release();
    expect(await replacement.renew!(90)).toBe(false);
  });
  it('reports loss of ownership after the task completes', async () => {
    vi.useFakeTimers();
    try {
      const executor = new LockExecutor(new MemoryLockProvider());
      let finish!: () => void;
      const first = executor.execute({ name: 'job', lockAtMostFor: 90, renewWhileRunning: true },
        () => new Promise<void>(resolve => { finish = resolve; }));
      const outcome = expect(first).rejects.toThrow('Lock renewal lost ownership: job');
      await Promise.resolve();
      vi.setSystemTime(Date.now() + 91);
      await vi.advanceTimersByTimeAsync(30);
      finish();
      await outcome;
    } finally { vi.useRealTimers(); }
  });
  it('rejects renewal on providers without support before running the task', async () => {
    let ran = false;
    let released = false;
    const executor = new LockExecutor({ acquire: async () => ({ release: async () => { released = true; } }) });
    await expect(executor.execute({ name: 'job', lockAtMostFor: 90, renewWhileRunning: true },
      () => { ran = true; })).rejects.toThrow('Lock provider does not support renewal');
    expect(ran).toBe(false);
    expect(released).toBe(true);
  });
  it('preserves task, renewal and release errors together', async () => {
    vi.useFakeTimers();
    try {
      const executor = new LockExecutor({ acquire: async () => ({
        renew: async () => { throw new Error('renew'); },
        release: async () => { throw new Error('release'); },
      }) });
      let fail!: () => void;
      const result = executor.execute({ name: 'job', lockAtMostFor: 90, renewWhileRunning: true },
        () => new Promise<void>((_resolve, reject) => { fail = () => reject(new Error('task')); }))
        .catch(error => error);
      await vi.advanceTimersByTimeAsync(30);
      fail();
      const error = await result;
      expect(error).toBeInstanceOf(AggregateError);
      expect(error.errors.map((cause: Error) => cause.message)).toEqual(['task', 'renew', 'release']);
    } finally { vi.useRealTimers(); }
  });
});
