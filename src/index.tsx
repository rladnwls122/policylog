import { Hono, type Context } from 'hono'
import { basicAuth } from 'hono/basic-auth'
import { getCookie, setCookie, deleteCookie } from 'hono/cookie'
import { DOCUMENTS } from './documents'
import { type Env, syncDocuments, listDocuments, getDocument, listVersions, getVersion, getChange, listChangesForDocument, recentChanges, versionCounts, updateDocument, now,
  latestChanges, countChanges, weeklyViews, recordView, deleteExpiredSessions, countUsers, type UserRow, type ChangeListRow,
  listWatched, addWatch, removeWatch, watchedChanges, listChanges, findUserByFeedKey, deleteUserSessions, deleteUser, purgeAttempts, updateUser } from './db'
import { sectionsOf } from './normalize'
import { shapeVersion, excerpt } from './public'
import { backfill, poll, runScheduled, rebuildChanges, discover, probe } from './acquire'
import { rankFeatured, matchDocuments } from './rank'
import { withDb, dbOf } from './sql'
import { SESSION_COOKIE, OAUTH_COOKIE, SESSION_DAYS, userFromToken, createSession, destroySession, joinWithEmail, loginWithEmail,
  googleEnabled, googleAuthUrl, googleExchange, userFromGoogle, randomToken, safeNext, ensureFeedKey } from './auth'
import { Layout, Home, IntroPage, SearchPage, ChangesPage, DocumentPage, VersionPage, ChangePage, BotPage, NotFoundPage, AdminPage, JoinPage, LoginPage, MePage, CAT, type Theme } from './views'

type App = { Bindings: Env; Variables: { user: UserRow | null } }
const app = new Hono<App>()

// 요청 하나가 DB 연결 하나를 쓴다. Workers 는 요청을 넘어 소켓을 못 쓰므로 여기서 열고 응답 뒤에 닫는다 (src/sql.ts).
app.use('*', (c, next) => withDb(c.env, () => next()))
// 세션 쿠키 → 회원. 없거나 만료됐으면 null. 모든 화면이 c.get('user') 로 본다.
app.use('*', async (c, next) => { c.set('user', await userFromToken(c.env, getCookie(c, SESSION_COOKIE))); await next() })

/** 테마 쿠키. dark·light 만 뜻이 있고, 없으면 시스템 설정을 따른다. JS 가 없어도 /theme 폼으로 바뀐다. */
export const THEME_COOKIE = 'pl_theme'
const themeOf = (c: Context<App>): Theme | undefined => { const t = getCookie(c, THEME_COOKIE); return t === 'dark' || t === 'light' ? t : undefined }
const here = (c: Context<App>) => { const u = new URL(c.req.url); return u.pathname + u.search }

/** 공통 옷. 회원 여부·테마·현재 위치를 상단에 넘긴다. */
const page = (c: Context<App>, title: string, body: unknown, opts: { feed?: string; path?: string; status?: 200 | 404; description?: string; noindex?: boolean } = {}) =>
  c.html(<Layout title={title} siteUrl={c.env.SITE_URL} feed={opts.feed} path={opts.path} description={opts.description} noindex={opts.noindex} user={c.get('user')} theme={themeOf(c)} here={here(c)}>{body as any}</Layout>, opts.status ?? 200)

/** 폼을 보낸 화면으로 돌아간다. 같은 출처의 Referer 만 믿고, 없으면 fallback. */
const back = (c: Context<App>, fallback: string) => {
  const r = c.req.header('referer')
  if (r) { try { const u = new URL(r); if (u.origin === new URL(c.req.url).origin) return u.pathname + u.search } catch { /* 무시 */ } }
  return fallback
}
const clientIp = (c: Context<App>) => c.req.header('cf-connecting-ip') ?? c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ?? null

/** RSS 2.0. 문서 피드와 개인 피드가 같은 모양이다. 제목·중요도·분류만 싣고 본문은 싣지 않는다 (D-1). */
function rss(site: string, title: string, link: string, description: string, changes: ChangeListRow[]) {
  const esc = (s: string) => s.replace(/[<>&]/g, (ch) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' })[ch]!)
  const items = changes.map((ch) => `
    <item>
      <title>${esc(`${ch.title} 변경 · ${ch.effective_at ? `시행 ${ch.effective_at}` : ch.detection_window_end.slice(0, 10) + ' 감지'}`)}</title>
      <link>${site}/changes/${ch.id}</link><guid>${site}/changes/${ch.id}</guid>
      <pubDate>${new Date(ch.created_at).toUTCString()}</pubDate>
      <description>${esc(`중요도 ${ch.importance} · ${(JSON.parse(ch.categories) as string[]).join(', ')}${ch.suppressed_reason ? ' · 이력 백필' : ''}`)}</description>
    </item>`).join('')
  return `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel><title>${esc(title)} · POLICYLOG</title><link>${link}</link><description>${esc(description)}</description>${items}</channel></rss>`
}

/** 스플래시를 한 번 본 방문자에게 다시 보이지 않게 하는 쿠키. 값 하나뿐이고 누구인지 식별하지 않는다. */
export const INTRO_COOKIE = 'pl_intro'

/** 홈과 검색이 함께 쓰는 신호. 공개 억제된 문서는 여기서 걸러진다. 회원이면 관심 문서 집합이 붙는다. */
async function catalog(env: Env, user: UserRow | null = null) {
  const [docs, counts, latest, views, watched] = await Promise.all([listDocuments(env), versionCounts(env), latestChanges(env), weeklyViews(env), user ? listWatched(env, user.id) : undefined])
  return { docs: docs.filter((d) => !d.publication_suppressed), signals: { counts, latest, views, watched } }
}

// 공개 문서만. 게시 억제(테이크다운)된 문서는 존재하지 않는 것처럼 404.
async function publicDoc(env: Env, id: string) {
  const d = await getDocument(env, id)
  return d && !d.publication_suppressed ? d : null
}

// ── 공개 페이지 ────────────────────────────────────────────────
// 홈. 상단은 검색과 이번 주 조회 상위 세 장, 하단은 나머지 문서의 그리드 — 비회원은 PREVIEW_CARDS 장까지만 보인다.
// 첫 방문(비회원, 쿠키 없음)이면 소개 스플래시가 위를 덮는다 — 서버가 결정하므로 깜빡임이 없다.
app.get('/', async (c) => {
  const user = c.get('user')
  const [{ docs, signals }, total] = await Promise.all([catalog(c.env, user), countChanges(c.env)])
  const showIntro = !user && getCookie(c, INTRO_COOKIE) !== '1'
  return page(c, '약관 변경 이력', <Home docs={docs} signals={signals} featured={rankFeatured(docs, signals)} total={total} showIntro={showIntro} member={!!user} />, { path: '/' })
})

app.get('/intro', (c) => page(c, '소개', <IntroPage />, { path: '/intro' }))

// 테마 고정. dark·light 는 쿠키로 남기고, 그 밖의 값은 쿠키를 지워 시스템 설정으로 돌아간다.
app.post('/theme', async (c) => {
  if (!sameOrigin(c)) return c.text('forbidden', 403)
  const f = await c.req.parseBody()
  const theme = str(f.theme)
  if (theme === 'dark' || theme === 'light') setCookie(c, THEME_COOKIE, theme, { path: '/', maxAge: 60 * 60 * 24 * 365, sameSite: 'Lax' })
  else deleteCookie(c, THEME_COOKIE, { path: '/' })
  return c.redirect(safeNext(str(f.next)), 302)
})

// 스플래시의 "시작하기". JS 가 없어도 여기로 와서 쿠키를 받고 홈으로 돌아간다.
app.get('/start', (c) => {
  setCookie(c, INTRO_COOKIE, '1', { path: '/', maxAge: 60 * 60 * 24 * 365, sameSite: 'Lax' })
  return c.redirect('/', 302)
})

// 서버 검색. 홈의 검색창이 JS 없이 제출되면 여기로 온다. 규칙은 홈의 즉시 거르기와 같다 (src/rank.ts).
app.get('/search', async (c) => {
  const q = (c.req.query('q') ?? '').trim().slice(0, 80)
  if (!q) return c.redirect('/', 302)
  const { docs, signals } = await catalog(c.env, c.get('user'))
  return page(c, `${q} 검색`, <SearchPage q={q} docs={matchDocuments(docs, q)} signals={signals} member={!!c.get('user')} />, { path: '/search', noindex: true })
})

// 변경 기록. 주제(cat)와 중요도(imp=hi|mid)로 거른다. 값은 서버가 아는 것만 받는다.
app.get('/changes', async (c) => {
  const cat = c.req.query('cat')
  const imp = c.req.query('imp')
  const f = { cat: cat && cat in CAT ? cat : undefined, imp: imp === 'hi' || imp === 'mid' ? imp : undefined }
  const changes = await listChanges(c.env, { cat: f.cat, minImportance: f.imp === 'hi' ? 35 : f.imp === 'mid' ? 20 : undefined, limit: 100 })
  return page(c, '변경 기록', <ChangesPage changes={changes} cat={f.cat} imp={f.imp} />, { path: '/changes' })
})

app.get('/bot', (c) => page(c, '수집 정책', <BotPage ua={c.env.USER_AGENT} contact={c.env.CONTACT_EMAIL} robotsMode={c.env.ROBOTS_MODE ?? 'ENFORCE'} />, { path: '/bot' }))

// 문서·버전·변경 화면은 조회로 센다. 집계는 "이번 주 조회 상위 기업" 에만 쓰고, 누가 봤는지는 남기지 않는다.
app.get('/policies/:id', async (c) => {
  const d = await publicDoc(c.env, c.req.param('id'))
  if (!d) return c.notFound()
  const user = c.get('user')
  const [versions, changes, watched] = await Promise.all([listVersions(c.env, d.id), listChangesForDocument(c.env, d.id), user ? listWatched(c.env, user.id) : undefined, recordView(c.env, d.id)])
  return page(c, d.title, <DocumentPage d={d} versions={versions} changes={changes} watched={watched ? watched.has(d.id) : null} />,
    { feed: `/policies/${d.id}/feed.xml`, description: `${d.title}의 보존한 버전 ${versions.length}개와 변경 ${changes.length}건. ${d.service_name}의 ${d.type === 'TERMS' ? '이용약관' : '개인정보 처리방침'} 변경 이력.` })
})

app.get('/policies/:id/versions/:vid', async (c) => {
  const d = await publicDoc(c.env, c.req.param('id'))
  const v = await getVersion(c.env, c.req.param('vid'))
  if (!d || !v || v.document_id !== d.id) return c.notFound()
  await recordView(c.env, d.id)
  return page(c, `${d.title} ${v.effective_at ?? ''}`, <VersionPage d={d} v={shapeVersion(v, sectionsOf(v.normalized_text))} />)
})

app.get('/changes/:id', async (c) => {
  const ch = await getChange(c.env, c.req.param('id'))
  if (!ch) return c.notFound()
  const d = await publicDoc(c.env, ch.document_id)
  if (!d) return c.notFound()
  const [from, to, siblings] = await Promise.all([getVersion(c.env, ch.from_version_id), getVersion(c.env, ch.to_version_id), listChangesForDocument(c.env, d.id), recordView(c.env, d.id)])
  if (!from || !to) return c.notFound()
  // 같은 문서의 이웃 변경. 목록은 최신순이라 앞이 다음(더 새로운), 뒤가 이전이다.
  const i = siblings.findIndex((x) => x.id === ch.id)
  const newer = i > 0 ? siblings[i - 1] : null
  const older = i >= 0 && i + 1 < siblings.length ? siblings[i + 1] : null
  const cats = (JSON.parse(ch.categories) as string[]).map((k) => CAT[k] ?? k).join(', ')
  return page(c, `${d.title} 변경`, <ChangePage d={d} c={ch} from={from} to={to} newer={newer} older={older} />,
    { description: `${d.title} ${to.effective_at ? `${to.effective_at} 시행` : '변경'}. ${cats || '분류 없음'}. 조문 단위 비교.` })
})

// ── 회원 (src/auth.ts) ─────────────────────────────────────────
// 가입·로그인은 POST 폼이다. SameSite=Lax 쿠키에 더해 Origin 도 봐서 다른 사이트에서 던져 넣은 폼을 막는다.
const sameOrigin = (c: Context<App>) => { const o = c.req.header('origin'); return !o || o === new URL(c.req.url).origin }
const userAgent = (c: Context<App>) => c.req.header('user-agent')?.slice(0, 200) ?? null
const secure = (c: Context<App>) => new URL(c.req.url).protocol === 'https:'
function signIn(c: Context<App>, token: string) {
  setCookie(c, SESSION_COOKIE, token, { path: '/', httpOnly: true, secure: secure(c), sameSite: 'Lax', maxAge: SESSION_DAYS * 86_400 })
  setCookie(c, INTRO_COOKIE, '1', { path: '/', maxAge: 60 * 60 * 24 * 365, sameSite: 'Lax' })   // 회원에게 스플래시를 다시 보이지 않는다
}
const str = (v: unknown) => (typeof v === 'string' ? v : '')

app.get('/join', (c) => c.get('user') ? c.redirect('/', 302) : page(c, '회원가입', <JoinPage next={safeNext(c.req.query('next'))} google={googleEnabled(c.env)} />, { path: '/join' }))
app.post('/join', async (c) => {
  if (!sameOrigin(c)) return c.text('forbidden', 403)
  const f = await c.req.parseBody()
  const next = safeNext(str(f.next))
  const r = await joinWithEmail(c.env, { email: str(f.email), password: str(f.password), name: str(f.name) })
  if (!r.ok) return page(c, '회원가입', <JoinPage next={next} google={googleEnabled(c.env)} error={r.error} values={{ email: str(f.email), name: str(f.name) }} />, { path: '/join' })
  signIn(c, await createSession(c.env, r.user.id, userAgent(c)))
  return c.redirect(next, 302)
})

const LOGIN_ERRORS: Record<string, string> = { google: 'Google 로그인에 실패했습니다. 다시 시도해 주세요.' }
app.get('/login', (c) => c.get('user') ? c.redirect('/', 302)
  : page(c, '로그인', <LoginPage next={safeNext(c.req.query('next'))} google={googleEnabled(c.env)} error={LOGIN_ERRORS[c.req.query('error') ?? '']} />, { path: '/login' }))
app.post('/login', async (c) => {
  if (!sameOrigin(c)) return c.text('forbidden', 403)
  const f = await c.req.parseBody()
  const next = safeNext(str(f.next))
  const r = await loginWithEmail(c.env, { email: str(f.email), password: str(f.password) }, clientIp(c))
  if (!r.ok) return page(c, '로그인', <LoginPage next={next} google={googleEnabled(c.env)} error={r.error} values={{ email: str(f.email) }} />, { path: '/login' })
  signIn(c, await createSession(c.env, r.user.id, userAgent(c)))
  return c.redirect(next, 302)
})
app.post('/logout', async (c) => {
  if (!sameOrigin(c)) return c.text('forbidden', 403)
  await destroySession(c.env, getCookie(c, SESSION_COOKIE))
  deleteCookie(c, SESSION_COOKIE, { path: '/' })
  return c.redirect('/', 302)
})

// ── 관심 약관 · 내 페이지 ───────────────────────────────────────
const requireMember = (c: Context<App>) => (c.get('user') ? null : c.redirect(`/login?next=${encodeURIComponent(back(c, here(c)))}`, 302))

app.post('/watch/:id', async (c) => {
  if (!sameOrigin(c)) return c.text('forbidden', 403)
  const gate = requireMember(c)
  if (gate) return gate
  const d = await publicDoc(c.env, c.req.param('id'))
  if (!d) return c.notFound()
  const f = await c.req.parseBody()
  if (str(f.on) === '0') await removeWatch(c.env, c.get('user')!.id, d.id)
  else await addWatch(c.env, c.get('user')!.id, d.id)
  return c.redirect(back(c, `/policies/${d.id}`), 302)
})

app.get('/me', async (c) => {
  const gate = requireMember(c)
  if (gate) return gate
  const user = c.get('user')!
  const [{ docs, signals }, changes, key] = await Promise.all([catalog(c.env, user), watchedChanges(c.env, user.id, 30), ensureFeedKey(c.env, user)])
  const mine = docs.filter((d) => signals.watched!.has(d.id))
  const feedUrl = `${c.env.SITE_URL}/me/feed.xml?key=${key}`
  return page(c, '내 페이지', <MePage user={user} docs={mine} signals={signals} changes={changes} feedUrl={feedUrl} saved={c.req.query('saved') ?? undefined} />, { path: '/me', noindex: true })
})
app.post('/me/name', async (c) => {
  if (!sameOrigin(c)) return c.text('forbidden', 403)
  const gate = requireMember(c)
  if (gate) return gate
  const name = str((await c.req.parseBody()).name).trim().slice(0, 60)
  await updateUser(c.env, c.get('user')!.id, { name: name || null })
  return c.redirect('/me?saved=name', 302)
})
app.post('/me/feed/rotate', async (c) => {
  if (!sameOrigin(c)) return c.text('forbidden', 403)
  const gate = requireMember(c)
  if (gate) return gate
  await ensureFeedKey(c.env, c.get('user')!, true)
  return c.redirect('/me?saved=feed', 302)
})
app.post('/me/logout-all', async (c) => {
  if (!sameOrigin(c)) return c.text('forbidden', 403)
  const gate = requireMember(c)
  if (gate) return gate
  await deleteUserSessions(c.env, c.get('user')!.id)
  deleteCookie(c, SESSION_COOKIE, { path: '/' })
  return c.redirect('/login', 302)
})
app.post('/me/delete', async (c) => {
  if (!sameOrigin(c)) return c.text('forbidden', 403)
  const gate = requireMember(c)
  if (gate) return gate
  if (str((await c.req.parseBody()).confirm) !== '1') return c.redirect('/me?saved=confirm', 302)
  await deleteUser(c.env, c.get('user')!.id)
  deleteCookie(c, SESSION_COOKIE, { path: '/' })
  return c.redirect('/', 302)
})
// 개인 RSS. 쿠키 대신 주소의 키로 회원을 찾는다. 키가 틀리면 있는지 없는지도 말하지 않는다.
app.get('/me/feed.xml', async (c) => {
  const key = c.req.query('key') ?? ''
  const user = key.length >= 16 ? await findUserByFeedKey(c.env, key) : null
  if (!user) return c.notFound()
  const changes = await watchedChanges(c.env, user.id, 50)
  return c.body(rss(c.env.SITE_URL, '내 관심 약관', `${c.env.SITE_URL}/me`, '관심 약관의 변경 이력', changes), 200,
    { 'content-type': 'application/rss+xml; charset=utf-8', 'cache-control': 'private, max-age=300' })
})

// Google 로그인 (OpenID Connect 인가 코드 + PKCE). state·verifier·돌아갈 곳은 10분짜리 HttpOnly 쿠키에 둔다.
app.get('/auth/google', async (c) => {
  if (!googleEnabled(c.env)) return c.text('Google 로그인이 설정되지 않았습니다 (GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET).', 503)
  const state = randomToken(16), verifier = randomToken(32), next = safeNext(c.req.query('next'))
  setCookie(c, OAUTH_COOKIE, `${state}.${verifier}.${next}`, { path: '/auth/google', httpOnly: true, secure: secure(c), sameSite: 'Lax', maxAge: 600 })
  return c.redirect(await googleAuthUrl(c.env, new URL(c.req.url).origin, state, verifier), 302)
})
app.get('/auth/google/callback', async (c) => {
  const fail = (why: string) => { deleteCookie(c, OAUTH_COOKIE, { path: '/auth/google' }); console.warn('google login failed:', why); return c.redirect('/login?error=google', 302) }
  if (!googleEnabled(c.env)) return fail('disabled')
  const [state, verifier, ...rest] = getCookie(c, OAUTH_COOKIE)?.split('.') ?? []
  const code = c.req.query('code'), got = c.req.query('state')
  if (!code || !got || !state || !verifier || got !== state) return fail('state mismatch')
  try {
    const user = await userFromGoogle(c.env, await googleExchange(c.env, new URL(c.req.url).origin, code, verifier))
    deleteCookie(c, OAUTH_COOKIE, { path: '/auth/google' })
    signIn(c, await createSession(c.env, user.id, userAgent(c)))
    return c.redirect(safeNext(rest.join('.')), 302)
  } catch (e) { return fail(String(e)) }
})

// RSS (§33): 문서별 변경 피드. 계정 없이 쓰는 알림 채널.
app.get('/policies/:id/feed.xml', async (c) => {
  const d = await publicDoc(c.env, c.req.param('id'))
  if (!d) return c.notFound()
  const changes = (await listChangesForDocument(c.env, d.id)).slice(0, 30)
  return c.body(rss(c.env.SITE_URL, d.title, `${c.env.SITE_URL}/policies/${d.id}`, `${d.title} 변경 이력`, changes), 200,
    { 'content-type': 'application/rss+xml; charset=utf-8', 'cache-control': 'public, max-age=300' })
})

// 검색 엔진용. 회원·인증·검색 화면은 색인하지 않는다.
app.get('/robots.txt', (c) => c.text(`User-agent: *\nAllow: /\nDisallow: /admin\nDisallow: /me\nDisallow: /auth/\nDisallow: /login\nDisallow: /join\nDisallow: /search\nSitemap: ${c.env.SITE_URL}/sitemap.xml\n`, 200, { 'cache-control': 'public, max-age=3600' }))
app.get('/sitemap.xml', async (c) => {
  const site = c.env.SITE_URL
  const [docs, changes, latest] = await Promise.all([listDocuments(c.env), listChanges(c.env, { limit: 500 }), latestChanges(c.env)])
  const url = (path: string, lastmod?: string | null) => `<url><loc>${site}${path}</loc>${lastmod ? `<lastmod>${lastmod.slice(0, 10)}</lastmod>` : ''}</url>`
  const urls = [url('/'), url('/intro'), url('/changes'), url('/bot'),
    ...docs.filter((d) => !d.publication_suppressed).map((d) => url(`/policies/${d.id}`, latest.get(d.id)?.observed_at)),
    ...changes.map((ch) => url(`/changes/${ch.id}`, ch.observed_at))]
  return c.body(`<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls.join('')}</urlset>`, 200,
    { 'content-type': 'application/xml; charset=utf-8', 'cache-control': 'public, max-age=3600' })
})

// ── 공개 API (§41). 전체 본문을 돌려주는 엔드포인트는 없다 — test/policy.test.ts 가 이를 강제한다. ──
app.use('/api/*', async (c, next) => { await next(); c.header('cache-control', 'public, max-age=300') })
app.get('/api/v1/services', async (c) => {
  const docs = (await listDocuments(c.env)).filter((d) => !d.publication_suppressed)
  const counts = await versionCounts(c.env)
  return c.json(docs.map((d) => ({ id: d.id, service: d.service, serviceName: d.service_name, type: d.type, title: d.title, canonicalUrl: d.canonical_url,
    status: d.status, blockerType: d.blocker_type, acquisitionTier: d.acquisition_tier, robotsVerdict: d.robots_verdict, robotsCheckedAt: d.robots_checked_at,
    publicNote: d.public_note, versionCount: counts.get(d.id)?.n ?? 0, oldestVersion: counts.get(d.id)?.oldest ?? null })))
})
app.get('/api/v1/policies/:id/versions', async (c) => {
  const d = await publicDoc(c.env, c.req.param('id'))
  if (!d) return c.json({ error: 'not found' }, 404)
  return c.json(await listVersions(c.env, d.id))
})
app.get('/api/v1/policies/:id/versions/:vid', async (c) => {
  const d = await publicDoc(c.env, c.req.param('id'))
  const v = await getVersion(c.env, c.req.param('vid'))
  if (!d || !v || v.document_id !== d.id) return c.json({ error: 'not found' }, 404)
  return c.json(shapeVersion(v, sectionsOf(v.normalized_text)))
})
app.get('/api/v1/changes/:id', async (c) => {
  const ch = await getChange(c.env, c.req.param('id'))
  if (!ch || !(await publicDoc(c.env, ch.document_id))) return c.json({ error: 'not found' }, 404)
  const sections = (JSON.parse(ch.sections) as any[]).map((s) => ({ ...s, beforeText: excerpt(s.beforeText), afterText: excerpt(s.afterText) }))
  return c.json({ ...ch, categories: JSON.parse(ch.categories), sections, tableRows: JSON.parse(ch.table_rows), table_rows: undefined })
})
app.get('/api/v1/changes', async (c) => c.json((await recentChanges(c.env, 50)).map(({ sections: _s, table_rows: _t, ...rest }) => ({ ...rest, categories: JSON.parse(rest.categories) }))))

// ── 운영 (§36–§38). 기본 인증 뒤. 원본 스냅샷은 여기서만 볼 수 있다 (D-1). ──
const admin = new Hono<{ Bindings: Env }>()
admin.use('*', async (c, next) => {
  if (!c.env.ADMIN_PASSWORD) return c.text('ADMIN_PASSWORD not set', 503)
  return basicAuth({ username: 'admin', password: c.env.ADMIN_PASSWORD })(c, next)
})
admin.get('/', async (c) => {
  await syncDocuments(c.env)
  const [docs, counts, users] = await Promise.all([listDocuments(c.env), versionCounts(c.env), countUsers(c.env)])
  return c.html(<Layout title="관리" siteUrl={c.env.SITE_URL} theme={themeOf(c as unknown as Context<App>)} here="/admin"><AdminPage docs={docs} counts={counts} users={users} /></Layout>)
})
admin.post('/backfill/:id', async (c) => {
  await syncDocuments(c.env)
  try { return c.json(await backfill(c.env, c.req.param('id'))) } catch (e) { return c.json({ error: String(e) }, 400) }
})
// changes 는 versions 에서 파생된 데이터다. 분류 규칙이나 파서를 고치면 다시 만든다 (버전은 그대로).
admin.post('/reparse/:id', async (c) => {
  const id = c.req.param('id')
  await dbOf(c.env).run('DELETE FROM changes WHERE document_id = ?', [id])
  await rebuildChanges(c.env, id, 'BACKFILL')
  return c.json({ id, rebuilt: true })
})
// 카탈로그를 넓힐 때 쓴다. robots 를 먼저 보고 허용된 경우에만 본문을 만진다 (§16.1).
admin.get('/discover', async (c) => {
  const url = c.req.query('url')
  if (!url) return c.json({ error: 'url required' }, 400)
  try { return c.json(await discover(c.env, url)) } catch (e) { return c.json({ error: String(e) }, 400) }
})
admin.get('/probe', async (c) => {
  const url = c.req.query('url')
  if (!url) return c.json({ error: 'url required' }, 400)
  const sel = c.req.query('selectors')?.split(',').filter(Boolean)
  const mode = c.req.query('render') === '1' ? 'RENDER' : 'STATIC'   // §85 렌더링 수집으로 재본다
  try { return c.json(await probe(c.env, url, sel, mode)) } catch (e) { return c.json({ error: String(e) }, 400) }
})
admin.post('/poll/:id', async (c) => { await syncDocuments(c.env); return c.json(await poll(c.env, c.req.param('id'))) })
admin.post('/run', async (c) => { await syncDocuments(c.env); return c.json(await runScheduled(c.env)) })
admin.get('/raw/:vid', async (c) => {
  const v = await getVersion(c.env, c.req.param('vid'))
  const obj = v && (await c.env.RAW.get(v.raw_object_key))
  return obj ? c.body(obj.body, 200, { 'content-type': 'text/plain; charset=utf-8' }) : c.notFound()
})
admin.post('/suppress/:id', async (c) => {
  const on = (await c.req.parseBody())['on'] !== '0'
  await updateDocument(c.env, c.req.param('id'), { publication_suppressed: on ? 1 : 0, takedown_at: on ? now() : null })
  return c.json({ id: c.req.param('id'), publication_suppressed: on })
})
app.route('/admin', admin)

app.notFound((c) => page(c, '없는 페이지', <NotFoundPage />, { status: 404 }))

export default {
  fetch: app.fetch,
  async scheduled(_ev: ScheduledEvent, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(withDb(env, async () => {
      await syncDocuments(env, DOCUMENTS)
      await deleteExpiredSessions(env)
      await purgeAttempts(env, new Date(Date.now() - 86_400_000).toISOString())
      await runScheduled(env)
    }))
  },
}
export { app }
