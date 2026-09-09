// 저장소 어댑터. 운영은 Postgres 다 (Hyperdrive 바인딩 또는 DATABASE_URL). D1 은 테스트(workerd 안의 miniflare)와
// Postgres 설정이 없는 로컬에서만 쓴다. 쿼리는 두 엔진이 함께 읽는 부분집합으로만 쓴다:
//   자리표시자 ? 또는 ?N · INSERT ... ON CONFLICT DO NOTHING / DO UPDATE SET x = excluded.x · substr · COALESCE · 윈도 함수.
//   엔진별 문법(INSERT OR IGNORE, strftime, RETURNING 의존)은 쓰지 않는다. 같은 migrations/*.sql 이 두 엔진에 들어간다.
//
// Workers 에서는 한 요청에서 연 소켓을 다른 요청에서 쓸 수 없다. 그래서 pg Client 는 요청(또는 크론 실행)마다 열고 닫는다 —
// withDb 가 그 범위이고, 안에서 dbOf(env) 는 같은 연결을 돌려준다.
import { AsyncLocalStorage } from 'node:async_hooks'
import type pg from 'pg'

export interface Stmt { sql: string; params: unknown[] }
export interface Db {
  all<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>
  first<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T | null>
  run(sql: string, params?: unknown[]): Promise<void>
  /** 한 트랜잭션(D1 은 batch). 전부 되거나 전부 안 된다. */
  batch(stmts: Stmt[]): Promise<void>
  close(): Promise<void>
}
export const stmt = (sql: string, ...params: unknown[]): Stmt => ({ sql, params })

/** 어댑터를 고르는 데 필요한 바인딩만 받는다 (Env 를 import 하면 db.ts 와 순환이 된다). */
export interface DbEnv { DB?: D1Database; HYPERDRIVE?: Hyperdrive; DATABASE_URL?: string; DATABASE_CA?: string }

/** ? 와 ?N 을 $N 으로. 문자열 리터럴 안에 ? 를 쓰는 쿼리는 없다. */
export function toPg(sql: string): string {
  let n = 0
  return sql.replace(/\?(\d+)?/g, (_, d: string | undefined) => (d ? `$${d}` : `$${++n}`))
}

// pg 는 Postgres 를 실제로 쓸 때만 불러온다. D1 로 도는 테스트 번들에 Workers 전용 소켓 구현(pg-cloudflare)이 섞이지 않게 한다.
let driver: Promise<typeof pg> | null = null
const loadPg = () => (driver ??= import('pg').then((m) => {
  // COUNT·SUM 은 int8 이라 pg 가 문자열로 준다. D1 과 똑같이 숫자로 받는다.
  m.default.types.setTypeParser(20, (v) => Number(v))
  return m.default
}))

/**
 * sslmode 를 libpq 의 뜻으로 푼다. pg 는 require 를 verify-full 처럼 다루는데, Aiven 처럼 자체 CA 로 서명한 서버는 그러면 거절된다.
 *   require/prefer      → 암호화하되 CA 는 검증하지 않는다 (DATABASE_CA 가 있으면 그 CA 로 검증한다)
 *   verify-ca/verify-full → 검증한다 (DATABASE_CA 가 없으면 시스템 루트로)
 *   없음/disable         → 평문. Hyperdrive 가 주는 로컬 주소가 이 경우다.
 */
export function pgConfig(url: string, ca?: string): pg.ClientConfig {
  const u = new URL(url)
  const mode = u.searchParams.get('sslmode') ?? (ca ? 'verify-full' : 'disable')
  u.searchParams.delete('sslmode')
  const ssl = mode === 'disable' ? false
    : ca || mode.startsWith('verify') ? { rejectUnauthorized: true, ca }
    : { rejectUnauthorized: false }
  return { connectionString: u.toString(), ssl }
}

function d1(db: D1Database): Db {
  const prep = (s: string, p: unknown[]) => db.prepare(s).bind(...p)
  return {
    all: async (s, p = []) => (await prep(s, p).all()).results as any[],
    first: async (s, p = []) => ((await prep(s, p).first()) ?? null) as any,
    run: async (s, p = []) => { await prep(s, p).run() },
    batch: async (ss) => { if (ss.length) await db.batch(ss.map((x) => prep(x.sql, x.params))) },
    close: async () => {},
  }
}

/**
 * scoped=true 면 연결 하나를 약속(Promise)으로 공유한다 — 한 요청 안의 Promise.all 이 동시에 열어도 하나만 열린다.
 * scoped=false 면 범위 밖에서 불린 것이라 호출마다 열고 닫는다. 느리지만 연결을 흘리지 않는다.
 */
/** 한 요청이 동시에 여는 연결 수. 화면 하나가 Promise.all 로 던지는 쿼리 수(홈이 5)를 덮는다. */
const LANES = 4

function pgDb(cfg: pg.ClientConfig, scoped: boolean): Db {
  const connect = async () => { const { Client } = await loadPg(); const c = new Client(cfg); await c.connect(); return c }

  // 연결 하나에는 쿼리 하나씩이라(pg 는 겹친 query() 를 9.0 에서 없앤다), 연결이 하나면 Promise.all 이 줄을 선다.
  // 쿼리 왕복이 80~150ms 라 그 줄이 곧 응답 시간이다. 그래서 레인을 여러 개 두고 돌아가며 쓴다 —
  // Hyperdrive 가 원본 연결을 이미 모아 두므로 여기서 더 여는 값은 워커 쪽 소켓뿐이다.
  // 범위 밖(scoped=false)이면 레인을 만들지 않고 호출마다 열고 닫는다. 느리지만 연결을 흘리지 않는다.
  type Lane = { client: Promise<pg.Client> | null; tail: Promise<unknown> }
  const lanes: Lane[] = Array.from({ length: scoped ? LANES : 1 }, () => ({ client: null, tail: Promise.resolve() }))
  let next = 0

  /** 레인 하나를 잡아 그 안에서 순서대로 돌린다. lane 을 주면 그 레인에 고정한다 (트랜잭션). */
  const inLane = <T>(fn: (c: pg.Client) => Promise<T>, lane = lanes[next++ % lanes.length]): Promise<T> => {
    const run = async () => {
      const c = await (scoped ? (lane.client ??= connect()) : connect())
      try { return await fn(c) } finally { if (!scoped) await c.end() }
    }
    const p = lane.tail.then(run, run)
    lane.tail = p.catch(() => {})
    return p
  }

  const q = <T>(s: string, p: unknown[]): Promise<T[]> => inLane(async (c) => (await c.query(toPg(s), p as any[])).rows as T[])
  return {
    all: q,
    first: async (s, p = []) => (await q<any>(s, p))[0] ?? null,
    run: async (s, p = []) => { await q(s, p) },
    // 트랜잭션은 한 연결 안에서 끊기지 않아야 한다. 레인 0 에 고정하면 그 레인의 줄이 순서를 지켜 준다.
    batch: (ss) => ss.length === 0 ? Promise.resolve() : inLane(async (c) => {
      try {
        await c.query('BEGIN')
        for (const x of ss) await c.query(toPg(x.sql), x.params as any[])
        await c.query('COMMIT')
      } catch (e) {
        await c.query('ROLLBACK').catch(() => {})
        throw e
      }
    }, lanes[0]),
    close: async () => {
      await Promise.all(lanes.map(async (l) => {
        await l.tail.catch(() => {})   // 아직 도는 쿼리 위에서 소켓을 닫지 않는다
        const p = l.client
        l.client = null
        const c = p && (await p.catch(() => null))
        if (c) await c.end()
      }))
    },
  }
}

const scope = new AsyncLocalStorage<Db>()

/**
 * 엔진 선택. DATABASE_URL → D1 바인딩 → Hyperdrive 순이다.
 * 운영 wrangler.jsonc 에는 D1 이 없으니 Hyperdrive 가 잡힌다. 테스트는 D1 을 주고, wrangler 가 로컬에서 요구하는
 * Hyperdrive 연결 문자열은 vitest.config.ts 가 더미로 채우므로 D1 이 Hyperdrive 를 이긴다.
 */
export const engineOf = (env: DbEnv) => (env.DATABASE_URL ? 'postgres' : env.DB ? 'd1' : env.HYPERDRIVE?.connectionString ? 'postgres' : 'none')

export function openDb(env: DbEnv, scoped = false): Db {
  if (env.DATABASE_URL) return pgDb(pgConfig(env.DATABASE_URL, env.DATABASE_CA), scoped)
  if (env.DB) return d1(env.DB)
  if (env.HYPERDRIVE?.connectionString) return pgDb(pgConfig(env.HYPERDRIVE.connectionString, env.DATABASE_CA), scoped)
  throw new Error('NO_DATABASE: HYPERDRIVE 바인딩이나 DATABASE_URL 이 필요하다 (테스트는 D1 바인딩 DB 로 돈다)')
}

/** 요청·크론 하나의 범위. 안에서 dbOf(env) 는 같은 연결을 쓰고, 끝나면 닫는다. */
export async function withDb<T>(env: DbEnv, fn: () => Promise<T>): Promise<T> {
  const db = openDb(env, true)
  try { return await scope.run(db, fn) } finally { await db.close() }
}

/** 현재 범위의 연결. 범위 밖(테스트가 db 함수를 직접 부를 때)이면 D1 은 그대로, Postgres 는 호출마다 열고 닫는다. */
export const dbOf = (env: DbEnv): Db => scope.getStore() ?? openDb(env, false)
