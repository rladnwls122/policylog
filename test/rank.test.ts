import { describe, it, expect } from 'vitest'
import { rankFeatured, orderForGrid, matchDocuments, searchKey, changeDate } from '../src/rank'
import type { DocumentRow, ChangeListRow } from '../src/db'

const doc = (id: string, service: string, name: string, type = 'PRIVACY', status = 'ACTIVE'): DocumentRow => ({
  id, service, service_name: name, type, title: `${name} ${type === 'TERMS' ? '이용약관' : '개인정보 처리방침'}`, canonical_url: 'https://x/',
  status, acquisition_tier: 'T1', blocker_type: 'NONE', fetch_mode: 'STATIC', robots_verdict: 'ALLOWED', robots_named: 0, robots_checked_at: null,
  official_history_url: null, history_harvester: null, public_note: null, publication_suppressed: 0, takedown_at: null, pending_hash: null,
  last_checked_at: null, last_success_at: null, last_error: null,
})
const change = (document_id: string, effective_at: string | null, observed_at = '2026-09-01T00:00:00Z'): ChangeListRow => ({
  id: 'c-' + document_id, document_id, from_version_id: 'a', to_version_id: 'b', importance: 10, categories: '[]', sections: '[]', table_rows: '[]',
  detection_window_start: null, detection_window_end: observed_at, suppressed_reason: null, created_at: observed_at,
  title: 't', service_name: 's', effective_at, observed_at, publication_suppressed: 0,
})
const none = { views: new Map<string, number>(), counts: new Map<string, { n: number; oldest: string }>(), latest: new Map<string, ChangeListRow>() }

describe('이번 주 조회 상위 기업 (rankFeatured)', () => {
  const docs = [doc('a-privacy', 'a', '알파'), doc('a-terms', 'a', '알파', 'TERMS'), doc('b-privacy', 'b', '베타'), doc('c-privacy', 'c', '감마'), doc('d-privacy', 'd', '델타', 'PRIVACY', 'BLOCKED')]
  it('조회수 순, 기업당 한 장, 세 장', () => {
    const views = new Map([['a-terms', 5], ['a-privacy', 3], ['b-privacy', 4], ['c-privacy', 1]])
    expect(rankFeatured(docs, { ...none, views }).map((d) => d.id)).toEqual(['a-terms', 'b-privacy', 'c-privacy'])
  })
  it('조회 기록이 없어도 세 장을 채운다 — 최근 변경, 그다음 보존 버전 수', () => {
    const latest = new Map([['c-privacy', change('c-privacy', '2026-08-01')], ['b-privacy', change('b-privacy', '2026-09-01')]])
    const counts = new Map([['a-privacy', { n: 30, oldest: '2020-01-01' }]])
    expect(rankFeatured(docs, { ...none, counts, latest }).map((d) => d.id)).toEqual(['b-privacy', 'c-privacy', 'a-privacy'])
  })
  it('못 가져오는 문서는 조회가 많아도 후보가 아니다', () => {
    const views = new Map([['d-privacy', 100]])
    expect(rankFeatured(docs, { ...none, views }).some((d) => d.id === 'd-privacy')).toBe(false)
  })
})

describe('그리드 순서 (orderForGrid)', () => {
  it('수집 중 → 준비 중 → 못 가져옴, 같은 상태면 최근 변경 순', () => {
    const docs = [doc('x', 'x', '엑스', 'TERMS', 'BLOCKED'), doc('y', 'y', '와이', 'TERMS', 'PENDING_RENDER'), doc('z', 'z', '제트'), doc('w', 'w', '더블유')]
    const latest = new Map([['w', change('w', '2026-01-01')], ['z', change('z', '2026-05-05')]])
    expect(orderForGrid(docs, { ...none, latest }).map((d) => d.id)).toEqual(['z', 'w', 'y', 'x'])
  })
})

describe('검색 (matchDocuments)', () => {
  const docs = [doc('kakao-terms', 'kakao', '카카오', 'TERMS'), doc('kakao-privacy', 'kakao', '카카오'), doc('toss-terms', 'toss', '토스', 'TERMS')]
  it('서비스 이름으로 찾는다', () => expect(matchDocuments(docs, '카카오').map((d) => d.id)).toEqual(['kakao-terms', 'kakao-privacy']))
  it('낱말 전부가 걸려야 한다 — "카카오 개인정보" 는 처리방침 하나', () => expect(matchDocuments(docs, '카카오 개인정보').map((d) => d.id)).toEqual(['kakao-privacy']))
  it('영문 id 와 문서 종류 낱말도 걸린다', () => {
    expect(matchDocuments(docs, 'TOSS').map((d) => d.id)).toEqual(['toss-terms'])
    expect(matchDocuments(docs, '약관')).toHaveLength(2)
  })
  it('빈 검색어는 아무것도 돌려주지 않는다', () => expect(matchDocuments(docs, '  ')).toEqual([]))
  it('카드의 data-q 와 서버 검색이 같은 키를 쓴다 — 소문자, 공백 없음', () => {
    expect(searchKey(docs[0])).toContain('카카오이용약관')
    expect(searchKey(docs[0])).toBe(searchKey(docs[0]).toLowerCase())
    expect(searchKey(docs[0])).not.toMatch(/\s/)
  })
  it('changeDate 는 시행일, 없으면 감지일, 변경이 없으면 빈 문자열', () => {
    expect(changeDate(change('a', '2026-02-02'))).toBe('2026-02-02')
    expect(changeDate(change('a', null, '2026-03-03T10:00:00Z'))).toBe('2026-03-03')
    expect(changeDate(undefined)).toBe('')
  })
})
