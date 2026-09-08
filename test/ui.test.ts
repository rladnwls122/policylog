// 새 공개 화면: 스플래시 · 검색 · 상위 세 장 · 그리드. 실제 워커에서 실제 D1 로 확인한다.
import { env, SELF } from 'cloudflare:test'
import { describe, it, expect, beforeAll } from 'vitest'
import { syncDocuments, type Env } from '../src/db'

const BASE = 'https://policylog.test'
const get = (path: string, init?: RequestInit) => SELF.fetch(BASE + path, init)

beforeAll(() => syncDocuments(env as unknown as Env))

describe('메인 화면', () => {
  it('검색창, 이번 주 조회 상위 기업 세 장, 그리드가 있다', async () => {
    const html = await (await get('/')).text()
    expect(html).toContain('role="search"')
    expect(html).toContain('이번 주 조회 상위 기업')
    expect(html).toContain('id="grid"')
    expect((html.match(/class="rank"/g) ?? []).length).toBe(3)
  })
  it('상위 세 장은 서로 다른 기업이고 그리드에서는 빠진다', async () => {
    const html = await (await get('/')).text()
    const featured = html.slice(html.indexOf('id="featured"'), html.indexOf('id="all"'))
    const ids = [...featured.matchAll(/href="\/policies\/([a-z0-9-]+)"/g)].map((m) => m[1])
    expect(ids).toHaveLength(3)
    expect(new Set(ids.map((id) => id.split('-')[0])).size).toBe(3)
    const grid = html.slice(html.indexOf('id="grid"'))
    for (const id of ids) expect(grid).not.toContain(`href="/policies/${id}"`)
  })
  it('첫 방문에는 소개 스플래시가 덮이고, 쿠키가 있으면 바로 기록이 보인다', async () => {
    expect(await (await get('/')).text()).toContain('id="splash"')
    expect(await (await get('/', { headers: { cookie: 'pl_intro=1' } })).text()).not.toContain('id="splash"')
  })
  it('/start 는 쿠키를 주고 홈으로 돌려보낸다', async () => {
    const res = await get('/start', { redirect: 'manual' })
    expect(res.status).toBe(302)
    expect(res.headers.get('location')).toBe('/')
    expect(res.headers.get('set-cookie')).toContain('pl_intro=1')
  })
  it('문서를 열어 본 만큼 조회가 쌓이고, 가장 많이 본 기업이 1위로 올라온다', async () => {
    for (let i = 0; i < 3; i++) await get('/policies/daangn-privacy')
    const html = await (await get('/')).text()
    const first = html.indexOf('class="rank"')
    const card = html.slice(first, html.indexOf('</article>', first))
    expect(card).toContain('/policies/daangn-privacy')
    expect(card).toContain('이번 주 3회 조회')
  })
})

describe('소개 · 검색 · 변경 기록', () => {
  it('/intro 는 목적, 제공 서비스, 사용 방법을 소개한다', async () => {
    const html = await (await get('/intro')).text()
    expect(html).toContain('무엇을 하나요')
    expect(html).toContain('어떻게 쓰나요')
    expect(html).toContain('지키는 원칙')
    expect(html).toContain('시작하기')
  })
  it('/search 는 서비스 이름으로 문서를 찾고, 빈 검색어는 홈으로 보낸다', async () => {
    const html = await (await get('/search?q=' + encodeURIComponent('카카오'))).text()
    expect(html).toContain('카카오 이용약관')
    expect(html).not.toContain('토스 서비스 이용약관')
    expect((await get('/search', { redirect: 'manual' })).status).toBe(302)
  })
  it('/changes 는 변경 기록 목록이다', async () => {
    const res = await get('/changes')
    expect(res.status).toBe(200)
    expect(await res.text()).toContain('변경 기록')
  })
  it('없는 페이지도 같은 옷을 입는다', async () => {
    const res = await get('/nope')
    expect(res.status).toBe(404)
    expect(await res.text()).toContain('페이지를 찾을 수 없습니다')
  })
})

describe('다크 모드', () => {
  it('상단에 테마 버튼 두 개(어둡게·밝게)가 있고, 기본은 시스템 설정을 따른다', async () => {
    const html = await (await get('/intro')).text()
    expect(html).toContain('data-theme-set="dark"')
    expect(html).toContain('data-theme-set="light"')
    expect(html).toContain('<html lang="ko">')
    expect(html).toContain('media="(prefers-color-scheme: dark)"')
  })
  it('/theme 는 쿠키를 주고 돌아갈 곳으로 보낸다. 쿠키가 있으면 html 에 data-theme 이 붙는다', async () => {
    const res = await get('/theme', { method: 'POST', redirect: 'manual', body: new URLSearchParams({ theme: 'dark', next: '/changes' }),
      headers: { 'content-type': 'application/x-www-form-urlencoded', origin: BASE } })
    expect(res.status).toBe(302)
    expect(res.headers.get('location')).toBe('/changes')
    expect(res.headers.get('set-cookie')).toContain('pl_theme=dark')
    expect(await (await get('/intro', { headers: { cookie: 'pl_theme=dark' } })).text()).toContain('<html lang="ko" data-theme="dark">')
    expect(await (await get('/intro', { headers: { cookie: 'pl_theme=light' } })).text()).toContain('data-theme="light"')
    expect(await (await get('/intro', { headers: { cookie: 'pl_theme=weird' } })).text()).toContain('<html lang="ko">')
  })
  it('다른 값이면 쿠키를 지워 시스템 설정으로 돌아간다', async () => {
    const res = await get('/theme', { method: 'POST', redirect: 'manual', body: new URLSearchParams({ theme: 'auto' }),
      headers: { 'content-type': 'application/x-www-form-urlencoded', origin: BASE, cookie: 'pl_theme=dark' } })
    expect(res.headers.get('set-cookie')).toMatch(/pl_theme=;|max-age=0/i)
  })
})
