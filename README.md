# nest-baston

Locks para tarefas agendadas no NestJS, inspirados no [ShedLock](https://github.com/lukas-krecan/ShedLock). Compatível com NestJS 12; Node.js 20+.

## Uso

```bash
npm install nest-baston @nestjs/common @nestjs/core reflect-metadata rxjs
# Para usar Redis:
npm install ioredis
```

O pacote ainda não foi publicado no npm. Para instalar localmente, execute `npm pack` neste projeto e instale o arquivo `.tgz` na aplicação.

```ts
import { Module, Injectable } from '@nestjs/common';
import { Cron, ScheduleModule } from '@nestjs/schedule';
import Redis from 'ioredis';
import { BastonModule, RedisLockProvider, SchedulerLock } from 'nest-baston';

@Injectable()
class Jobs {
  @Cron('*/30 * * * * *')
  @SchedulerLock({ name: 'sync-orders', lockAtMostFor: '2m', lockAtLeastFor: '30s', renewWhileRunning: true })
  async synchronize() {
    // Sincronização de pedidos.
  }
}

@Module({
  imports: [
    ScheduleModule.forRoot(),
    BastonModule.forRoot({
      provider: new RedisLockProvider(new Redis(process.env.REDIS_URL!)),
      defaultLockAtMostFor: '5m',
    }),
  ],
  providers: [Jobs],
})
export class AppModule {}
```

A aplicação é responsável por fechar o cliente Redis no shutdown. `@nestjs/schedule` é instalado pela aplicação. Os decorators funcionam em qualquer ordem e também com `@Interval()` e `@Timeout()`. O método deve pertencer a um provider/controller singleton e sua chamada retorna uma Promise. Providers request-scoped/transient não são suportados. Use nomes estáveis e distintos para tarefas distintas; todas as réplicas precisam usar o mesmo Redis e prefixo (padrão `baston:`).

## Semântica

- Lock ocupado: pula a execução imediatamente, retornando `undefined`, sem fila ou retry.
- `lockAtMostFor`: prazo de expiração, mesmo se o processo morrer. Deve exceder o pior tempo esperado de execução sem renovação. Expirar não cancela o trabalho; se ele continuar, poderá haver sobreposição.
- `renewWhileRunning: true` (opcional): renova o TTL enquanto a tarefa está em execução, a cada ~1/3 de `lockAtMostFor`. Use para tarefas que podem durar mais que o TTL; o padrão é `false`.
- `lockAtLeastFor`: mantém o lock pelo período mínimo contado desde a aquisição, mesmo se o trabalho terminar antes.
- Durações: milissegundos numéricos ou strings `500ms`, `30s`, `5m`, `1h`, `1d`. Não aceita duração ISO 8601.
- Erros da tarefa e do provider são propagados. Se tarefa e liberação falharem, recebe um `AggregateError`.
- Redis usa scripts Lua atômicos, relógio do servidor, TTL e token por aquisição. A liberação antiga não remove o lock de um novo proprietário. Garantias dependem do Redis: failover com perda de dados pode permitir execução simultânea.
- A renovação só estende um lock ainda válido e pertencente à mesma aquisição. Se a renovação falhar ou perder o ownership, o erro é propagado após a tarefa terminar (junto com erros da tarefa/liberação, via `AggregateError`). A tarefa em andamento **não é cancelada**; pausas longas do processo ou falhas do Redis ainda podem permitir sobreposição. Não há garantia de exactly-once.
- `MemoryLockProvider` coordena apenas chamadas que compartilham a mesma instância em um processo; serve para testes e uso local.

## Configuração assíncrona e uso manual

```ts
BastonModule.forRootAsync({
  imports: [RedisModule],
  inject: [RedisService],
  useFactory: (redis: RedisService) => ({
    provider: new RedisLockProvider(redis.client),
    defaultLockAtMostFor: '5m',
  }),
});
```

`RedisModule` e `RedisService` acima representam os serviços da aplicação. Injete `LockExecutor` para executar sem decorator:

```ts
const result = await executor.execute(
  { name: 'report', lockAtMostFor: '1m' },
  () => generateReport(),
);
if (result.executed) console.log(result.value);
```

Implemente `LockProvider` para outro armazenamento. `acquire()` deve adquirir atomicamente ou retornar `null`; `release()` deve conferir ownership e preservar o prazo mínimo. Para suportar `renewWhileRunning`, o `LockHandle` também deve implementar `renew(lockAtMostFor)`: estender o TTL atomicamente apenas se o lock ainda estiver válido e pertencer à aquisição, retornando `false` se não pertencer mais. Sem esse método, a opção falha antes de executar a tarefa. `RedisLockClient` segue a assinatura `eval` do ioredis; node-redis exige um adapter para essa assinatura.

## Desenvolvimento

```bash
npm ci
npm test
npm run build
npm pack --dry-run
```

Testes cobrem exclusão concorrente, prazo mínimo, expiração, ownership, renovação e duas aplicações NestJS com cron e decorator em ambas as ordens. O provider Redis precisa de validação adicional contra um servidor Redis real antes de uso em produção.
