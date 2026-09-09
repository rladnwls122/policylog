import { describe, it, expect } from 'vitest'
import { scoreOf, MIN_RATINGS, parseWeight, isVerdict, type Rating } from '../src/rate'

const r = (verdict: Rating['verdict'], weight = 1): Rating => ({ identifier: '제1조', category: 'OTHER', verdict, weight })

describe('조항 평가 등급 (ToS;DR 방식)', () => {
  it('평가가 모자라면 등급을 매기지 않는다 — 두어 개로 낙인 찍지 않는다', () => {
    expect(scoreOf([r('BAD'), r('BAD')]).grade).toBeNull()
    expect(scoreOf([]).grade).toBeNull()
    expect(scoreOf(Array(MIN_RATINGS).fill(r('BAD'))).grade).not.toBeNull()
  })
  it('불리한 조항만 있으면 E, 유리한 것만 있으면 A', () => {
    expect(scoreOf(Array(4).fill(r('BAD'))).grade).toBe('E')
    expect(scoreOf(Array(4).fill(r('GOOD'))).grade).toBe('A')
  })
  it('반반이면 가운데', () => {
    expect(scoreOf([r('GOOD'), r('GOOD'), r('BAD'), r('BAD')]).grade).toBe('C')
  })
  it('중립은 점수에 0 이지만 무게는 세므로 등급을 덜 극단으로 끈다', () => {
    // 불리한 것만 셋이면 -1 로 E 다. 같은 불리 하나에 중립 셋이 붙으면 -0.25 로 D 가 된다.
    expect(scoreOf([r('BAD'), r('BAD'), r('BAD')]).grade).toBe('E')
    expect(scoreOf([r('BAD'), r('NEUTRAL'), r('NEUTRAL'), r('NEUTRAL')]).grade).toBe('D')
  })
  it('무게가 큰 불리 조항 하나가 가벼운 유리 여럿을 이긴다', () => {
    // 불리 3 + 유리 1 + 유리 1 = -1, 무게 합 5 → -0.2 로 D. 유리가 둘이어도 무게가 모자라면 못 이긴다.
    expect(scoreOf([r('BAD', 3), r('GOOD'), r('GOOD')]).grade).toBe('D')
    expect(scoreOf([r('BAD', 3), r('BAD', 3), r('GOOD')]).grade).toBe('E')
  })
  it('평가 수가 늘어도 등급이 극단으로 가지 않는다 — 무게 합으로 나눈다', () => {
    expect(scoreOf(Array(50).fill(r('BAD'))).score).toBe(-1)
    expect(scoreOf(Array(3).fill(r('BAD'))).score).toBe(-1)
  })
  it('폼이 보낸 값을 믿지 않는다', () => {
    expect(parseWeight('9')).toBe(3)
    expect(parseWeight('0')).toBe(1)
    expect(parseWeight('없음')).toBe(1)
    expect(isVerdict('GOOD')).toBe(true)
    expect(isVerdict('DROP TABLE')).toBe(false)
  })
})
