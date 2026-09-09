// 조항 평가와 서비스 등급 (ToS;DR 방식). DB 를 만지지 않는 순수 함수라 라우트와 테스트가 같은 규칙을 쓴다.
//
// ToS;DR 은 조항마다 이용자에게 유리한지 불리한지를 사람이 판정하고, 그 점수를 합해 서비스를 A~E 로 매긴다.
// 여기도 같다 — 다만 문턱값은 우리 것이다. ToS;DR 의 점수표를 그대로 옮긴 것이 아니다.
//
// 등급을 매기지 않는 경우가 있다는 점이 중요하다. 조항 두어 개만 보고 "이 서비스는 E" 라고 쓰면
// 평가가 아니라 낙인이다. 승인된 평가가 MIN_RATINGS 개는 되어야 등급이 나온다.

export type Verdict = 'GOOD' | 'BAD' | 'NEUTRAL'
export type Grade = 'A' | 'B' | 'C' | 'D' | 'E'

export interface Rating { identifier: string; category: string; verdict: Verdict; weight: number }

/** 등급이 나오려면 필요한 승인된 평가 수. 이보다 적으면 등급 없이 평가만 보인다. */
export const MIN_RATINGS = 3
/** 무게는 1~3. 3 은 "이 조항 하나로 서비스를 고를 만하다" 는 뜻이다. */
export const MAX_WEIGHT = 3

export const VERDICT_LABEL: Record<Verdict, string> = { GOOD: '이용자에게 유리', BAD: '이용자에게 불리', NEUTRAL: '중립' }
export const GRADE_NOTE: Record<Grade, string> = {
  A: '이용자에게 유리한 조항이 뚜렷하게 많습니다',
  B: '대체로 이용자에게 유리합니다',
  C: '유리한 조항과 불리한 조항이 비슷합니다',
  D: '이용자에게 불리한 조항이 더 많습니다',
  E: '이용자에게 불리한 조항이 뚜렷하게 많습니다',
}

const point = (r: Rating) => (r.verdict === 'GOOD' ? r.weight : r.verdict === 'BAD' ? -r.weight : 0)
const clampWeight = (n: number) => Math.min(MAX_WEIGHT, Math.max(1, Math.round(n) || 1))

/**
 * 승인된 평가만 넣는다. 점수는 무게 합으로 나눈 -1~1 이라 평가 수가 많다고 등급이 극단으로 가지 않는다.
 * 중립은 점수에 0 이지만 무게는 세므로, 중립이 많으면 등급이 가운데로 끌린다 — 그게 맞다.
 */
export function scoreOf(ratings: Rating[]): { score: number; grade: Grade | null; n: number } {
  const n = ratings.length
  if (n < MIN_RATINGS) return { score: 0, grade: null, n }
  const total = ratings.reduce((s, r) => s + point({ ...r, weight: clampWeight(r.weight) }), 0)
  const mass = ratings.reduce((s, r) => s + clampWeight(r.weight), 0)
  const score = mass ? total / mass : 0
  const grade: Grade = score >= 0.5 ? 'A' : score >= 0.2 ? 'B' : score > -0.2 ? 'C' : score > -0.5 ? 'D' : 'E'
  return { score, grade, n }
}

/** 제보·평가 폼이 받은 값을 믿지 않는다. 서버가 아는 값만 통과시킨다. */
export const isVerdict = (v: string): v is Verdict => v === 'GOOD' || v === 'BAD' || v === 'NEUTRAL'
export const parseWeight = (v: string) => clampWeight(Number(v))
