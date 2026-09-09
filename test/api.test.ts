// 실제 워커를 띄우고 실제 D1 에 실제 정책 HTML 을 넣은 뒤, 공개 표면이 무엇을 내보내는지 확인한다.
import { env, SELF } from 'cloudflare:test'
import { describe, it, expect, beforeAll } from 'vitest'
import daangnCurrent from './fixtures/daangn-privacy-current.html?raw'
import daangnPrev from './fixtures/daangn-privacy-20260327.html?raw'
import { extract } from '../src/extract'
import { normalize, sha256, NORMALIZATION_PROFILE, PARSER_VERSION } from '../src/normalize'
import { TEST_DOCS, testDoc } from './fixtures/catalog'
import { syncDocuments, insertVersion, listVersions, latestVersion, latestVersionGate, findVersionByHash, getChange, type Env } from '../src/db'
import { createChange, rebuildChanges } from '../src/acquire'

const cfg = testDoc('daangn-privacy')
const E = env as unknown as Env
const BASE = 'https://policylog.test'
const AUTH = { authorization: `Basic ${btoa('admin:test')}` }
const get = (path: string, init?: RequestInit) => SELF.fetch(BASE + path, init)

/** 실제 스냅샷 하나를 파이프라인 그대로 통과시켜 버전으로 만든다. 같은 내용이면 아무것도 하지 않는다. */
async function seed(html: string, effectiveAt: string, observedAt: string) {
  const e = await extract(html, cfg.extraction!.selector, cfg.extraction!.ignore)
  const text = normalize(e.text)
  const hash = await sha256(text)
  const existing = await findVersionByHash(E, cfg.id, NORMALIZATION_PROFILE, hash)
  if (existing) return existing.id
  const id = crypto.randomUUID()
  const key = `raw/${cfg.id}/${id}.html`
  await E.RAW.put(key, html)
  await insertVersion(E, {
    id, document_id: cfg.id, observed_at: observedAt, effective_at: effectiveAt, announced_at: null,
    earliest_possible_change_at: null, lifecycle: 'CURRENT', source_url: `https://privacy-policy.daangn.com/previous_pp/${effectiveAt.replace(/-/g, '')}/`,
    provenance: 'OFFICIAL_HISTORY', acquisition_tier: 'T3', fetch_mode: 'STATIC', raw_object_key: key,
    normalized_text: text, content_hash: hash, normalization_profile_id: NORMALIZATION_PROFILE, parser_version: PARSER_VERSION,
    extraction_method: `html:${cfg.extraction!.selector}`, metadata: JSON.stringify({ tables: e.tables }), created_at: observedAt,
  })
  return id
}

let fullText = ''

beforeAll(async () => {
  await syncDocuments(E, TEST_DOCS)
  await seed(daangnPrev, '2026-03-27', '2026-03-27T00:00:00.000Z')
  await seed(daangnCurrent, '2026-07-07', '2026-09-07T00:00:00.000Z')
  await rebuildChanges(E, cfg.id, 'BACKFILL')
  fullText = (await latestVersion(E, cfg.id))!.normalized_text
})

describe('공개 표면', () => {
  it('버전 목록 API 는 본문을 담지 않는다', async () => {
    const res = await get(`/api/v1/policies/${cfg.id}/versions`)
    const body = await res.text()
    expect(res.status).toBe(200)
    expect(JSON.parse(body)).toHaveLength(2)
    expect(body).not.toContain('normalized_text')
    expect(body.length).toBeLessThan(fullText.length)
  })

  it('버전 상세 API 는 조문 본문을 자르지 않고 준다', async () => {
    const list = await (await get(`/api/v1/policies/${cfg.id}/versions`)).json<any[]>()
    const res = await get(`/api/v1/policies/${cfg.id}/versions/${list[0].id}`)
    const detail = await res.clone().json<any>()
    expect(await res.text()).not.toContain('normalized_text')
    const shown = detail.sections.reduce((n: number, x: any) => n + x.text.length, 0)
    expect(shown).toBeGreaterThan(detail.textLength * 0.8)
    expect(detail.sections.length).toBeGreaterThan(5)
  })

  it('수집한 원본 HTML 은 어떤 공개 응답에도 없다', async () => {
    const tail = '<!DOCTYPE html'
    const list = await (await get(`/api/v1/policies/${cfg.id}/versions`)).json<any[]>()
    const changes = await (await get('/api/v1/changes')).json<any[]>()
    const urls = [
      '/', '/bot', '/intro', '/changes', '/changes?cat=OVERSEAS_TRANSFER', '/join', '/login', '/robots.txt', '/sitemap.xml',
      '/search?q=' + encodeURIComponent('당근'), `/policies/${cfg.id}`, `/policies/${cfg.id}/feed.xml`,
      ...list.map((v) => `/policies/${cfg.id}/versions/${v.id}`),
      ...list.map((v) => `/api/v1/policies/${cfg.id}/versions/${v.id}`),
      '/api/v1/services', '/api/v1/changes', `/api/v1/policies/${cfg.id}/versions`,
      ...changes.map((c) => `/changes/${c.id}`), ...changes.map((c) => `/api/v1/changes/${c.id}`),
    ]
    for (const u of urls) {
      const body = await (await get(u)).text()
      expect(body, u).not.toContain(tail)
      expect(body, u).not.toContain('normalized_text')
    }
  })

  it('원본 스냅샷은 관리자만 볼 수 있다', async () => {
    const list = await (await get(`/api/v1/policies/${cfg.id}/versions`)).json<any[]>()
    expect((await get(`/admin/raw/${list[0].id}`)).status).toBe(401)
    const ok = await get(`/admin/raw/${list[0].id}`, { headers: AUTH })
    expect(ok.status).toBe(200)
    expect((await ok.text()).length).toBeGreaterThan(10_000)
  })
})

describe('멱등성', () => {
  it('같은 스냅샷을 다시 넣어도 버전이 늘지 않는다', async () => {
    const before = await listVersions(E, cfg.id)
    await seed(daangnCurrent, '2026-07-07', new Date().toISOString())
    expect(await listVersions(E, cfg.id)).toHaveLength(before.length)
  })

  it('rebuildChanges 를 반복해도 변경이 중복되지 않는다', async () => {
    const count = async () => (await (await get('/api/v1/changes')).json<any[]>()).length
    const before = await count()
    await rebuildChanges(E, cfg.id, 'BACKFILL')
    await rebuildChanges(E, cfg.id, 'BACKFILL')
    expect(await count()).toBe(before)
  })

  it('syncDocuments 를 반복해도 카탈로그가 늘지 않는다', async () => {
    const count = async () => (await (await get('/api/v1/services')).json<any[]>()).length
    const before = await count()
    await syncDocuments(E, TEST_DOCS)
    await syncDocuments(E, TEST_DOCS)
    expect(await count()).toBe(before)
  })

  it('정규화 프로필이 다르면 비교 자체를 거부한다 (§21)', async () => {
    const [a, b] = await E.DB!.prepare('SELECT * FROM versions WHERE document_id = ? LIMIT 2').bind(cfg.id).all<any>().then((r) => r.results)
    await expect(createChange(E, { ...a, normalization_profile_id: 'v0' }, b, null)).rejects.toThrow('CROSS_PROFILE')
  })
})

describe('실제 문서로 만든 변경', () => {
  it('2026-03-27 → 2026-07-07 사이 변경을 잡는다', async () => {
    const changes = await (await get('/api/v1/changes')).json<any[]>()
    expect(changes.length).toBeGreaterThan(0)
    const detail = await (await get(`/api/v1/changes/${changes[0].id}`)).json<any>()
    expect(detail.sections.length + detail.tableRows.length).toBeGreaterThan(0)
    expect(detail.suppressed_reason).toBe('BACKFILL')
  })

  it('차단된 문서는 사유와 함께 카탈로그에 남는다 (§2.7)', async () => {
    const services = await (await get('/api/v1/services')).json<any[]>()
    const blocked = services.filter((s) => s.status === 'BLOCKED')
    expect(blocked.length).toBeGreaterThan(0)
    for (const b of blocked) expect(b.publicNote, b.id).toBeTruthy()
    expect(await (await get('/')).text()).toContain('못 가져옴')
  })

  it('RSS 피드가 변경을 싣는다', async () => {
    const res = await get(`/policies/${cfg.id}/feed.xml`)
    expect(res.headers.get('content-type')).toContain('application/rss+xml')
    expect(await res.text()).toContain('<item>')
  })

  it('게시 중단하면 공개 표면에서 사라지고, 되돌릴 수 있다', async () => {
    const body = (on: string) => ({ method: 'POST', headers: AUTH, body: new URLSearchParams({ on }) })
    await get(`/admin/suppress/${cfg.id}`, body('1'))
    expect((await get(`/policies/${cfg.id}`)).status).toBe(404)
    await get(`/admin/suppress/${cfg.id}`, body('0'))
    expect((await get(`/policies/${cfg.id}`)).status).toBe(200)
  })
})

describe('createChange 멱등성', () => {
  it('같은 (from, to) 를 두 번 만들어도 행은 하나고 같은 id 를 준다', async () => {
    const [a, b] = await E.DB!.prepare('SELECT * FROM versions WHERE document_id = ? ORDER BY effective_at LIMIT 2').bind(cfg.id).all<any>().then((r) => r.results)
    const first = await createChange(E, a, b, null)
    const again = await createChange(E, a, b, null)
    expect(again).toBe(first)
    const n = await E.DB!.prepare('SELECT COUNT(*) AS n FROM changes WHERE from_version_id = ? AND to_version_id = ?').bind(a.id, b.id).first<{ n: number }>()
    expect(n!.n).toBe(1)
    // 돌려준 id 로 행을 실제로 읽을 수 있어야 한다 — poll 이 이 id 로 알림 메일을 만든다.
    expect(await getChange(E, again)).not.toBeNull()
  })
})

describe('게이트용 직전 버전 조회', () => {
  it('본문을 통째로 끌어오지 않고 길이와 앞부분만 준다', async () => {
    const full = (await latestVersion(E, cfg.id))!
    const g = (await latestVersionGate(E, cfg.id))!
    expect(g.id).toBe(full.id)
    expect(g.effective_at).toBe(full.effective_at)
    expect(g.len).toBe(full.normalized_text.length)
    expect(g.head).toBe(full.normalized_text.slice(0, 4000))
    expect(g.head.length).toBeLessThan(full.normalized_text.length)
  })
})
