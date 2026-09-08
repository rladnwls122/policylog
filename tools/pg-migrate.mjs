#!/usr/bin/env node
// migrations/*.sql 을 이름순으로 Postgres 에 적용한다. 적용한 파일은 schema_migrations 에 남겨 두 번 돌려도 같은 결과다.
// 같은 파일이 테스트의 D1(SQLite) 에도 그대로 들어간다 — 두 엔진이 함께 읽는 문법만 쓴다.
//
//   DATABASE_URL='postgres://user:pass@host:port/db?sslmode=require' npm run db:migrate
//   DATABASE_CA=/path/to/ca.pem 을 함께 주면 그 CA 로 서버를 검증한다. 없으면 암호화만 하고 검증하지 않는다 (libpq 의 require 와 같다).
import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import pg from 'pg'

const url = process.env.DATABASE_URL
if (!url) { console.error('DATABASE_URL 이 필요하다'); process.exit(1) }
const ca = process.env.DATABASE_CA ? await readFile(process.env.DATABASE_CA, 'utf8') : undefined
const u = new URL(url)
const mode = u.searchParams.get('sslmode') ?? (ca ? 'verify-full' : 'disable')
u.searchParams.delete('sslmode')
const ssl = mode === 'disable' ? false : ca || mode.startsWith('verify') ? { rejectUnauthorized: true, ca } : { rejectUnauthorized: false }

const client = new pg.Client({ connectionString: u.toString(), ssl })
await client.connect()
try {
  await client.query('CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL)')
  const done = new Set((await client.query('SELECT name FROM schema_migrations')).rows.map((r) => r.name))
  const dir = path.join(path.dirname(new URL(import.meta.url).pathname), '..', 'migrations')
  const files = (await readdir(dir)).filter((f) => f.endsWith('.sql')).sort()
  for (const f of files) {
    if (done.has(f)) { console.log(`skip   ${f}`); continue }
    const sql = await readFile(path.join(dir, f), 'utf8')
    await client.query('BEGIN')
    try {
      await client.query(sql)
      await client.query('INSERT INTO schema_migrations (name, applied_at) VALUES ($1, $2)', [f, new Date().toISOString()])
      await client.query('COMMIT')
      console.log(`apply  ${f}`)
    } catch (e) { await client.query('ROLLBACK'); throw e }
  }
} finally { await client.end() }
