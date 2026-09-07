import { Hono } from 'hono'
import { basicAuth } from 'hono/basic-auth'
import { getCookie, setCookie } from 'hono/cookie'
import { DOCUMENTS } from './documents'
import { type Env, syncDocuments, listDocuments, getDocument, listVersions, getVersion, getChange, listChangesForDocument, recentChanges, versionCounts, updateDocument, now,
  latestChanges, countChanges, weeklyViews, recordView } from './db'
import { sectionsOf } from './normalize'
import { shapeVersion, excerpt } from './public'
import { backfill, poll, runScheduled, rebuildChanges, discover, probe } from './acquire'
import { rankFeatured, matchDocuments } from './rank'
import { withDb, dbOf } from './sql'
import { Layout, Home, IntroPage, SearchPage, ChangesPage, DocumentPage, VersionPage, ChangePage, BotPage, NotFoundPage, AdminPage } from './views'

const app = new Hono<{ Bindings: Env }>()

// 요청 하나가 DB 연결 하나를 쓴다. Workers 는 요청을 넘어 소켓을 못 쓰므로 여기서 열고 응답 뒤에 닫는다 (src/sql.ts).
app.use('*', (c, next) => withDb(c.env, () => next()))

/** 스플래시를 한 번 본 방문자에게 다시 보이지 않게 하는 쿠키. 값 하나뿐이고 누구인지 식별하지 않는다. */
export const INTRO_COOKIE = 'pl_intro'

/** 홈과 검색이 함께 쓰는 신호. 공개 억제된 문서는 여기서 걸러진다. */
async function catalog(env: Env) {
  const [docs, counts, latest, views] = await Promise.all([listDocuments(env), versionCounts(env), latestChanges(env), weeklyViews(env)])
  return { docs: docs.filter((d) => !d.publication_suppressed), signals: { counts, latest, views } }
}

// 공개 문서만. 게시 억제(테이크다운)된 문서는 존재하지 않는 것처럼 404.
async function publicDoc(env: Env, id: string) {
  const d = await getDocument(env, id)
  return d && !d.publication_suppressed ? d : null
}

// ── 공개 페이지 ────────────────────────────────────────────────
// 홈. 상단은 검색과 이번 주 조회 상위 세 장, 하단은 나머지 문서의 그리드.
// 첫 방문(쿠키 없음)이면 소개 스플래시가 위를 덮는다 — 서버가 결정하므로 깜빡임이 없다.
app.get('/', async (c) => {
  const [{ docs, signals }, total] = await Promise.all([catalog(c.env), countChanges(c.env)])
  const showIntro = getCookie(c, INTRO_COOKIE) !== '1'
  return c.html(<Layout title="약관 변경 이력" siteUrl={c.env.SITE_URL} path="/"><Home docs={docs} signals={signals} featured={rankFeatured(docs, signals)} total={total} showIntro={showIntro} /></Layout>)
})

app.get('/intro', (c) => c.html(<Layout title="소개" siteUrl={c.env.SITE_URL} path="/intro"><IntroPage /></Layout>))

// 스플래시의 "시작하기". JS 가 없어도 여기로 와서 쿠키를 받고 홈으로 돌아간다.
app.get('/start', (c) => {
  setCookie(c, INTRO_COOKIE, '1', { path: '/', maxAge: 60 * 60 * 24 * 365, sameSite: 'Lax' })
  return c.redirect('/', 302)
})

// 서버 검색. 홈의 검색창이 JS 없이 제출되면 여기로 온다. 규칙은 홈의 즉시 거르기와 같다 (src/rank.ts).
app.get('/search', async (c) => {
  const q = (c.req.query('q') ?? '').trim().slice(0, 80)
  if (!q) return c.redirect('/', 302)
  const { docs, signals } = await catalog(c.env)
  return c.html(<Layout title={`${q} 검색`} siteUrl={c.env.SITE_URL} path="/search"><SearchPage q={q} docs={matchDocuments(docs, q)} signals={signals} /></Layout>)
})

app.get('/changes', async (c) => {
  const changes = await recentChanges(c.env, 100)
  return c.html(<Layout title="변경 기록" siteUrl={c.env.SITE_URL} path="/changes"><ChangesPage changes={changes} /></Layout>)
})

app.get('/bot', (c) => c.html(<Layout title="수집 정책" siteUrl={c.env.SITE_URL} path="/bot"><BotPage ua={c.env.USER_AGENT} contact={c.env.CONTACT_EMAIL} robotsMode={c.env.ROBOTS_MODE ?? 'ENFORCE'} /></Layout>))

// 문서·버전·변경 화면은 조회로 센다. 집계는 "이번 주 조회 상위 기업" 에만 쓰고, 누가 봤는지는 남기지 않는다.
app.get('/policies/:id', async (c) => {
  const d = await publicDoc(c.env, c.req.param('id'))
  if (!d) return c.notFound()
  const [versions, changes] = await Promise.all([listVersions(c.env, d.id), listChangesForDocument(c.env, d.id), recordView(c.env, d.id)])
  return c.html(<Layout title={d.title} siteUrl={c.env.SITE_URL} feed={`/policies/${d.id}/feed.xml`}><DocumentPage d={d} versions={versions} changes={changes} /></Layout>)
})

app.get('/policies/:id/versions/:vid', async (c) => {
  const d = await publicDoc(c.env, c.req.param('id'))
  const v = await getVersion(c.env, c.req.param('vid'))
  if (!d || !v || v.document_id !== d.id) return c.notFound()
  await recordView(c.env, d.id)
  return c.html(<Layout title={`${d.title} ${v.effective_at ?? ''}`} siteUrl={c.env.SITE_URL}><VersionPage d={d} v={shapeVersion(v, sectionsOf(v.normalized_text))} /></Layout>)
})

app.get('/changes/:id', async (c) => {
  const ch = await getChange(c.env, c.req.param('id'))
  if (!ch) return c.notFound()
  const d = await publicDoc(c.env, ch.document_id)
  if (!d) return c.notFound()
  const [from, to] = await Promise.all([getVersion(c.env, ch.from_version_id), getVersion(c.env, ch.to_version_id), recordView(c.env, d.id)])
  if (!from || !to) return c.notFound()
  return c.html(<Layout title={`${d.title} 변경`} siteUrl={c.env.SITE_URL}><ChangePage d={d} c={ch} from={from} to={to} /></Layout>)
})

// RSS (§33): 문서별 변경 피드. 계정 없이 쓰는 유일한 알림 채널.
app.get('/policies/:id/feed.xml', async (c) => {
  const d = await publicDoc(c.env, c.req.param('id'))
  if (!d) return c.notFound()
  const changes = (await listChangesForDocument(c.env, d.id)).slice(0, 30)
  const site = c.env.SITE_URL
  const esc = (s: string) => s.replace(/[<>&]/g, (ch) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' })[ch]!)
  const items = changes.map((ch) => `
    <item>
      <title>${esc(`${d.title} 변경 · ${ch.effective_at ? `시행 ${ch.effective_at}` : ch.detection_window_end.slice(0, 10) + ' 감지'}`)}</title>
      <link>${site}/changes/${ch.id}</link><guid>${site}/changes/${ch.id}</guid>
      <pubDate>${new Date(ch.created_at).toUTCString()}</pubDate>
      <description>${esc(`중요도 ${ch.importance} · ${(JSON.parse(ch.categories) as string[]).join(', ')}${ch.suppressed_reason ? ' · 이력 백필' : ''}`)}</description>
    </item>`).join('')
  return c.body(`<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel><title>${esc(d.title)} · POLICYLOG</title><link>${site}/policies/${d.id}</link><description>${esc(d.title)} 변경 이력</description>${items}</channel></rss>`,
    200, { 'content-type': 'application/rss+xml; charset=utf-8' })
})

// ── 공개 API (§41). 전체 본문을 돌려주는 엔드포인트는 없다 — test/policy.test.ts 가 이를 강제한다. ──
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
  const [docs, counts] = await Promise.all([listDocuments(c.env), versionCounts(c.env)])
  return c.html(<Layout title="관리" siteUrl={c.env.SITE_URL}><AdminPage docs={docs} counts={counts} /></Layout>)
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

app.notFound((c) => c.html(<Layout title="없는 페이지" siteUrl={c.env.SITE_URL}><NotFoundPage /></Layout>, 404))

export default {
  fetch: app.fetch,
  async scheduled(_ev: ScheduledEvent, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(withDb(env, async () => { await syncDocuments(env, DOCUMENTS); await runScheduled(env) }))
  },
}
export { app }
