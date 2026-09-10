import { describe, it, expect } from 'vitest'
import { extract } from '../src/extract'
import { normalize, gate, extractDates, sectionsOf } from '../src/normalize'
import { testDoc } from './fixtures/catalog'

// 픽스처는 실제 서비스에서 받아온 한국어 정책 HTML 이다 (2026-09-07 수집). 합성 픽스처는 쓰지 않는다 (§53).
import daangnCurrent from './fixtures/daangn-privacy-current.html?raw'
import daangnPrev from './fixtures/daangn-privacy-20260327.html?raw'
import tossCurrent from './fixtures/toss-terms-current.html?raw'
import tossOld from './fixtures/toss-terms-11097.html?raw'
import tossPrivacySpa from './fixtures/toss-privacy-empty-spa.html?raw'

const FIXTURES: Record<string, string> = {
  'daangn-privacy-current.html': daangnCurrent,
  'daangn-privacy-20260327.html': daangnPrev,
  'toss-terms-current.html': tossCurrent,
  'toss-terms-11097.html': tossOld,
  'toss-privacy-empty-spa.html': tossPrivacySpa,
}
const fx = (n: string) => FIXTURES[n]

describe('당근 개인정보 처리방침 (DIRECTORY_INDEX)', () => {
  const cfg = testDoc('daangn-privacy').extraction!
  it('본문을 뽑고 시행일을 읽는다', async () => {
    const e = await extract(fx('daangn-privacy-current.html'), cfg.selector, cfg.ignore)
    const text = normalize(e.text)
    expect(gate(text)).toEqual({ ok: true })
    expect(text.length).toBeGreaterThan(10_000)
    expect(extractDates(text).effectiveAt).toBe('2026-07-07')
  })
  it('표를 행 단위로 뽑는다', async () => {
    const e = await extract(fx('daangn-privacy-current.html'), cfg.selector, cfg.ignore)
    expect(e.tables.length).toBeGreaterThan(0)
    expect(e.tables[0].rows[0].length).toBeGreaterThan(1)
  })
  // 실측 픽스처의 제3자 제공 표는 첫 칸이 rowspan="7" 이다. 이것을 안 펴면 아래 여섯 행의 열이
  // 통째로 왼쪽으로 밀려서, "제공 목적" 이 "제공받는자" 칸에 들어간 채 저장된다.
  it('rowspan 으로 병합된 칸을 아래 행까지 채운다', async () => {
    const e = await extract(fx('daangn-privacy-current.html'), cfg.selector, cfg.ignore)
    const t = e.tables.find((x) => x.headers[0] === '제공받는자')!
    expect(t.rows.slice(0, 7).map((r) => r[0])).toEqual(Array(7).fill('(주)당근페이'))
    expect(new Set(t.rows.map((r) => r.length))).toEqual(new Set([t.headers.length]))
  })
  it('한 절에 표가 둘이면 둘 다 나온다', async () => {
    const e = await extract(fx('daangn-privacy-current.html'), cfg.selector, cfg.ignore)
    const same = e.tables.filter((x) => x.identifier.startsWith('11 개인정보 자동 수집'))
    expect(same.map((x) => x.headers[0])).toEqual(['법적근거', '수탁업체'])
  })
  it('목차 네비게이션은 본문에서 제외된다', async () => {
    const e = await extract(fx('daangn-privacy-current.html'), cfg.selector, cfg.ignore)
    expect(e.text).not.toContain('목차')
  })
  it('과거 버전도 같은 셀렉터로 뽑힌다', async () => {
    const e = await extract(fx('daangn-privacy-20260327.html'), cfg.selector, cfg.ignore)
    expect(normalize(e.text).length).toBeGreaterThan(10_000)
  })
})

describe('토스 이용약관 (LINK_LIST)', () => {
  const cfg = testDoc('toss-terms').extraction!
  it('조문 구조를 인식한다', async () => {
    const e = await extract(fx('toss-terms-current.html'), cfg.selector, cfg.ignore)
    const s = sectionsOf(normalize(e.text))
    expect(s.length).toBeGreaterThan(20)
    expect(s.some((x) => x.identifier === '제1조')).toBe(true)
  })
  it('라벨 없는 선두 날짜를 시행일로 읽는다', async () => {
    const e = await extract(fx('toss-terms-current.html'), cfg.selector, cfg.ignore)
    expect(extractDates(normalize(e.text), { leadingDate: true }).effectiveAt).toBe('2026-06-17')
  })
  it('버전 드롭다운(과거 날짜 목록)은 본문에서 빠진다', async () => {
    const e = await extract(fx('toss-terms-11097.html'), cfg.selector, cfg.ignore)
    const text = normalize(e.text)
    expect(extractDates(text, { leadingDate: true }).effectiveAt).toBe('2021-07-06')
  })
})

describe('토스 개인정보 처리방침 (빈 SPA)', () => {
  it('HTTP 200 이어도 게이트에 걸린다', async () => {
    const e = await extract(fx('toss-privacy-empty-spa.html'), 'main', [])
    expect(gate(normalize(e.text)).ok).toBe(false)
  })
})
