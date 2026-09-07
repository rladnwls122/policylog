import { describe, it, expect } from 'vitest'
import { diffSections, diffTables, diffParagraphs, classify, summarize } from '../src/diff'
import { sectionsOf } from '../src/normalize'

const S = (t: string) => sectionsOf(t)

describe('diffSections', () => {
  it('변경 없으면 결과 없음', () => {
    const a = S('제1조 (목적)\n같은 본문')
    expect(diffSections(a, a)).toEqual([])
  })
  it('조문 수정을 잡는다', () => {
    const out = diffSections(S('제1조 (목적)\n이전 본문'), S('제1조 (목적)\n이후 본문'))
    expect(out).toHaveLength(1)
    expect(out[0].changeType).toBe('MODIFIED')
  })
  it('조문 추가·삭제를 구분한다', () => {
    const out = diffSections(S('제1조 (목적)\n본문'), S('제1조 (목적)\n본문\n제2조 (정의)\n새 조문'))
    expect(out.map((x) => x.changeType)).toEqual(['ADDED'])
    expect(out[0].identifier).toBe('제2조')
  })
  it('조문 삽입으로 뒤 조문이 밀려도 전면 개정으로 오판하지 않는다', () => {
    const before = S('제1조 (목적)\nA\n제2조 (정의)\nB')
    const after = S('제1조 (목적)\nA\n제1조의2 (신설)\nNEW\n제2조 (정의)\nB')
    const out = diffSections(before, after)
    expect(out.map((x) => x.identifier)).toEqual(['제1조의2'])
  })
})

describe('classify (§28)', () => {
  it('제3자 제공은 높은 중요도', () => {
    expect(classify('개인정보를 제3자에게 제공합니다').importance).toBe(40)
  })
  it('AI 학습 이용이 가장 높다', () => {
    const c = classify('인공지능 모델 학습에 이용할 수 있습니다')
    expect(c.importance).toBe(45)
    expect(c.categories).toContain('AI_DATA_USAGE')
  })
  it('부호만 바뀐 오타 수정은 1점', () => {
    expect(classify(', .').importance).toBe(1)
  })
})

describe('diffTables (§68.4)', () => {
  const T = (rows: string[][]) => [{ identifier: '개인정보 제3자 제공 현황', headers: ['제공받는 자', '제공 항목'], rows }]
  it('행 추가를 최고 중요도로 올린다', () => {
    const out = diffTables(T([['A사', '이름']]), T([['A사', '이름'], ['B사', '이름, 연락처']]))
    expect(out).toHaveLength(1)
    expect(out[0].changeType).toBe('ADDED')
    expect(out[0].rowKey).toBe('B사')
    expect(out[0].importance).toBe(45)
  })
  it('행 순서만 바뀐 것은 변경이 아니다', () => {
    const out = diffTables(T([['A사', '이름'], ['B사', '연락처']]), T([['B사', '연락처'], ['A사', '이름']]))
    expect(out).toEqual([])
  })
  it('셀 수정은 MODIFIED', () => {
    const out = diffTables(T([['A사', '이름']]), T([['A사', '이름, 주소']]))
    expect(out[0].changeType).toBe('MODIFIED')
  })
})

describe('diffParagraphs 폴백', () => {
  it('조문 구조가 없는 문서도 비교된다', () => {
    const out = diffParagraphs('첫 문단\n둘째 문단', '첫 문단\n바뀐 문단')
    expect(out.length).toBeGreaterThan(0)
    expect(out[0].changeType).toBe('MODIFIED')
  })
})

describe('summarize', () => {
  it('가장 높은 중요도를 문서 중요도로 삼는다', () => {
    const s = summarize([{ identifier: '제1조', title: '', changeType: 'MODIFIED', importance: 10, categories: ['OTHER'] }],
      [{ tableIdentifier: 't', rowKey: 'r', changeType: 'ADDED', importance: 45, categories: ['DATA_SHARING'] }])
    expect(s.importance).toBe(45)
    expect(s.categories).toEqual(['OTHER', 'DATA_SHARING'])
  })
})
