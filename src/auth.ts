// 회원·로그인. 비밀번호는 PBKDF2-SHA256(WebCrypto), 세션은 무작위 토큰의 SHA-256 을 DB 에 두고 원문은 쿠키에만 둔다.
// Google 로그인은 OpenID Connect 인가 코드 흐름 + PKCE 다. 이 파일의 fetch 는 Google 토큰 교환 하나뿐이고 호스트가 고정돼 있다
// (수집용 fetch 는 acquire.ts 에만 있다 — test/policy.test.ts 가 둘 다 확인한다).
import { sha256 } from './normalize'
import { type Env, type UserRow, now, uid, findUserByEmail, findUserByGoogleSub, insertUser, updateUser, insertSession, sessionUser, deleteSession } from './db'

export const SESSION_COOKIE = 'pl_session'
export const OAUTH_COOKIE = 'pl_oauth'
export const SESSION_DAYS = 30
export const MIN_PASSWORD = 8
/** 무료 플랜의 CPU 10ms 를 넘기면 PASSWORD_ITERATIONS 로 낮춘다. 해시 문자열에 횟수가 들어 있어 기존 계정은 그대로 검증된다. */
export const DEFAULT_ITERATIONS = 100_000

const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth'
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token'
const GOOGLE_ISSUERS = ['https://accounts.google.com', 'accounts.google.com']

const enc = new TextEncoder()
const b64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
const unb64url = (s: string) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(s.length / 4) * 4, '=')), (c) => c.charCodeAt(0))
export const randomToken = (bytes = 32) => b64url(crypto.getRandomValues(new Uint8Array(bytes)))

const pbkdf2 = async (password: string, salt: Uint8Array, iterations: number) => {
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits'])
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: salt as BufferSource, iterations }, key, 256))
}
const equal = (a: Uint8Array, b: Uint8Array) => {
  if (a.length !== b.length) return false
  let d = 0
  for (let i = 0; i < a.length; i++) d |= a[i] ^ b[i]
  return d === 0
}

export async function hashPassword(password: string, iterations = DEFAULT_ITERATIONS): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16))
  return `pbkdf2-sha256$${iterations}$${b64url(salt)}$${b64url(await pbkdf2(password, salt, iterations))}`
}

export async function verifyPassword(password: string, stored: string | null): Promise<boolean> {
  if (!stored) return false
  const [algo, iter, salt, hash] = stored.split('$')
  if (algo !== 'pbkdf2-sha256' || !iter || !salt || !hash) return false
  return equal(await pbkdf2(password, unb64url(salt), Number(iter)), unb64url(hash))
}

export const normalizeEmail = (e: string) => e.trim().toLowerCase()
export const validEmail = (e: string) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e) && e.length <= 254
/** 로그인 뒤 돌아갈 곳. 이 사이트 안의 경로만 받는다 — 열린 리다이렉트를 막는다. */
export const safeNext = (s: string | undefined | null) => (s && /^\/(?!\/)/.test(s) && !/[\r\n]/.test(s) ? s : '/')

// ── 세션 ──────────────────────────────────────────────────────
export async function createSession(env: Env, userId: string, userAgent: string | null): Promise<string> {
  const token = randomToken()
  const t = Date.now()
  await insertSession(env, { id: await sha256(token), user_id: userId, created_at: new Date(t).toISOString(), expires_at: new Date(t + SESSION_DAYS * 86_400_000).toISOString(), user_agent: userAgent })
  await updateUser(env, userId, { last_login_at: now() })
  return token
}

export const userFromToken = async (env: Env, token: string | undefined): Promise<UserRow | null> =>
  token ? sessionUser(env, await sha256(token), now()) : null

export const destroySession = async (env: Env, token: string | undefined) => { if (token) await deleteSession(env, await sha256(token)) }

// ── 이메일 가입·로그인 ──────────────────────────────────────────
export type JoinResult = { ok: true; user: UserRow } | { ok: false; error: string }

export async function joinWithEmail(env: Env, input: { email: string; password: string; name?: string }): Promise<JoinResult> {
  const email = normalizeEmail(input.email ?? '')
  const password = input.password ?? ''
  if (!validEmail(email)) return { ok: false, error: '이메일 주소를 확인해 주세요.' }
  if (password.length < MIN_PASSWORD) return { ok: false, error: `비밀번호는 ${MIN_PASSWORD}자 이상이어야 합니다.` }
  if (await findUserByEmail(env, email)) return { ok: false, error: '이미 가입된 이메일입니다. 로그인해 주세요.' }
  const iterations = Number(env.PASSWORD_ITERATIONS) || DEFAULT_ITERATIONS
  const user: UserRow = { id: uid(), email, name: input.name?.trim().slice(0, 60) || null, picture: null, password_hash: await hashPassword(password, iterations), google_sub: null, created_at: now(), last_login_at: null }
  await insertUser(env, user)
  return { ok: true, user }
}

export async function loginWithEmail(env: Env, input: { email: string; password: string }): Promise<JoinResult> {
  const user = await findUserByEmail(env, normalizeEmail(input.email ?? ''))
  // 계정이 없어도 해시를 한 번 계산해 응답 시간으로 가입 여부가 새지 않게 한다.
  const ok = await verifyPassword(input.password ?? '', user?.password_hash ?? (await hashPassword('x', 1000)))
  if (!user || !ok) return { ok: false, error: '이메일 또는 비밀번호가 맞지 않습니다.' }
  if (!user.password_hash) return { ok: false, error: '이 이메일은 Google 로 가입돼 있습니다. Google 로 계속하기를 눌러 주세요.' }
  return { ok: true, user }
}

// ── Google (OpenID Connect + PKCE) ──────────────────────────────
export const googleEnabled = (env: Pick<Env, 'GOOGLE_CLIENT_ID' | 'GOOGLE_CLIENT_SECRET'>) => !!(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET)
export const googleRedirectUri = (origin: string) => `${origin}/auth/google/callback`

export async function googleAuthUrl(env: Env, origin: string, state: string, verifier: string): Promise<string> {
  const challenge = b64url(new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(verifier))))
  const u = new URL(GOOGLE_AUTH_URL)
  u.search = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID!, redirect_uri: googleRedirectUri(origin), response_type: 'code', scope: 'openid email profile',
    state, code_challenge: challenge, code_challenge_method: 'S256', prompt: 'select_account',
  }).toString()
  return u.toString()
}

export interface GoogleIdentity { sub: string; email: string; name: string | null; picture: string | null }

/**
 * ID 토큰을 Google 토큰 엔드포인트에서 직접(TLS, client_secret 인증) 받았으므로 서명은 다시 검증하지 않는다 —
 * Google 의 OpenID Connect 안내가 이 경우를 그렇게 적는다. 발급자·대상·만료·이메일 검증 여부는 확인한다.
 */
export function decodeIdToken(idToken: string, clientId: string): GoogleIdentity {
  const parts = idToken.split('.')
  if (parts.length !== 3) throw new Error('ID_TOKEN_MALFORMED')
  const p = JSON.parse(new TextDecoder().decode(unb64url(parts[1])))
  if (!GOOGLE_ISSUERS.includes(p.iss)) throw new Error('ID_TOKEN_ISSUER')
  if (p.aud !== clientId) throw new Error('ID_TOKEN_AUDIENCE')
  if (typeof p.exp !== 'number' || p.exp * 1000 < Date.now()) throw new Error('ID_TOKEN_EXPIRED')
  if (!p.sub || !p.email || p.email_verified !== true) throw new Error('ID_TOKEN_EMAIL_UNVERIFIED')
  return { sub: String(p.sub), email: normalizeEmail(String(p.email)), name: p.name ? String(p.name).slice(0, 60) : null, picture: p.picture ? String(p.picture) : null }
}

export async function googleExchange(env: Env, origin: string, code: string, verifier: string): Promise<GoogleIdentity> {
  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ code, client_id: env.GOOGLE_CLIENT_ID!, client_secret: env.GOOGLE_CLIENT_SECRET!, redirect_uri: googleRedirectUri(origin), grant_type: 'authorization_code', code_verifier: verifier }),
  })
  if (!res.ok) throw new Error(`GOOGLE_TOKEN_${res.status}`)
  const body = (await res.json()) as { id_token?: string }
  if (!body.id_token) throw new Error('GOOGLE_NO_ID_TOKEN')
  return decodeIdToken(body.id_token, env.GOOGLE_CLIENT_ID!)
}

/** Google 신원으로 회원을 찾거나 만든다. 같은 이메일의 이메일 가입 계정이 있으면 그 계정에 Google 을 잇는다 (Google 이 이메일을 검증했다). */
export async function userFromGoogle(env: Env, g: GoogleIdentity): Promise<UserRow> {
  const bySub = await findUserByGoogleSub(env, g.sub)
  if (bySub) {
    const patch: Partial<UserRow> = {}
    if (!bySub.name && g.name) patch.name = g.name
    if (g.picture && g.picture !== bySub.picture) patch.picture = g.picture
    if (Object.keys(patch).length) await updateUser(env, bySub.id, patch)
    return { ...bySub, ...patch }
  }
  const byEmail = await findUserByEmail(env, g.email)
  if (byEmail) {
    const patch: Partial<UserRow> = { google_sub: g.sub, picture: g.picture ?? byEmail.picture, name: byEmail.name ?? g.name }
    await updateUser(env, byEmail.id, patch)
    return { ...byEmail, ...patch }
  }
  const user: UserRow = { id: uid(), email: g.email, name: g.name, picture: g.picture, password_hash: null, google_sub: g.sub, created_at: now(), last_login_at: null }
  await insertUser(env, user)
  return user
}
