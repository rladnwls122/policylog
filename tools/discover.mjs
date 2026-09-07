// 홈페이지에서 약관·처리방침 링크를 찾는다 (§16.1). 워커의 /admin/discover 를 쓴다.
// 사용: node tools/discover.mjs https://a.com https://b.com …
const BASE = process.env.BASE ?? 'http://127.0.0.1:8788'
const AUTH = 'Basic ' + Buffer.from(`admin:${process.env.ADMIN_PASSWORD ?? 'devpassword'}`).toString('base64')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const homes = process.argv.slice(2)
const found = []

for (const [i, home] of homes.entries()) {
  if (i) await sleep(10_000) // §24.3
  const res = await fetch(`${BASE}/admin/discover?url=${encodeURIComponent(home)}`, { headers: { authorization: AUTH } })
  const r = await res.json()
  const host = new URL(home).host
  if (r.robots !== 'ALLOWED') { console.log(`${host.padEnd(28)} ${r.robots}`); continue }
  const links = (r.links ?? []).filter((l) => l.type !== 'UNKNOWN')
  console.log(`${host.padEnd(28)} ${links.length}개`)
  for (const l of links.slice(0, 8)) {
    console.log(`   ${l.type.padEnd(8)} ${l.url}  ${l.text}`)
    found.push({ home, ...l })
  }
}

console.log('\n--- 후보 JSON ---')
console.log(JSON.stringify(found.map((f, i) => ({ id: `${new URL(f.home).host.replace(/^www\./, '').split('.')[0]}-${f.type.toLowerCase()}-${i}`, url: f.url }))))
