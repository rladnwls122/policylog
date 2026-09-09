import { describe, it, expect } from 'vitest'
import { normalize, sha256, gate, extractDates, sectionsOf, yyyymmdd } from '../src/normalize'

describe('normalize', () => {
  it('NFC 정규화 + 공백 정리', () => {
    const raw = '제1조  (목적)\r\n\r\n  본  약관은 적용됩니다.  \n\n'
    expect(normalize(raw)).toBe('제1조 (목적)\n본 약관은 적용됩니다.')
  })
  it('전각 숫자·괄호를 반각으로', () => {
    expect(normalize('제８조（정의）')).toBe('제8조(정의)')
  })
  it('빈 줄은 제거하되 조 경계는 보존', () => {
    const out = normalize('제1조\n\n\n제2조')
    expect(out.split('\n')).toEqual(['제1조', '제2조'])
  })
})

describe('sha256', () => {
  it('같은 입력은 같은 해시', async () => {
    expect(await sha256('a')).toBe(await sha256('a'))
  })
  it('다른 입력은 다른 해시', async () => {
    expect(await sha256('a')).not.toBe(await sha256('b'))
  })
})

describe('gate (§22.1 빈 DOM 게이트)', () => {
  it('200자 미만은 거부', () => {
    expect(gate('짧은 문서')).toEqual({ ok: false, reason: 'EMPTY_DOM' })
  })
  it('소프트 블록 문구는 거부', () => {
    const soft = '접근이 제한되었습니다. 잠시 후 다시 시도해 주세요.'.repeat(3)
    expect(gate(soft).ok).toBe(false)
  })
  it('한글 비율이 급락하면 거부 (이전 버전 대비)', () => {
    const junk = ('English only fallback page. ').repeat(40) + '가'.repeat(5)
    const prev = { length: 5000, hangulRatio: 0.9 }
    expect(gate(junk, prev)).toEqual({ ok: false, reason: 'HANGUL_RATIO_DROP' })
  })
  it('정상 한국어 조문 문서는 통과', () => {
    const good = Array.from({ length: 10 }, (_, i) => `제${i + 1}조 (조항 ${i + 1})\n본 조항은 상세한 내용을 포함하며 이용자의 권리와 의무를 규정합니다.`).join('\n')
    expect(gate(good)).toEqual({ ok: true })
  })
})

describe('extractDates (§69)', () => {
  it('시행일과 공고일을 구분한다 (네이버웹툰 패턴)', () => {
    const d = extractDates('공고일자 : 2025년 11월 20일 / 시행일자 : 2025년 11월 27일')
    expect(d.effectiveAt).toBe('2025-11-27')
    expect(d.announcedAt).toBe('2025-11-20')
  })
  it('여러 시행일 후보 중 가장 늦은 것을 취한다', () => {
    const d = extractDates('시행일 2020-01-01\n시행일 2022-03-05')
    expect(d.effectiveAt).toBe('2022-03-05')
  })
  it('개정일만 있으면 시행일을 채우지 않는다 (규칙 4)', () => {
    const d = extractDates('최종 수정일: 2024년 5월 1일')
    expect(d.effectiveAt).toBeUndefined()
    expect(d.revisedAt).toBe('2024-05-01')
  })
  it('라벨 없는 선두 날짜는 leadingDate 옵션일 때만 시행일로', () => {
    const text = '2026. 6. 17. \n제1조 (목적)'
    expect(extractDates(text).effectiveAt).toBeUndefined()
    expect(extractDates(text, { leadingDate: true }).effectiveAt).toBe('2026-06-17')
  })
  it('날짜가 없으면 아무것도 채우지 않는다', () => {
    expect(extractDates('본문에 날짜가 없습니다').effectiveAt).toBeUndefined()
  })
})

describe('sectionsOf (§68)', () => {
  it('제N조 경계로 분할', () => {
    const s = sectionsOf('제1조 (목적)\n본문 1\n제2조 (정의)\n본문 2')
    expect(s.map((x) => x.identifier)).toEqual(['제1조', '제2조'])
    expect(s[0].content).toBe('본문 1')
  })
  it('부칙을 별도 블록으로 인식', () => {
    const s = sectionsOf('제1조 (목적)\n본문\n부칙 (2026. 9. 1.)\n이 약관은 2026년 9월 1일부터 시행한다.')
    expect(s.at(-1)!.identifier).toBe('부칙')
  })
})

describe('yyyymmdd', () => {
  it('디렉터리 인덱스 키를 ISO 로', () => {
    expect(yyyymmdd('20260327')).toBe('2026-03-27')
  })
})

describe('달력에 없는 날짜 (§69)', () => {
  it('2월 31일 같은 값은 날짜로 치지 않는다', () => {
    expect(yyyymmdd('20260231')).toBeNull()
    expect(yyyymmdd('20261301')).toBeNull()
    expect(yyyymmdd('20260431')).toBeNull()
  })
  it('윤년 2월 29일은 통과한다', () => {
    expect(yyyymmdd('20240229')).toBe('2024-02-29')
    expect(yyyymmdd('20260229')).toBeNull()
  })
  it('없는 날짜는 시행일로 뽑히지 않는다', () => {
    expect(extractDates('이 약관은 2026년 2월 31일부터 시행합니다.').effectiveAt).toBeUndefined()
    expect(extractDates('이 약관은 2026년 2월 28일부터 시행합니다.').effectiveAt).toBe('2026-02-28')
  })
})

describe('조문 분할 (§68)', () => {
  it('목차는 조문으로 세지 않는다 — 뒤에 같은 번호가 본문과 함께 나오면 앞은 목차다', () => {
    const s = sectionsOf('제1조 목적\n제2조 정의\n제1조 (목적)\n이 약관은 …\n제2조 (정의)\n용어의 뜻은 …')
    expect(s.map((x) => x.identifier)).toEqual(['제1조', '제2조'])
    expect(s[0].content).toBe('이 약관은 …')
  })
  it('장 머리는 본문이 없어도 남는다 — 한 번만 나오기 때문이다', () => {
    const s = sectionsOf('제1장 총칙\n제1조 (목적)\n이 약관은 …')
    expect(s.map((x) => x.identifier)).toEqual(['제1장', '제1조'])
    expect(s[0].content).toBe('')
  })
  it('표 안의 법적 근거 인용은 조문 머리가 아니다', () => {
    const s = sectionsOf('제1조 (목적)\n이 방침은 …\n제15조 제1항 제4호\n회원가입\n제15조 제1항 제4호\n정보수정')
    expect(s).toHaveLength(1)
    expect(s[0].identifier).toBe('제1조')
    expect(s[0].content).toContain('회원가입')
  })
  it('제N조 를 안 쓰는 문서는 번호 매김을 조문으로 친다 (카카오·야놀자)', () => {
    const s = sectionsOf('1. 개인정보 수집\n회사는 …\n2. 개인정보 이용\n수집한 정보는 …')
    expect(s.map((x) => x.identifier)).toEqual(['1.', '2.'])
    expect(s[1].title).toBe('개인정보 이용')
  })
  it('조로 짜인 문서에서는 본문의 번호 목록을 조문으로 세지 않는다', () => {
    const s = sectionsOf('제1조 (목적)\n1. 회사는 다음 각 호를 …\n2. 이용자는 …\n제2조 (정의)\n용어의 뜻은 …\n제3조 (효력)\n이 약관은 …')
    expect(s.map((x) => x.identifier)).toEqual(['제1조', '제2조', '제3조'])
    expect(s[0].content).toContain('2. 이용자는 …')
  })
  it('"3개월" 처럼 숫자에 바로 붙은 말은 머리가 아니다', () => {
    const s = sectionsOf('1. 보유기간\n3개월 이내에 파기합니다.')
    expect(s).toHaveLength(1)
    expect(s[0].content).toBe('3개월 이내에 파기합니다.')
  })
})

describe('번호 매김 조문 (§68)', () => {
  it('조문을 한 줄 인용했다고 번호 모드가 꺼지지 않는다', () => {
    const s = sectionsOf('1. 개인정보 수집\n개인정보 보호법 제15조에 따라 …\n2. 개인정보 이용\n수집한 정보는 …')
    expect(s.map((x) => x.identifier)).toEqual(['1.', '2.'])
  })
  it('번호로 시작해도 문장이면 조문 머리가 아니다', () => {
    const s = sectionsOf('1. 보유기간\n2. 회사는 다음 각 호에 해당하는 신청에 대하여는 승낙을 하지 않을 수 있습니다.')
    expect(s).toHaveLength(1)
    expect(s[0].title).toBe('보유기간')
  })
})

describe('표에서 줄이 나뉜 인용 (§68)', () => {
  it('조 번호와 항·호가 다른 칸이면 조문 머리가 아니다', () => {
    const s = sectionsOf('제1조 (목적)\n이 방침은 …\n제2조 (정의)\n용어는 …\n제3조 (수집)\n다음과 같다\n제28조의8\n제1항제3호\n이름, 이메일\n제28조의8\n제1항제3호\n이력서')
    expect(s.map((x) => x.identifier)).toEqual(['제1조', '제2조', '제3조'])
    expect(s.at(-1)!.content).toContain('이력서')
  })
})

describe('목차가 본문 뒤에 오는 문서 (§68)', () => {
  it('앞이든 뒤든 본문 있는 같은 번호가 있으면 빈 것은 목차다', () => {
    const s = sectionsOf('제1조 (목적)\n이 약관은 …\n제2조 (정의)\n용어는 …\n제1조 목적\n제2조 정의')
    expect(s.map((x) => x.identifier)).toEqual(['제1조', '제2조'])
    expect(s.every((x) => x.content)).toBe(true)
  })
  it('번호 뒤 구분점은 제목에서 뗀다 (메가박스)', () => {
    expect(sectionsOf('제1조. 목적\n본 약관은 …')[0].title).toBe('목적')
  })
})
