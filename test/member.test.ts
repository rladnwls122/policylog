// 관심 약관 · 내 페이지 · 개인 RSS · 로그인 시도 제한 · 변경 거르기 · 이웃 변경 · robots/sitemap/og. 실제 워커에서 실제 D1 로 확인한다.
import { env, SELF } from 'cloudflare:test'
import { describe, it, expect, beforeAll } from 'vitest'
import { syncDocuments, insertVersion, findUserByEmail, listChangesForDocument, notifyRecipients, updateDocument, type Env } from '../src/db'
import { LOGOS } from '../src/documents'
import { ago, daysUntil } from '../src/views'
import { rebuildChanges } from '../src/acquire'
import { ATTEMPT_LIMIT, TOO_MANY } from '../src/auth'

const E = env as unknown as Env
const BASE = 'https://policylog.test'
const get = (path: string, init?: RequestInit) => SELF.fetch(BASE + path, init)
const form = (path: string, data: Record<string, string>, cookie?: string, referer?: string) =>
  get(path, { method: 'POST', redirect: 'manual', body: new URLSearchParams(data),
    headers: { 'content-type': 'application/x-www-form-urlencoded', origin: BASE, ...(cookie ? { cookie } : {}), ...(referer ? { referer } : {}) } })
const sessionOf = (res: Response) => { const m = res.headers.get('set-cookie')?.match(/pl_session=([^;]+)/); return m ? `pl_session=${m[1]}` : null }
const login = async (email: string, password = 'correct-horse') => sessionOf(await form('/login', { email, password }))!
const DOC = 'daangn-privacy'
const v = (id: string, text: string, eff: string, obs: string) => ({
  id, document_id: DOC, observed_at: obs, effective_at: eff, announced_at: null, earliest_possible_change_at: null, lifecycle: 'CURRENT',
  source_url: `https://privacy-policy.daangn.com/previous_pp/${eff.replace(/-/g, '')}/`, provenance: 'OFFICIAL_HISTORY', acquisition_tier: 'T3', fetch_mode: 'STATIC',
  raw_object_key: `raw/${DOC}/${id}.html`, normalized_text: text, content_hash: 'h-' + id, normalization_profile_id: 'v1', parser_version: '0.1.0',
  extraction_method: 'html:main', metadata: JSON.stringify({ tables: [] }), created_at: obs,
})
const T1 = '제1조 (목적)\n이 방침은 당근이 이용자의 개인정보를 어떻게 다루는지 정합니다.\n\n제3조 (국외 이전)\n개인정보를 국외로 이전하지 않습니다.'
const T2 = '제1조 (목적)\n이 방침은 당근이 이용자의 개인정보를 어떻게 다루는지 정합니다.\n\n제3조 (국외 이전)\n개인정보를 미국의 AWS 로 이전하며 AI 학습에 활용할 수 있습니다.'
const T3 = T2 + '\n\n제4조 (환불)\n결제 후 7일 이내에는 전액 환불됩니다.'
let changes: { id: string; effective_at: string | null }[] = []

beforeAll(async () => {
  await syncDocuments(E)
  await insertVersion(E, v('m1', T1, '2026-03-27', '2026-03-27T00:00:00Z'))
  await insertVersion(E, v('m2', T2, '2026-07-07', '2026-07-07T00:00:00Z'))
  await insertVersion(E, v('m3', T3, '2026-08-20', '2026-08-20T00:00:00Z'))
  await rebuildChanges(E, DOC, 'BACKFILL')
  changes = await listChangesForDocument(E, DOC)   // 최신순 2건
  await form('/join', { email: 'kim@example.com', password: 'correct-horse', name: '김우진' })
})

describe('관심 약관', () => {
  it('비회원이 별을 누르면 로그인으로 보내고, 돌아올 곳을 기억한다', async () => {
    const res = await form(`/watch/${DOC}`, { on: '1' }, undefined, `${BASE}/policies/${DOC}`)
    expect(res.status).toBe(302)
    expect(res.headers.get('location')).toBe(`/login?next=${encodeURIComponent(`/policies/${DOC}`)}`)
  })
  it('회원이 담으면 홈 상단·내 페이지·문서 화면에 보이고, 빼면 사라진다', async () => {
    const cookie = await login('kim@example.com')
    const on = await form(`/watch/${DOC}`, { on: '1' }, cookie, `${BASE}/`)
    expect(on.status).toBe(302)
    expect(on.headers.get('location')).toBe('/')
    const home = await (await get('/', { headers: { cookie } })).text()
    expect(home).toContain('id="mine"')
    expect(home.slice(home.indexOf('id="mine"'), home.indexOf('id="featured"'))).toContain(`/policies/${DOC}`)
    expect(await (await get('/me', { headers: { cookie } })).text()).toContain('관심 약관 1건')
    expect(await (await get(`/policies/${DOC}`, { headers: { cookie } })).text()).toContain('aria-pressed="true"')
    expect(await (await get(`/policies/${DOC}`)).text()).toContain('aria-pressed="false"')
    const off = await form(`/watch/${DOC}`, { on: '0' }, cookie)
    expect(off.headers.get('location')).toBe(`/policies/${DOC}`)   // Referer 가 없으면 문서로
    expect(await (await get('/', { headers: { cookie } })).text()).not.toContain('id="mine"')
    expect(await (await get('/me', { headers: { cookie } })).text()).toContain('관심 약관 0건')
  })
  it('없는 문서는 담을 수 없다', async () => {
    const cookie = await login('kim@example.com')
    expect((await form('/watch/nope', { on: '1' }, cookie)).status).toBe(404)
  })
  it('/me 는 회원만 본다', async () => {
    const res = await get('/me', { redirect: 'manual' })
    expect(res.status).toBe(302)
    expect(res.headers.get('location')).toContain('/login?next=')
  })
})

describe('설정', () => {
  it('수집 상태 자세히는 쿠키다. 켜면 html 에 data-detail 이 붙고 robots 문구가 카드에 그려진다', async () => {
    const res = await form('/settings', { detail: '1', next: '/' })
    expect(res.status).toBe(302)
    expect(res.headers.get('set-cookie')).toContain('pl_detail=1')
    expect(await (await get('/', { headers: { cookie: 'pl_detail=1' } })).text()).toContain('<html lang="ko" data-detail="">')
    expect(await (await get('/')).text()).not.toContain('<html lang="ko" data-detail')
    const off = await form('/settings', { detail: '0', next: '/' }, 'pl_detail=1')
    expect(off.headers.get('set-cookie')).toMatch(/pl_detail=;|max-age=0/i)
  })
  it('알림은 회원 행에 남고, 관심 약관을 둔 회원만 수신자다. 비회원은 로그인으로 보낸다', async () => {
    const cookie = await login('kim@example.com')
    await form(`/watch/${DOC}`, { on: '1' }, cookie, `${BASE}/`)
    expect(await notifyRecipients(E, DOC)).toEqual([])
    await form('/settings', { notify: '1', next: '/' }, cookie)
    expect((await findUserByEmail(E, 'kim@example.com'))?.notify).toBe(1)
    expect(await notifyRecipients(E, DOC)).toEqual(['kim@example.com'])
    expect(await notifyRecipients(E, 'toss-terms')).toEqual([])
    expect(await (await get('/', { headers: { cookie } })).text()).toContain('name="notify" value="0"')
    await form('/settings', { notify: '0', next: '/' }, cookie)
    expect(await notifyRecipients(E, DOC)).toEqual([])
    expect(await (await get('/')).text()).toContain('href="/login?next=%2F"')
  })
  it('카드에 로고와 마지막 확인 시각이 찍힌다', async () => {
    await updateDocument(E, DOC, { last_success_at: new Date(Date.now() - 3 * 3600_000).toISOString() })
    const home = await (await get('/')).text()
    expect(home).toContain(`<img class="logo" src="${LOGOS.daangn}"`)
    expect(home).toContain('3시간 전 확인')
    expect(ago(new Date(Date.now() - 30_000).toISOString())).toBe('방금')
    expect(ago(new Date(Date.now() - 5 * 86_400_000).toISOString())).toBe('5일 전')
  })
})

describe('개인 RSS', () => {
  it('키로 열리고, 관심 약관의 변경을 싣고, 키를 바꾸면 옛 주소는 죽는다', async () => {
    const cookie = await login('kim@example.com')
    await form(`/watch/${DOC}`, { on: '1' }, cookie)
    const me = await (await get('/me', { headers: { cookie } })).text()
    const key = me.match(/me\/feed\.xml\?key=([A-Za-z0-9_-]+)/)![1]
    const feed = await get(`/me/feed.xml?key=${key}`)
    expect(feed.status).toBe(200)
    expect(feed.headers.get('content-type')).toContain('application/rss+xml')
    const xml = await feed.text()
    expect(xml).toContain('<item>')
    expect(xml).toContain('당근 개인정보 처리방침 변경')
    expect((await get('/me/feed.xml?key=wrong-wrong-wrong-wrong')).status).toBe(404)
    expect((await get('/me/feed.xml')).status).toBe(404)
    const rot = await form('/me/feed/rotate', {}, cookie)
    expect(rot.headers.get('location')).toBe('/me?saved=feed')
    expect((await get(`/me/feed.xml?key=${key}`)).status).toBe(404)
    const me2 = await (await get('/me', { headers: { cookie } })).text()
    const key2 = me2.match(/me\/feed\.xml\?key=([A-Za-z0-9_-]+)/)![1]
    expect(key2).not.toBe(key)
    expect((await get(`/me/feed.xml?key=${key2}`)).status).toBe(200)
  })
})

describe('계정', () => {
  it('이름을 바꾸고, 모든 기기에서 로그아웃하고, 탈퇴한다', async () => {
    await form('/join', { email: 'lee@example.com', password: 'correct-horse', name: '이서준' })
    const a = await login('lee@example.com')
    const b = await login('lee@example.com')
    const renamed = await form('/me/name', { name: '이도윤' }, a)
    expect(renamed.headers.get('location')).toBe('/me?saved=name')
    expect(await (await get('/', { headers: { cookie: a } })).text()).toContain('이도윤')
    const out = await form('/me/logout-all', {}, a)
    expect(out.headers.get('location')).toBe('/login')
    for (const cookie of [a, b]) expect(await (await get('/', { headers: { cookie } })).text()).not.toContain('로그아웃')
    const c = await login('lee@example.com')
    expect((await form('/me/delete', {}, c)).headers.get('location')).toBe('/me?saved=confirm')
    expect((await findUserByEmail(E, 'lee@example.com'))).toBeTruthy()
    const gone = await form('/me/delete', { confirm: '1' }, c)
    expect(gone.headers.get('location')).toBe('/')
    expect(await findUserByEmail(E, 'lee@example.com')).toBeNull()
    expect(await (await form('/login', { email: 'lee@example.com', password: 'correct-horse' })).text()).toContain('맞지 않습니다')
  })
  it(`비밀번호를 ${ATTEMPT_LIMIT}번 틀리면 맞는 비밀번호로도 15분 동안 막힌다`, async () => {
    await form('/join', { email: 'rl@example.com', password: 'correct-horse' })
    for (let i = 0; i < ATTEMPT_LIMIT; i++) expect(await (await form('/login', { email: 'rl@example.com', password: 'wrong-' + i })).text()).toContain('맞지 않습니다')
    const blocked = await form('/login', { email: 'rl@example.com', password: 'correct-horse' })
    expect(blocked.status).toBe(200)
    expect(await blocked.text()).toContain(TOO_MANY)
    expect(sessionOf(blocked)).toBeNull()
    // 창이 지나면 풀린다 — 시간을 돌리는 대신 창 시작을 과거로 옮긴다.
    await E.DB!.prepare("UPDATE login_attempts SET window_start = '2000-01-01T00:00:00Z'").run()
    expect(sessionOf(await form('/login', { email: 'rl@example.com', password: 'correct-horse' }))).toBeTruthy()
    // 성공하면 기록이 지워진다
    const left = await E.DB!.prepare("SELECT COUNT(*) AS n FROM login_attempts WHERE key = 'email:rl@example.com'").first<{ n: number }>()
    expect(left?.n).toBe(0)
  })
})

describe('변경 탐색', () => {
  it('주제와 중요도로 거른다. 모르는 값은 무시한다', async () => {
    // 두 변경 모두 국외 이전 조문을 건드렸고, AI 학습 이용은 첫 변경(오래된 쪽)에만 있다.
    const overseas = await (await get('/changes?cat=OVERSEAS_TRANSFER')).text()
    expect(overseas).toContain('국외 이전 변경 2건')
    const ai = await (await get('/changes?cat=AI_DATA_USAGE')).text()
    expect(ai).toContain('AI·데이터 활용 변경 1건')
    expect(ai).toContain(`/changes/${changes[1].id}`)
    expect(ai).not.toContain(`/changes/${changes[0].id}`)
    expect(await (await get('/changes?cat=DISPUTE_RESOLUTION')).text()).toContain('이 조건에 맞는 변경이 아직 없습니다')
    expect(await (await get('/changes?imp=hi')).text()).toContain(`/changes/${changes[1].id}`)
    expect(await (await get('/changes?cat=NOPE&imp=zzz')).text()).toContain('기록된 변경 2건')
  })
  it('변경 화면에서 같은 문서의 이전·다음 변경으로 간다', async () => {
    const newest = await (await get(`/changes/${changes[0].id}`)).text()
    expect(newest).toContain(`href="/changes/${changes[1].id}" rel="prev"`)
    expect(newest).not.toContain('rel="next"')
    const oldest = await (await get(`/changes/${changes[1].id}`)).text()
    expect(oldest).toContain(`href="/changes/${changes[0].id}" rel="next"`)
    expect(oldest).not.toContain('rel="prev"')
  })
  it('문서 화면은 버전을 타임라인으로 보이고 변경으로 잇는다', async () => {
    const html = await (await get(`/policies/${DOC}`)).text()
    expect(html).toContain('class="timeline"')
    expect((html.match(/class="dot"/g) ?? []).length).toBe(3)
    expect(html).toContain(`/changes/${changes[0].id}`)
    expect(html).toContain('최초 보존본')
  })
})

describe('검색 엔진', () => {
  it('robots.txt 와 sitemap.xml 이 있고, 회원 화면은 색인하지 않는다', async () => {
    const robots = await (await get('/robots.txt')).text()
    expect(robots).toContain('Disallow: /me')
    expect(robots).toContain('Sitemap: ')
    const map = await (await get('/sitemap.xml')).text()
    expect(map).toContain(`/policies/${DOC}</loc>`)
    expect(map).toContain(`/changes/${changes[0].id}</loc>`)
    expect(map).not.toContain('/me</loc>')
    expect(map).not.toContain('/me/')
    expect(await (await get('/search?q=a')).text()).toContain('name="robots" content="noindex"')
    expect(await (await get('/')).text()).not.toContain('name="robots" content="noindex"')
  })
  it('공유 카드 메타와 canonical 이 붙는다', async () => {
    const html = await (await get(`/policies/${DOC}?utm=x`)).text()
    expect(html).toContain('property="og:title"')
    expect(html).toContain(`<link rel="canonical" href="https://policylog.example/policies/${DOC}"`)
    expect(html).toContain('보존한 버전 3개와 변경 2건')
  })
  it('API 와 피드는 캐시 헤더를 단다', async () => {
    expect((await get('/api/v1/services')).headers.get('cache-control')).toContain('max-age=300')
    expect((await get(`/policies/${DOC}/feed.xml`)).headers.get('cache-control')).toContain('public')
  })
})

// 맨 뒤: 앞의 변경 수를 세는 테스트가 있어, 시행 전 버전은 마지막에 넣는다.
describe('시행 전 변경', () => {
  it('시행 전인 변경은 D-n 인장, 정렬 칩과 정렬 속성이 있다', async () => {
    const at = Date.parse('2026-09-08T00:00:00Z')
    expect(daysUntil('2026-09-15', at)).toBe(7)
    expect(daysUntil('2026-09-08', at)).toBe(0)
    expect(daysUntil('2026-09-01', at)).toBe(-7)
    expect(daysUntil('2026-09-09', Date.parse('2026-09-08T14:59:00Z'))).toBe(1)   // 한국은 아직 8일 밤
    expect(daysUntil('2026-09-09', Date.parse('2026-09-08T15:01:00Z'))).toBe(0)   // 한국은 9일 0시
    const soon = new Date(Date.now() + 9 * 3600_000 + 7 * 86_400_000).toISOString().slice(0, 10)
    await insertVersion(E, v('m4', T3 + '\n\n제5조 (보안)\n비밀번호는 암호화합니다.', soon, new Date().toISOString()))
    await rebuildChanges(E, DOC, null)
    const home = await (await get('/')).text()
    expect(home).toContain('<span class="seal soon"><em>D-7 시행</em>')
    expect(home).toContain('data-sort="imp"')
    expect(home).toMatch(/data-d="[^"]*" data-imp="-?\d+" data-n="[^"]+"/)
  })
})
