// 조항 평가와 서비스 등급 (ToS;DR 방식). DB 를 만지지 않는 순수 함수라 라우트와 테스트가 같은 규칙을 쓴다.
//
// ToS;DR 은 조항마다 이용자에게 유리한지 불리한지를 사람이 판정하고, 그 점수를 합해 서비스를 A~E 로 매긴다.
// 여기도 같다 — 다만 문턱값은 우리 것이다. ToS;DR 의 점수표를 그대로 옮긴 것이 아니다.
//
// 등급을 매기지 않는 경우가 있다는 점이 중요하다. 조항 두어 개만 보고 "이 서비스는 E" 라고 쓰면
// 평가가 아니라 낙인이다. 승인된 평가가 서로 다른 조문 MIN_CLAUSES 개는 되어야 등급이 나온다.

import type { Section } from './normalize'

export type Verdict = 'GOOD' | 'BAD' | 'NEUTRAL'
export type Grade = 'A' | 'B' | 'C' | 'D' | 'E'

export interface Rating { identifier: string; category: string; verdict: Verdict; weight: number }

/** 등급이 나오려면 필요한 서로 다른 조문 수. 한 조문에 몇 사람이 붙어도 조문 하나로 센다. */
export const MIN_CLAUSES = 3
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

const sign = (v: Verdict) => (v === 'GOOD' ? 1 : v === 'BAD' ? -1 : 0)
const clampWeight = (n: number) => Math.min(MAX_WEIGHT, Math.max(1, Math.round(n) || 1))

/**
 * 승인된 평가만 넣는다.
 *
 * 조문 하나를 여러 사람이 매길 수 있다. 사람 수만큼 그대로 세면 한 조문이 등급을 통째로 끌고 간다 —
 * 세 사람이 제12조 하나에 "불리 3" 을 주면 나머지 조문을 하나도 안 보고 E 가 나왔다. 그래서 두 단이다:
 * 먼저 조문 안에서 합의를 내고(판정의 평균, 의견이 갈리면 서로 지운다), 그다음 조문끼리 무게로 섞는다.
 * 조문의 무게는 그 조문에 매겨진 무게 중 가장 큰 것이다 — 한 사람이라도 "이건 중대하다" 고 보면 무겁다.
 *
 * 점수는 -1~1 이라 평가 수가 많다고 등급이 극단으로 가지 않는다. 중립은 점수에 0 이지만 무게는 세므로,
 * 중립이 많으면 등급이 가운데로 끌린다 — 그게 맞다.
 */
export function scoreOf(ratings: Rating[]): { score: number; grade: Grade | null; n: number } {
  const byClause = new Map<string, Rating[]>()
  for (const r of ratings) byClause.set(r.identifier, [...(byClause.get(r.identifier) ?? []), r])
  const n = byClause.size
  if (n < MIN_CLAUSES) return { score: 0, grade: null, n }
  let total = 0
  let mass = 0
  for (const rs of byClause.values()) {
    const weight = Math.max(...rs.map((r) => clampWeight(r.weight)))
    const consensus = rs.reduce((s, r) => s + sign(r.verdict), 0) / rs.length
    total += consensus * weight
    mass += weight
  }
  const score = mass ? total / mass : 0
  const grade: Grade = score >= 0.5 ? 'A' : score >= 0.2 ? 'B' : score > -0.2 ? 'C' : score > -0.5 ? 'D' : 'E'
  return { score, grade, n }
}

/** 제보·평가 폼이 받은 값을 믿지 않는다. 서버가 아는 값만 통과시킨다. */
export const isVerdict = (v: string): v is Verdict => v === 'GOOD' || v === 'BAD' || v === 'NEUTRAL'
export const parseWeight = (v: string) => clampWeight(Number(v))

// ── 자동 점검 (§28 의 분류 규칙과 같은 자리, 다른 목적) ──────────
//
// 등급은 사람이 매긴다. 그런데 문서가 95건이고 조문은 문서마다 수십 개라, 사람이 어디를 볼지 모르면
// 아무 평가도 안 나온다 — 실제로 승인된 평가가 0건이라 등급이 붙은 문서가 하나도 없었다.
// 그래서 "여기를 보라" 까지만 기계가 한다. 아래 규칙에 걸린 조문은 확인이 필요한 후보로 표시되고,
// 점수에도 등급에도 들어가지 않는다. 판정은 사람이 낸다.
//
// 규칙은 약관규제법 제6조~제14조가 무효로 보는 조항 유형과, 개인정보 처리방침에서 이용자가
// 실제로 놀라는 항목(국외 이전·AI 학습·보유기간)에서 왔다. 걸렸다고 위법이 아니다 —
// 자동 갱신이나 국외 이전은 적법하게 고지된 것일 수 있다. 문구가 거기 있다는 사실만 말한다.

export interface Flag { identifier: string; title: string; rule: string; note: string; category: string; excerpt: string }

const FLAG_RULES: { rule: string; note: string; category: string; re: RegExp }[] = [
  { rule: '사전 통지 없는 변경', note: '약관을 바꾸면서 개별 통지를 하지 않겠다는 문구입니다', category: 'ACCOUNT',
    re: /사전\s*(고지|통지|공지)\s*(없이|없는|하지\s*아니|하지\s*않)|개별\s*(통지|고지)\s*(없이|하지\s*않)|통지\s*없이\s*변경/ },
  { rule: '회사의 일방적 해지·이용정지', note: '회사가 사유를 정하지 않고 계약을 끊거나 이용을 막을 수 있는 문구입니다', category: 'SUSPENSION',
    re: /회사(는|가)[^\n]{0,60}(임의로|일방적으로|자체\s*판단|사전\s*통지\s*없이)[^\n]{0,40}(해지|해제|이용\s*제한|이용정지|중지|정지)/ },
  { rule: '포괄 면책', note: '책임의 범위를 정하지 않고 일체의 책임을 지지 않겠다는 문구입니다', category: 'LIABILITY',
    re: /일체의\s*책임을\s*지지\s*아니|일체의\s*책임을\s*지지\s*않|어떠한\s*책임도\s*(부담하지|지지)\s*않|책임을\s*부담하지\s*아니/ },
  { rule: '손해배상 한도 제한', note: '배상액의 상한을 미리 정해 두는 문구입니다', category: 'LIABILITY',
    re: /손해배상[^\n]{0,40}(한도|상한|초과하지|제한)|(직접|통상)\s*손해[^\n]{0,30}(한한다|한정)/ },
  { rule: '환불·청약철회 제한', note: '환불을 하지 않거나 철회를 제한하는 문구입니다', category: 'REFUND',
    re: /환불(이|은|을)?\s*(불가|되지\s*않|하지\s*않|되지\s*아니)|반환하지\s*(않|아니)|청약\s*철회[^\n]{0,30}(제한|불가|할\s*수\s*없)/ },
  { rule: '자동 갱신·자동 결제', note: '이용자가 따로 알리지 않으면 결제가 이어지는 문구입니다', category: 'PAYMENT',
    re: /자동\s*(갱신|연장|결제|재결제)|정기\s*결제[^\n]{0,20}(갱신|연장)/ },
  { rule: '전속 관할 합의', note: '분쟁이 나면 특정 법원으로만 가도록 미리 정하는 문구입니다', category: 'DISPUTE_RESOLUTION',
    re: /전속(적)?\s*(합의)?\s*관할|관할\s*법원으로\s*(한다|합니다)|본사\s*소재지[^\n]{0,20}관할/ },
  { rule: '게시물 포괄 이용허락', note: '이용자가 올린 글·사진을 회사가 넓게 쓸 수 있게 하는 문구입니다', category: 'OTHER',
    re: /(게시물|콘텐츠|저작물)[^\n]{0,60}(무상|무료|무상으로)[^\n]{0,30}(사용|이용)|2차적\s*저작물[^\n]{0,30}(작성|이용)/ },
  { rule: '마케팅·광고 활용', note: '수집한 정보를 광고나 마케팅에 쓰겠다는 문구입니다', category: 'DATA_COLLECTION',
    re: /광고성\s*정보|마케팅[^\n]{0,20}(활용|이용|목적)|맞춤형\s*광고/ },
  { rule: 'AI 학습 이용', note: '이용자 데이터를 모델 학습에 쓰겠다는 문구입니다', category: 'AI_DATA_USAGE',
    re: /인공지능|\bAI\b|모델\s*(학습|훈련)|학습에\s*(이용|활용)/ },
  { rule: '국외 이전', note: '개인정보가 국외로 넘어가는 항목입니다', category: 'OVERSEAS_TRANSFER',
    re: /국외\s*(이전|제공|저장|처리)|해외\s*이전|국외이전/ },
  { rule: '기한 없는 보유', note: '보유 기간을 기한이 아니라 회사 판단으로 두는 문구입니다', category: 'DATA_RETENTION',
    re: /영구(적으로)?\s*(보관|보유)|기한\s*없이\s*(보관|보유)|필요한\s*기간\s*동안\s*보관/ },
]

/** 한 문서에 붙일 수 있는 최대 후보 수. 긴 처리방침에서 화면이 후보로 덮이지 않게 자른다. */
export const MAX_FLAGS = 24

/**
 * 현행 본문의 조문을 규칙표에 대 본다. 조문 하나에 규칙 하나가 한 번만 걸린다.
 * `rated` 에 든 조문은 이미 사람이 본 것이므로 후보에서 뺀다.
 */
export function flagClauses(sections: Section[], rated: Iterable<string> = []): Flag[] {
  const done = new Set(rated)
  const out: Flag[] = []
  for (const s of sections) {
    if (done.has(s.identifier) || out.length >= MAX_FLAGS) continue
    const text = [s.title, s.content].filter(Boolean).join('\n')
    for (const r of FLAG_RULES) {
      const m = r.re.exec(text)
      if (!m) continue
      out.push({ identifier: s.identifier, title: s.title, rule: r.rule, note: r.note, category: r.category, excerpt: sentenceAt(text, m.index, m[0].length) })
      if (out.length >= MAX_FLAGS) break
    }
  }
  return out
}

/** 걸린 자리가 든 문장 하나를 뽑는다. 조문 전체를 실으면 후보 목록이 본문이 된다. */
function sentenceAt(text: string, at: number, len: number, cap = 160): string {
  const start = Math.max(0, text.lastIndexOf('\n', at) + 1)
  const nl = text.indexOf('\n', at + len)
  const line = text.slice(start, nl === -1 ? text.length : nl).trim()
  if (line.length <= cap) return line
  // 줄이 길면 걸린 자리를 가운데 두고 자른다.
  const rel = at - start
  const from = Math.max(0, Math.min(rel - cap / 3, line.length - cap))
  return (from > 0 ? '… ' : '') + line.slice(from, from + cap).trim() + (from + cap < line.length ? ' …' : '')
}
