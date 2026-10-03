import { randomUUID } from 'node:crypto';
import { LockHandle, LockProvider, LockRequest } from '../core/types';
/** Adapter signature compatible with ioredis; node-redis can use a small eval adapter. */
export interface RedisLockClient { eval(script: string, numberOfKeys: number, ...args: (string | number)[]): Promise<unknown> }
const ACQUIRE = `
if redis.call('EXISTS', KEYS[1]) == 1 then return 0 end
local t = redis.call('TIME')
local now = t[1] * 1000 + math.floor(t[2] / 1000)
redis.call('HSET', KEYS[1], 'token', ARGV[1], 'leastUntil', now + tonumber(ARGV[3]))
redis.call('PEXPIRE', KEYS[1], ARGV[2])
return 1`;
const RELEASE = `
if redis.call('HGET', KEYS[1], 'token') ~= ARGV[1] then return 0 end
local t = redis.call('TIME')
local now = t[1] * 1000 + math.floor(t[2] / 1000)
local remaining = tonumber(redis.call('HGET', KEYS[1], 'leastUntil')) - now
if remaining > 0 then redis.call('PEXPIRE', KEYS[1], remaining)
else redis.call('DEL', KEYS[1]) end
return 1`;
export class RedisLockProvider implements LockProvider {
  constructor(private readonly client: RedisLockClient, private readonly prefix = 'baston:') {}
  async acquire(request: LockRequest): Promise<LockHandle | null> {
    const token = randomUUID();
    const key = this.prefix + request.name;
    if (Number(await this.client.eval(ACQUIRE, 1, key, token, request.lockAtMostFor, request.lockAtLeastFor)) !== 1) return null;
    let released = false;
    return { release: async () => {
      if (released) return;
      await this.client.eval(RELEASE, 1, key, token);
      released = true;
    } };
  }
}
