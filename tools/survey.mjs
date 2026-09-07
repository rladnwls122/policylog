// 후보 서비스를 워커의 /admin/probe 로 실제로 재본다.
// 로컬에서 직접 fetch 하지 않는다 — robots 판정과 politeness 를 워커가 그대로 쓰게 한다.
//
// 사용:
//   node tools/survey.mjs tools/candidates.json     후보 파일을 잰다
//   node tools/survey.mjs --blocker=ROBOTS          카탈로그에서 그 사유로 막힌 문서를 잰다
//   node tools/survey.mjs --blocker=ROBOTS --out=tools/robots.json   결과를 파일로도 남긴다
//   node tools/survey.mjs --blocker=RENDER_REQUIRED --render        Browser Rendering 으로 잰다 (§85)
//
// --blocker=ROBOTS 는 ROBOTS_MODE=ADVISORY 일 때 의미가 있다. ENFORCE 면 probe 가 robots 만 돌려주고 본문을 만지지 않는다.
// --render 는 워커에 browser 바인딩이 있어야 한다 (유료 플랜, 로컬은 `wrangler dev --remote`).
import { readFileSync, writeFileSync } from 'node:fs'

const BASE = process.env.BASE ?? 'http://127.0.0.1:8788'
const AUTH = 'Basic ' + Buffer.from(`admin:${process.env.ADMIN_PASSWORD ?? 'devpassword'}`).toString('base64')
const DOMAIN_GAP_MS = 10_000 // §24.3

const args = process.argv.slice(2)
const flag = (name) => args.find((a) => a.startsWith(`--${name}=`))?.split('=').slice(1).join('=')
const lastHit = new Map()
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const blocker = flag('blocker')
const candidates = blocker
  ? (await (await fetch(`${BASE}/api/v1/services`)).json())
      .filter((d) => d.blockerType === blocker)
      .map((d) => ({ id: d.id, url: d.canonicalUrl, title: d.title }))
  : JSON.parse(readFileSync(args.find((a) => !a.startsWith('--')) ?? 'tools/candidates.json', 'utf-8'))

if (!candidates.length) { console.error(`잴 후보가 없다 (blocker=${blocker ?? '-'})`); process.exit(1) }

async function politely(url, fn) {
  const host = new URL(url).host
  const wait = (lastHit.get(host) ?? 0) + DOMAIN_GAP_MS - Date.now()
  if (wait > 0) await sleep(wait)
  lastHit.set(host, Date.now())
  return fn()
}

const render = args.includes('--render') ? '&render=1' : ''   // §85 Browser Rendering 으로 재본다

const call = async (path) => {
  const res = await fetch(BASE + path, { headers: { authorization: AUTH } })
  return res.json()
}

const rows = []
for (const c of candidates) {
  const r = await politely(c.url, () => call(`/admin/probe?url=${encodeURIComponent(c.url)}${render}`))
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

const out = flag('out')
if (out) { writeFileSync(out, JSON.stringify(rows, null, 1)); console.log(`전체 결과 → ${out}`) }

// 붙여넣을 수 있는 카탈로그 항목을 뽑아준다. 손으로 보고 넣는 절차는 그대로다 (§19).
if (ok.length) {
  console.log('\n--- src/documents.ts 에 붙일 초안 (셀렉터·제목은 눈으로 확인하고 넣는다) ---')
  for (const r of ok) {
    const [, service, type] = r.id.match(/^(.+)-(terms|privacy)$/i) ?? [, r.id, 'terms']
    console.log(`  { id: '${r.id}', service: '${service}', serviceName: '?', type: '${type.toUpperCase()}', title: ${JSON.stringify(r.title ?? '?')},`)
    console.log(`    canonicalUrl: '${r.url}', blocker: '${r.robots === 'ALLOWED' ? 'NONE' : 'ROBOTS'}', extraction: { selector: '${r.best.selector}', ignore: IGNORE },`)
    console.log(`    publicNote: '${r.robots === 'ALLOWED' ? '' : 'robots.txt 는 비허용이지만 공개 문서라 수집합니다'}', checkedAt: CHECKED }, // 조문 ${r.best.sections} · ${r.best.textLength}자 · 시행 ${r.best.effectiveAt ?? '-'}`)
  }
}
process.stdout.write('\n')
