import 'reflect-metadata';
import { DynamicModule, ModuleMetadata, Inject, Injectable, Module, OnModuleInit } from '@nestjs/common';
import { DiscoveryModule, DiscoveryService, MetadataScanner } from '@nestjs/core';
import { normalizeLock } from '../core/duration';
import { LockExecutor } from '../core/lock-executor';
import { LockOptions, LockProvider } from '../core/types';
export const BASTON_OPTIONS = Symbol('BASTON_OPTIONS');
const LOCK_METADATA = Symbol('BASTON_LOCK');
const contexts = new WeakMap<object, { executor: LockExecutor; options: BastonOptions }>();
export interface BastonOptions { provider: LockProvider; defaultLockAtMostFor?: LockOptions['lockAtMostFor'] }
export type SchedulerLockOptions = Omit<LockOptions, 'lockAtMostFor'> & { lockAtMostFor?: LockOptions['lockAtMostFor'] };
export function SchedulerLock(options: SchedulerLockOptions): MethodDecorator {
  return (_target, _key, descriptor: PropertyDescriptor) => {
    const original = descriptor.value;
    const wrapped = async function(this: object, ...args: unknown[]) {
      const context = contexts.get(this);
      if (!context) throw new Error('SchedulerLock requires BastonModule and a singleton provider');
      const lockAtMostFor = options.lockAtMostFor ?? context.options.defaultLockAtMostFor;
      if (lockAtMostFor === undefined) throw new Error(`Missing lockAtMostFor for ${options.name}`);
      const result = await context.executor.execute({ ...options, lockAtMostFor }, () => original.apply(this, args));
      return result.executed ? result.value : undefined;
    };
    for (const key of Reflect.getMetadataKeys(original)) Reflect.defineMetadata(key, Reflect.getMetadata(key, original), wrapped);
    Reflect.defineMetadata(LOCK_METADATA, { ...options }, wrapped);
    descriptor.value = wrapped;
  };
}
@Injectable()
class LockExplorer implements OnModuleInit {
  constructor(@Inject(DiscoveryService) private readonly discovery: DiscoveryService, @Inject(MetadataScanner) private readonly scanner: MetadataScanner,
    @Inject(LockExecutor) private readonly executor: LockExecutor, @Inject(BASTON_OPTIONS) private readonly options: BastonOptions) {}
  onModuleInit(): void {
    for (const wrapper of [...this.discovery.getProviders(), ...this.discovery.getControllers()]) {
      const instance = wrapper.instance;
      if (!instance || !wrapper.isDependencyTreeStatic()) continue;
      for (const name of this.scanner.getAllMethodNames(Object.getPrototypeOf(instance))) {
        const original = instance[name];
        const lock: SchedulerLockOptions | undefined = Reflect.getMetadata(LOCK_METADATA, original);
        if (!lock) continue;
        const lockAtMostFor = lock.lockAtMostFor ?? this.options.defaultLockAtMostFor;
        if (lockAtMostFor === undefined) throw new Error(`Missing lockAtMostFor for ${lock.name}`);
        normalizeLock({ ...lock, lockAtMostFor });
        contexts.set(instance, { executor: this.executor, options: this.options });
      }
    }
  }
}
@Module({})
export class BastonModule {
  static forRoot(options: BastonOptions): DynamicModule {
    return this.forRootAsync({ useFactory: () => options });
  }
  static forRootAsync(options: {
    imports?: ModuleMetadata['imports'];
    inject?: any[];
    useFactory: (...dependencies: any[]) => BastonOptions | Promise<BastonOptions>;
  }): DynamicModule {
    return { module: BastonModule, global: true, imports: [DiscoveryModule, ...(options.imports ?? [])],
      providers: [ { provide: BASTON_OPTIONS, useFactory: options.useFactory, inject: options.inject ?? [] },
        { provide: LockExecutor, useFactory: (config: BastonOptions) => new LockExecutor(config.provider), inject: [BASTON_OPTIONS] }, LockExplorer ],
      exports: [LockExecutor] };
  }
}
