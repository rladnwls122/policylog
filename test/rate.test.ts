import { describe, it, expect } from 'vitest'
import { scoreOf, flagClauses, MIN_CLAUSES, MAX_FLAGS, parseWeight, isVerdict, type Rating } from '../src/rate'
import type { Section } from '../src/normalize'

const r = (identifier: string, verdict: Rating['verdict'], weight = 1): Rating => ({ identifier, category: 'OTHER', verdict, weight })
/** 서로 다른 조문 n 개에 같은 판정을 매긴다. */
const many = (n: number, verdict: Rating['verdict'], weight = 1) =>
  Array.from({ length: n }, (_, i) => r(`제${i + 1}조`, verdict, weight))

describe('조항 평가 등급 (ToS;DR 방식)', () => {
  it('평가가 모자라면 등급을 매기지 않는다 — 두어 개로 낙인 찍지 않는다', () => {
    expect(scoreOf(many(2, 'BAD')).grade).toBeNull()
    expect(scoreOf([]).grade).toBeNull()
    expect(scoreOf(many(MIN_CLAUSES, 'BAD')).grade).not.toBeNull()
  })
  it('한 조문에 여러 사람이 붙어도 조문 하나로 센다', () => {
    // 세 사람이 같은 조문에 "불리 3" 을 주면 예전에는 등급이 E 로 나왔다. 조문 하나를 본 것뿐이다.
    const one = [r('제12조', 'BAD', 3), r('제12조', 'BAD', 3), r('제12조', 'BAD', 3)]
    expect(scoreOf(one).n).toBe(1)
    expect(scoreOf(one).grade).toBeNull()
  })
  it('한 조문 안에서 의견이 갈리면 서로 지운다', () => {
    const out = scoreOf([r('제1조', 'BAD'), r('제1조', 'GOOD'), r('제2조', 'BAD'), r('제3조', 'BAD')])
    expect(out.n).toBe(3)
    expect(out.score).toBeCloseTo(-2 / 3)
  })
  it('조문의 무게는 그 조문에 매겨진 것 중 가장 큰 것이다', () => {
    // 한 사람이라도 "이건 중대하다" 고 보면 그 조문은 무겁게 센다.
    const heavy = scoreOf([r('제1조', 'BAD', 1), r('제1조', 'BAD', 3), r('제2조', 'GOOD', 1), r('제3조', 'GOOD', 1)])
    expect(heavy.score).toBeCloseTo(-1 / 5)
  })
  it('불리한 조항만 있으면 E, 유리한 것만 있으면 A', () => {
    expect(scoreOf(many(4, 'BAD')).grade).toBe('E')
    expect(scoreOf(many(4, 'GOOD')).grade).toBe('A')
  })
  it('반반이면 가운데', () => {
    expect(scoreOf([r('제1조', 'GOOD'), r('제2조', 'GOOD'), r('제3조', 'BAD'), r('제4조', 'BAD')]).grade).toBe('C')
  })
  it('중립은 점수에 0 이지만 무게는 세므로 등급을 덜 극단으로 끈다', () => {
    expect(scoreOf(many(3, 'BAD')).grade).toBe('E')
    expect(scoreOf([r('제1조', 'BAD'), r('제2조', 'NEUTRAL'), r('제3조', 'NEUTRAL'), r('제4조', 'NEUTRAL')]).grade).toBe('D')
  })
  it('무게가 큰 불리 조항 하나가 가벼운 유리 여럿을 이긴다', () => {
    expect(scoreOf([r('제1조', 'BAD', 3), r('제2조', 'GOOD'), r('제3조', 'GOOD')]).grade).toBe('D')
    expect(scoreOf([r('제1조', 'BAD', 3), r('제2조', 'BAD', 3), r('제3조', 'GOOD')]).grade).toBe('E')
  })
  it('평가 수가 늘어도 등급이 극단으로 가지 않는다 — 무게 합으로 나눈다', () => {
    expect(scoreOf(many(50, 'BAD')).score).toBe(-1)
    expect(scoreOf(many(3, 'BAD')).score).toBe(-1)
  })
  it('폼이 보낸 값을 믿지 않는다', () => {
    expect(parseWeight('9')).toBe(3)
    expect(parseWeight('0')).toBe(1)
    expect(parseWeight('없음')).toBe(1)
    expect(isVerdict('GOOD')).toBe(true)
    expect(isVerdict('DROP TABLE')).toBe(false)
  })
})

describe('자동 점검 — 사람이 볼 자리를 고른다', () => {
  const S = (identifier: string, title: string, content: string): Section => ({ identifier, title, content })

  it('약관규제법이 무효로 보는 유형의 문구를 후보로 짚는다', () => {
    const flags = flagClauses([
      S('제3조', '약관의 개정', '회사는 사전 통지 없이 본 약관을 변경할 수 있습니다.'),
      S('제20조', '면책', '회사는 무료 서비스 이용과 관련하여 일체의 책임을 지지 않습니다.'),
      S('제24조', '관할', '본 약관에 관한 분쟁은 회사 본점 소재지를 전속 관할 법원으로 합니다.'),
    ])
    expect(flags.map((f) => f.rule)).toEqual(['사전 통지 없는 변경', '포괄 면책', '전속 관할 합의'])
    expect(flags[0].identifier).toBe('제3조')
  })
  it('걸린 문장만 싣는다 — 조문 전체를 싣지 않는다', () => {
    const long = '앞줄입니다.\n' + '가'.repeat(400) + '\n회사는 사전 통지 없이 약관을 변경합니다.'
    const [f] = flagClauses([S('제3조', '개정', long)])
    expect(f.excerpt).toContain('사전 통지 없이')
    expect(f.excerpt.length).toBeLessThan(200)
  })
  it('사람이 이미 평가한 조문은 후보에서 뺀다', () => {
    const secs = [S('제20조', '면책', '회사는 일체의 책임을 지지 않습니다.')]
    expect(flagClauses(secs)).toHaveLength(1)
    expect(flagClauses(secs, ['제20조'])).toHaveLength(0)
  })
  it('평범한 조문은 걸리지 않는다', () => {
    expect(flagClauses([S('제1조', '목적', '이 약관은 서비스 이용 조건을 정함을 목적으로 합니다.')])).toEqual([])
  })
  it('긴 문서에서도 후보가 화면을 덮지 않는다', () => {
    const secs = Array.from({ length: 100 }, (_, i) => S(`제${i + 1}조`, '면책', '회사는 일체의 책임을 지지 않습니다.'))
    expect(flagClauses(secs)).toHaveLength(MAX_FLAGS)
  })
})
