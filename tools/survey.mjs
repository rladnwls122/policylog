// 후보 서비스를 워커의 /admin/probe 로 실제로 재본다.
// 로컬에서 직접 fetch 하지 않는다 — robots 판정과 politeness 를 워커가 그대로 쓰게 한다.
// 사용: node tools/survey.mjs candidates.json
import { readFileSync } from 'node:fs'

const BASE = process.env.BASE ?? 'http://127.0.0.1:8788'
const AUTH = 'Basic ' + Buffer.from(`admin:${process.env.ADMIN_PASSWORD ?? 'devpassword'}`).toString('base64')
const DOMAIN_GAP_MS = 10_000 // §24.3

const candidates = JSON.parse(readFileSync(process.argv[2] ?? 'tools/candidates.json', 'utf-8'))
const lastHit = new Map()
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function politely(url, fn) {
  const host = new URL(url).host
  const wait = (lastHit.get(host) ?? 0) + DOMAIN_GAP_MS - Date.now()
  if (wait > 0) await sleep(wait)
  lastHit.set(host, Date.now())
  return fn()
}

const call = async (path) => {
  const res = await fetch(BASE + path, { headers: { authorization: AUTH } })
  return res.json()
}

const rows = []
for (const c of candidates) {
  const r = await politely(c.url, () => call(`/admin/probe?url=${encodeURIComponent(c.url)}`))
  rows.push({ ...c, ...r })
  const b = r.best
  console.log(
    [
      c.id.padEnd(22),
      (r.robots ?? '-').padEnd(11),
      String(r.status ?? r.error ?? '').slice(0, 22).padEnd(22),
      b ? `${b.selector} len=${b.textLength} 조문=${b.sections} 표=${b.tables} 시행=${b.effectiveAt ?? '-'}` : (r.tried ? `실패: ${[...new Set(r.tried.map((t) => t.gate))].join(',')}` : ''),
      r.historyHint ?? '',
    ].join(' '),
  )
}

const ok = rows.filter((r) => r.best)
console.log(`\n수집 가능 ${ok.length} / ${rows.length}`)
console.log(JSON.stringify(rows, null, 1).slice(0, 200) + '…')
process.stdout.write('\n')
