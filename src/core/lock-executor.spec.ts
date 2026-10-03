import { describe, it, expect } from 'vitest';
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
});
