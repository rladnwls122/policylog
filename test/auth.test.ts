// 회원가입·로그인·Google 로그인·카드 제한. 실제 워커에서 실제 D1 로 확인한다. Google 토큰 교환만 fetchMock 으로 막는다.
import { env, SELF } from 'cloudflare:test'
import { describe, it, expect, beforeAll, afterEach } from 'vitest'
import { syncDocuments, findUserByEmail, type Env } from '../src/db'
import { hashPassword, verifyPassword, safeNext, decodeIdToken, googleEnabled } from '../src/auth'
import { PREVIEW_CARDS } from '../src/rank'
import { DOCUMENTS } from '../src/documents'

const E = env as unknown as Env
const BASE = 'https://policylog.test'
const get = (path: string, init?: RequestInit) => SELF.fetch(BASE + path, init)
const form = (path: string, data: Record<string, string>, cookie?: string) =>
  get(path, { method: 'POST', redirect: 'manual', body: new URLSearchParams(data),
    headers: { 'content-type': 'application/x-www-form-urlencoded', origin: BASE, ...(cookie ? { cookie } : {}) } })
const sessionOf = (res: Response) => { const m = res.headers.get('set-cookie')?.match(/pl_session=([^;]+)/); return m ? `pl_session=${m[1]}` : null }
const b64url = (o: unknown) => btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify(o)))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
const idToken = (p: Record<string, unknown>) =>
  `${b64url({ alg: 'RS256', typ: 'JWT' })}.${b64url({ iss: 'https://accounts.google.com', aud: 'test-client', exp: Math.floor(Date.now() / 1000) + 600, email_verified: true, ...p })}.sig`
// 워커와 테스트가 같은 isolate 라 전역 fetch 를 바꿔 끼우면 워커의 Google 토큰 교환이 여기로 온다. 바깥으로는 아무것도 나가지 않는다.
// Response 는 워커의 요청 안(호출 시점)에서 만든다 — 다른 요청에서 만든 스트림은 workerd 가 읽지 못하게 한다.
const realFetch = globalThis.fetch
const google: { pending: { status: number; body: string }[]; calls: { url: string; body: URLSearchParams }[] } = { pending: [], calls: [] }
const googleReplies = (payload: Record<string, unknown>) => google.pending.push({ status: 200, body: JSON.stringify({ id_token: idToken(payload) }) })
const googleFails = () => google.pending.push({ status: 400, body: '{"error":"invalid_grant"}' })
beforeAll(async () => {
  await syncDocuments(E)
  globalThis.fetch = (async (url: RequestInfo | URL, init?: RequestInit) => {
    google.calls.push({ url: String(url), body: new URLSearchParams(String(init?.body)) })
    const next = google.pending.shift()
    if (!next) throw new Error('unexpected outbound fetch: ' + String(url))
    return new Response(next.body, { status: next.status, headers: { 'content-type': 'application/json' } })
  }) as typeof fetch
  return () => { globalThis.fetch = realFetch }
})
afterEach(() => { expect(google.pending, '준비한 Google 응답을 다 썼다').toHaveLength(0) })

describe('이메일 가입·로그인', () => {
  it('가입하면 세션 쿠키를 받고 홈이 회원으로 보인다', async () => {
    const res = await form('/join', { email: 'Kim@Example.com', password: 'correct-horse', name: '김우진', next: '/changes' })
    expect(res.status).toBe(302)
    expect(res.headers.get('location')).toBe('/changes')
    const cookie = sessionOf(res)!
    expect(cookie).toBeTruthy()
    expect(res.headers.get('set-cookie')).toMatch(/HttpOnly/i)
    const html = await (await get('/', { headers: { cookie } })).text()
    expect(html).toContain('김우진')
    expect(html).toContain('로그아웃')
    expect(html).not.toContain('id="splash"')
    expect((await findUserByEmail(E, 'kim@example.com'))?.password_hash).toMatch(/^pbkdf2-sha256\$1000\$/)
  })
  it('같은 이메일로 다시 가입할 수 없고, 짧은 비밀번호와 이상한 이메일은 거절된다', async () => {
    expect(await (await form('/join', { email: 'kim@example.com', password: 'correct-horse' })).text()).toContain('이미 가입된 이메일')
    expect(await (await form('/join', { email: 'new@example.com', password: 'short' })).text()).toContain('8자 이상')
    expect(await (await form('/join', { email: 'not-an-email', password: 'correct-horse' })).text()).toContain('이메일 주소를 확인')
  })
  it('로그인은 맞는 비밀번호에만 세션을 준다', async () => {
    const bad = await form('/login', { email: 'kim@example.com', password: 'wrong-password' })
    expect(bad.status).toBe(200)
    expect(await bad.text()).toContain('맞지 않습니다')
    expect(sessionOf(bad)).toBeNull()
    const ok = await form('/login', { email: 'kim@example.com', password: 'correct-horse', next: '/policies/daangn-privacy' })
    expect(ok.status).toBe(302)
    expect(ok.headers.get('location')).toBe('/policies/daangn-privacy')
    expect(sessionOf(ok)).toBeTruthy()
  })
  it('로그아웃하면 세션이 죽는다', async () => {
    const cookie = sessionOf(await form('/login', { email: 'kim@example.com', password: 'correct-horse' }))!
    const out = await form('/logout', {}, cookie)
    expect(out.status).toBe(302)
    expect(out.headers.get('set-cookie')).toMatch(/pl_session=;|max-age=0/i)
    expect(await (await get('/', { headers: { cookie } })).text()).not.toContain('로그아웃')
  })
  it('회원은 /join 과 /login 에서 홈으로 돌아간다', async () => {
    const cookie = sessionOf(await form('/login', { email: 'kim@example.com', password: 'correct-horse' }))!
    expect((await get('/join', { redirect: 'manual', headers: { cookie } })).status).toBe(302)
    expect((await get('/login', { redirect: 'manual', headers: { cookie } })).status).toBe(302)
  })
  it('다른 출처에서 던진 폼은 거절한다', async () => {
    const res = await get('/login', { method: 'POST', body: new URLSearchParams({ email: 'kim@example.com', password: 'correct-horse' }),
      headers: { 'content-type': 'application/x-www-form-urlencoded', origin: 'https://evil.example' } })
    expect(res.status).toBe(403)
  })
  it('열린 리다이렉트를 막는다', () => {
    expect(safeNext('/changes')).toBe('/changes')
    expect(safeNext('//evil.example')).toBe('/')
    expect(safeNext('https://evil.example')).toBe('/')
    expect(safeNext(undefined)).toBe('/')
  })
  it('비밀번호 해시는 소금이 다르고 검증은 정확하다', async () => {
    const a = await hashPassword('pw', 1000)
    const b = await hashPassword('pw', 1000)
    expect(a).not.toBe(b)
    expect(await verifyPassword('pw', a)).toBe(true)
    expect(await verifyPassword('pw2', a)).toBe(false)
    expect(await verifyPassword('pw', null)).toBe(false)
  })
})

describe('카드 제한', () => {
  const cards = (html: string) => (html.slice(html.indexOf('id="grid"'), html.indexOf('id="empty"')).match(/class="card doc-card/g) ?? []).length
  it(`비회원은 그리드에 ${PREVIEW_CARDS}장과 가입 안내만 본다`, async () => {
    const html = await (await get('/', { headers: { cookie: 'pl_intro=1' } })).text()
    expect(cards(html)).toBe(PREVIEW_CARDS)
    expect(html).toContain('건이 더 있습니다')
    expect(html).toContain('href="/join"')
  })
  it('회원은 전체를 본다', async () => {
    const cookie = sessionOf(await form('/login', { email: 'kim@example.com', password: 'correct-horse' }))!
    const html = await (await get('/', { headers: { cookie } })).text()
    expect(cards(html)).toBe(DOCUMENTS.length - 3)
    expect(html).not.toContain('건이 더 있습니다')
  })
  it('검색 결과도 같은 규칙이다', async () => {
    const html = await (await get('/search?q=' + encodeURIComponent('약관'))).text()
    expect((html.match(/class="card doc-card/g) ?? []).length).toBe(PREVIEW_CARDS)
    expect(html).toContain('건이 더 있습니다')
  })
})

describe('Google 로그인', () => {
  const start = async () => {
    const res = await get('/auth/google?next=/changes', { redirect: 'manual' })
    expect(res.status).toBe(302)
    const url = new URL(res.headers.get('location')!)
    const m = res.headers.get('set-cookie')!.match(/pl_oauth=([^;]+)/)!
    return { res, url, cookie: `pl_oauth=${m[1]}`, state: url.searchParams.get('state')! }
  }
  it('Google 로 보낼 때 PKCE 와 state 를 붙이고 HttpOnly 쿠키에 남긴다', async () => {
    const { res, url, cookie, state } = await start()
    expect(url.origin + url.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth')
    expect(url.searchParams.get('client_id')).toBe('test-client')
    expect(url.searchParams.get('redirect_uri')).toBe(`${BASE}/auth/google/callback`)
    expect(url.searchParams.get('code_challenge_method')).toBe('S256')
    expect(url.searchParams.get('code_challenge')).toBeTruthy()
    expect(url.searchParams.get('scope')).toContain('openid')
    expect(cookie).toContain(state)
    expect(res.headers.get('set-cookie')).toMatch(/HttpOnly/i)
  })
  it('state 가 다르면 로그인하지 않는다', async () => {
    const { cookie } = await start()
    const res = await get('/auth/google/callback?code=abc&state=wrong', { redirect: 'manual', headers: { cookie } })
    expect(res.status).toBe(302)
    expect(res.headers.get('location')).toBe('/login?error=google')
    expect(sessionOf(res)).toBeNull()
    expect(await (await get('/login?error=google')).text()).toContain('Google 로그인에 실패')
  })
  it('토큰 교환 뒤 회원을 만들고 세션을 준다. 두 번째 로그인은 같은 회원이다', async () => {
    for (const round of [1, 2]) {
      const { cookie, state } = await start()
      googleReplies({ sub: 'g-1', email: 'Park@gmail.com', name: '박서연', picture: 'https://lh3.googleusercontent.com/a' })
      const res = await get(`/auth/google/callback?code=abc&state=${state}`, { redirect: 'manual', headers: { cookie } })
      expect(res.status, `round ${round}`).toBe(302)
      expect(res.headers.get('location')).toBe('/changes')
      const session = sessionOf(res)!
      expect(session).toBeTruthy()
      expect(await (await get('/', { headers: { cookie: session } })).text()).toContain('박서연')
      const sent = google.calls.at(-1)!
      expect(sent.url).toBe('https://oauth2.googleapis.com/token')
      expect(sent.body.get('grant_type')).toBe('authorization_code')
      expect(sent.body.get('code')).toBe('abc')
      expect(sent.body.get('code_verifier')).toBeTruthy()
      expect(sent.body.get('client_secret')).toBe('test-secret')
    }
    const row = await E.DB!.prepare("SELECT COUNT(*) AS n FROM users WHERE google_sub = 'g-1'").first<{ n: number }>()
    expect(row?.n).toBe(1)
    expect((await findUserByEmail(E, 'park@gmail.com'))?.password_hash).toBeNull()
  })
  it('같은 이메일의 이메일 가입 계정이 있으면 그 계정에 잇고, 비밀번호 로그인도 그대로 된다', async () => {
    const { cookie, state } = await start()
    googleReplies({ sub: 'g-2', email: 'kim@example.com', name: 'Kim' })
    expect((await get(`/auth/google/callback?code=abc&state=${state}`, { redirect: 'manual', headers: { cookie } })).status).toBe(302)
    const u = (await findUserByEmail(E, 'kim@example.com'))!
    expect(u.google_sub).toBe('g-2')
    expect(u.name).toBe('김우진')
    expect(await verifyPassword('correct-horse', u.password_hash)).toBe(true)
  })
  it('Google 이 거절하면 로그인 화면으로 돌아간다', async () => {
    const { cookie, state } = await start()
    googleFails()
    const res = await get(`/auth/google/callback?code=abc&state=${state}`, { redirect: 'manual', headers: { cookie } })
    expect(res.headers.get('location')).toBe('/login?error=google')
    expect(sessionOf(res)).toBeNull()
  })
  it('ID 토큰은 발급자·대상·만료·이메일 검증 여부를 본다', () => {
    expect(() => decodeIdToken(idToken({ sub: '1', email: 'a@b.co', aud: 'other' }), 'test-client')).toThrow('AUDIENCE')
    expect(() => decodeIdToken(idToken({ sub: '1', email: 'a@b.co', iss: 'https://evil.example' }), 'test-client')).toThrow('ISSUER')
    expect(() => decodeIdToken(idToken({ sub: '1', email: 'a@b.co', exp: 1 }), 'test-client')).toThrow('EXPIRED')
    expect(() => decodeIdToken(idToken({ sub: '1', email: 'a@b.co', email_verified: false }), 'test-client')).toThrow('UNVERIFIED')
    expect(decodeIdToken(idToken({ sub: '1', email: 'A@B.co' }), 'test-client').email).toBe('a@b.co')
  })
  it('설정이 없으면 Google 은 꺼진다', () => {
    expect(googleEnabled({})).toBe(false)
    expect(googleEnabled({ GOOGLE_CLIENT_ID: 'x' })).toBe(false)
    expect(googleEnabled({ GOOGLE_CLIENT_ID: 'x', GOOGLE_CLIENT_SECRET: 'y' })).toBe(true)
  })
})
