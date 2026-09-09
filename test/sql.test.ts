import { env } from 'cloudflare:test'
import { describe, it, expect } from 'vitest'
import { toPg, pgConfig, openDb, engineOf, stmt, withDb, dbOf } from '../src/sql'
import { syncDocuments, recordView, weeklyViews, type Env } from '../src/db'
import { TEST_DOCS } from './fixtures/catalog'

const E = env as unknown as Env

describe('저장소 어댑터 (src/sql.ts)', () => {
  it('? 와 ?N 을 $N 으로 옮긴다', () => {
    expect(toPg('SELECT ? , ?')).toBe('SELECT $1 , $2')
    expect(toPg('VALUES (?1, ?2) ON CONFLICT DO UPDATE SET n = ?2')).toBe('VALUES ($1, $2) ON CONFLICT DO UPDATE SET n = $2')
    expect(toPg('SELECT 1')).toBe('SELECT 1')
  })
  it('sslmode 를 libpq 의 뜻으로 푼다 — require 는 암호화만, CA 가 있으면 검증', () => {
    expect(pgConfig('postgres://u:p@h:1/d?sslmode=require').ssl).toEqual({ rejectUnauthorized: false })
    expect(pgConfig('postgres://u:p@h:1/d?sslmode=require', 'CA').ssl).toEqual({ rejectUnauthorized: true, ca: 'CA' })
    expect(pgConfig('postgres://u:p@h:1/d?sslmode=verify-full').ssl).toEqual({ rejectUnauthorized: true, ca: undefined })
    expect(pgConfig('postgres://u:p@h:1/d?sslmode=disable').ssl).toBe(false)
    expect(pgConfig('postgres://u:p@h:1/d').ssl).toBe(false)
    expect(pgConfig('postgres://u:p@h:1/d?sslmode=require').connectionString).not.toContain('sslmode')
  })
  it('엔진 우선순위: DATABASE_URL → D1 → Hyperdrive', () => {
    const hd = { connectionString: 'postgres://x' } as unknown as Hyperdrive
    expect(engineOf({ DATABASE_URL: 'postgres://x' })).toBe('postgres')
    expect(engineOf({ DB: E.DB, HYPERDRIVE: hd })).toBe('d1')
    expect(engineOf({ HYPERDRIVE: hd })).toBe('postgres')
    expect(engineOf({})).toBe('none')
    expect(() => openDb({})).toThrow('NO_DATABASE')
  })
  it('테스트는 D1 로 돈다', () => expect(engineOf(E)).toBe('d1'))
  it('배치는 전부 되거나 전부 안 된다', async () => {
    const db = openDb(E)
    await db.run('CREATE TABLE IF NOT EXISTS t_batch (k TEXT PRIMARY KEY)')
    await expect(db.batch([stmt('INSERT INTO t_batch (k) VALUES (?)', 'a'), stmt('INSERT INTO t_batch (k) VALUES (?)', 'a')])).rejects.toThrow()
    expect(await db.all('SELECT * FROM t_batch')).toHaveLength(0)
  })
  it('같은 범위 안에서는 같은 연결을 돌려준다', async () => {
    await withDb(E, async () => { expect(dbOf(E)).toBe(dbOf(E)) })
  })
  it('조회 집계는 (문서, 날짜) 쌍당 정수 하나이고, 두 번 세면 2 다', async () => {
    await syncDocuments(E, TEST_DOCS)
    await recordView(E, 'daangn-privacy')
    await recordView(E, 'daangn-privacy')
    expect((await weeklyViews(E)).get('daangn-privacy')).toBe(2)
  })
})
