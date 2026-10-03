import 'reflect-metadata';
import { Injectable } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Cron, ScheduleModule, SchedulerRegistry } from '@nestjs/schedule';
import { expect, it } from 'vitest';
import { BastonModule, SchedulerLock } from './baston.module';
import { MemoryLockProvider } from '../providers/memory-provider';
@Injectable()
class Jobs {
  calls = 0;
  @Cron('0 0 1 1 *', { name: 'first' })
  @SchedulerLock({ name: 'shared', lockAtLeastFor: '1m' })
  async first() { return ++this.calls; }
  @SchedulerLock({ name: 'shared', lockAtLeastFor: '1m' })
  @Cron('0 0 1 1 *', { name: 'second' })
  async second() { return ++this.calls; }
}
it('wraps scheduled methods with either decorator order and coordinates applications', async () => {
  const provider = new MemoryLockProvider();
  const make = async () => {
    const app = await Test.createTestingModule({ imports: [ScheduleModule.forRoot(), BastonModule.forRoot({ provider, defaultLockAtMostFor: '2m' })], providers: [Jobs] }).compile();
    await app.init(); return app;
  };
  const a = await make(); const b = await make();
  try {
    expect(a.get(SchedulerRegistry).getCronJobs().size).toBe(2);
    await a.get(SchedulerRegistry).getCronJob('first').fireOnTick();
    await b.get(SchedulerRegistry).getCronJob('second').fireOnTick();
    expect(a.get(Jobs).calls).toBe(1); expect(b.get(Jobs).calls).toBe(0);
  } finally { await a.close(); await b.close(); }
});
