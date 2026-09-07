import { Hono } from 'hono'
import { basicAuth } from 'hono/basic-auth'
import { DOCUMENTS } from './documents'
import { type Env, syncDocuments, listDocuments, getDocument, listVersions, getVersion, getChange, listChangesForDocument, recentChanges, versionCounts, updateDocument, now } from './db'
import { sectionsOf } from './normalize'
import { shapeVersion, excerpt } from './public'
import { backfill, poll, runScheduled } from './acquire'
import { Layout, Home, DocumentPage, VersionPage, ChangePage, BotPage, AdminPage } from './views'

const app = new Hono<{ Bindings: Env }>()

// 공개 문서만. 게시 억제(테이크다운)된 문서는 존재하지 않는 것처럼 404.
async function publicDoc(env: Env, id: string) {
  const d = await getDocument(env, id)
  return d && !d.publication_suppressed ? d : null
}

// ── 공개 페이지 ────────────────────────────────────────────────
app.get('/', async (c) => {
  const [docs, counts, changes] = await Promise.all([listDocuments(c.env), versionCounts(c.env), recentChanges(c.env)])
  return c.html(<Layout title="약관 변경 이력" siteUrl={c.env.SITE_URL}><Home docs={docs.filter((d) => !d.publication_suppressed)} counts={counts} changes={changes} /></Layout>)
})

app.get('/bot', (c) => c.html(<Layout title="수집 정책" siteUrl={c.env.SITE_URL}><BotPage ua={c.env.USER_AGENT} contact={c.env.CONTACT_EMAIL} /></Layout>))

app.get('/policies/:id', async (c) => {
  const d = await publicDoc(c.env, c.req.param('id'))
  if (!d) return c.notFound()
  const [versions, changes] = await Promise.all([listVersions(c.env, d.id), listChangesForDocument(c.env, d.id)])
  return c.html(<Layout title={d.title} siteUrl={c.env.SITE_URL} feed={`/policies/${d.id}/feed.xml`}><DocumentPage d={d} versions={versions} changes={changes} /></Layout>)
})

app.get('/policies/:id/versions/:vid', async (c) => {
  const d = await publicDoc(c.env, c.req.param('id'))
  const v = await getVersion(c.env, c.req.param('vid'))
  if (!d || !v || v.document_id !== d.id) return c.notFound()
  return c.html(<Layout title={`${d.title} ${v.effective_at ?? ''}`} siteUrl={c.env.SITE_URL}><VersionPage d={d} v={shapeVersion(v, sectionsOf(v.normalized_text))} /></Layout>)
})

app.get('/changes/:id', async (c) => {
  const ch = await getChange(c.env, c.req.param('id'))
  if (!ch) return c.notFound()
  const d = await publicDoc(c.env, ch.document_id)
  if (!d) return c.notFound()
  const [from, to] = await Promise.all([getVersion(c.env, ch.from_version_id), getVersion(c.env, ch.to_version_id)])
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

app.notFound((c) => c.html(<Layout title="없는 페이지" siteUrl={c.env.SITE_URL}><h1>페이지를 찾을 수 없습니다</h1><p><a href="/">카탈로그로</a></p></Layout>, 404))

export default {
  fetch: app.fetch,
  async scheduled(_ev: ScheduledEvent, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil((async () => { await syncDocuments(env, DOCUMENTS); await runScheduled(env) })())
  },
}
export { app }
