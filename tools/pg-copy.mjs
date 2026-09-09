#!/usr/bin/env node
// 저장소를 옮긴다. 원본에서 읽어 대상에 넣는다. 대상 스키마는 먼저 `npm run db:migrate` 로 만들어 둔다.
// 이미 있는 행은 건너뛰므로(ON CONFLICT DO NOTHING) 몇 번을 돌려도 결과가 같다.
//
//   SOURCE_URL='postgres://…' DATABASE_URL='postgres://…' node tools/pg-copy.mjs
//   --dry 를 주면 세기만 하고 쓰지 않는다.
//
// sslmode 는 libpq 의 뜻대로 다룬다: require 는 암호화만, verify-full 은 CA 검증까지.
// CockroachDB Cloud 는 공개 CA 로 서명하므로 verify-full 을 쓴다. Aiven 처럼 자체 CA 인 쪽만 require 다.
import pg from 'pg'

const CHUNK = 200                       // 한 문장에 담는 행 수. 파라미터 상한(65535)과 문서 크기를 함께 본다.
// 외래 키 순서다. documents → versions → changes 순으로 넣어야 참조가 걸리지 않는다.
const TABLES = ['documents', 'versions', 'changes', 'document_views', 'users', 'sessions', 'watches', 'login_attempts']

const dry = process.argv.includes('--dry')
const open = async (url, name) => {
  if (!url) { console.error(`${name} 이 필요하다`); process.exit(1) }
  const u = new URL(url)
  const mode = u.searchParams.get('sslmode') ?? 'disable'
  u.searchParams.delete('sslmode')
  const c = new pg.Client({
    connectionString: u.toString(),
    ssl: mode === 'disable' ? false : mode.startsWith('verify') ? { rejectUnauthorized: true } : { rejectUnauthorized: false },
  })
  await c.connect()
  return c
}

const src = await open(process.env.SOURCE_URL, 'SOURCE_URL')
const dst = await open(process.env.DATABASE_URL, 'DATABASE_URL')
try {
  for (const table of TABLES) {
    const { rows } = await src.query(`SELECT * FROM ${table}`)
    const before = (await dst.query(`SELECT COUNT(*) AS n FROM ${table}`)).rows[0].n
    if (!rows.length) { console.log(`${table.padEnd(16)} 원본 0행 — 건너뜀`); continue }
    const cols = Object.keys(rows[0])
    if (!dry) {
      for (let i = 0; i < rows.length; i += CHUNK) {
        const part = rows.slice(i, i + CHUNK)
        const values = part.map((_, r) => `(${cols.map((_, c) => `$${r * cols.length + c + 1}`).join(',')})`).join(',')
        await dst.query(
          `INSERT INTO ${table} (${cols.join(',')}) VALUES ${values} ON CONFLICT DO NOTHING`,
          part.flatMap((row) => cols.map((c) => row[c])))
      }
    }
    const after = (await dst.query(`SELECT COUNT(*) AS n FROM ${table}`)).rows[0].n
    console.log(`${table.padEnd(16)} 원본 ${String(rows.length).padStart(5)}행  대상 ${before} → ${after}`)
  }
} finally {
  await src.end()
  await dst.end()
}
