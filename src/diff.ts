// 조문 diff · 표 행 diff · 규칙 분류 (§25, §27, §28, §68.4). AI 없음.
import { diffLines, diffWords } from 'diff'
import type { Section } from './normalize'
import type { TableBlock } from './extract'

export type ChangeType = 'ADDED' | 'REMOVED' | 'MODIFIED'
export interface ChangeSection { identifier: string; title: string; changeType: ChangeType; beforeText?: string; afterText?: string; importance: number; categories: string[] }
export interface TableRowChange { tableIdentifier: string; rowKey: string; changeType: ChangeType; beforeCells?: string[]; afterCells?: string[]; importance: number; categories: string[] }

// 분류 규칙. 코드에 흩뿌리지 않고 여기 한 표에 둔다 (§28).
const RULES: [string, RegExp, number][] = [
  ['AI_DATA_USAGE', /인공지능|\bAI\b|학습에 이용|모델 학습/, 45],
  ['DATA_SHARING', /제\s*3\s*자|제공받는 자/, 40],
  ['OVERSEAS_TRANSFER', /국외|해외 이전|국외이전/, 40],
  ['PROCESSOR_DELEGATION', /위탁/, 40],
  ['PRICE', /요금|가격|수수료|이용료/, 40],
  ['REFUND', /환불|환급|청약철회/, 35],
  ['PAYMENT', /결제|지급|대금/, 35],
  ['DATA_RETENTION', /보유\s*기간|보관\s*기간|파기/, 30],
  ['SUSPENSION', /이용\s*제한|이용정지|서비스 정지|해지|탈퇴/, 30],
  ['LIABILITY', /면책|손해배상|책임을 지지/, 30],
  ['DISPUTE_RESOLUTION', /관할|중재|분쟁/, 30],
  ['DATA_COLLECTION', /수집\s*항목|수집하는 개인정보|수집·이용/, 25],
  ['SECURITY', /암호화|안전성 확보|보안/, 20],
  ['ACCOUNT', /회원|계정|아이디/, 15],
]

export function classify(changedText: string): { categories: string[]; importance: number } {
  if (!changedText.trim()) return { categories: [], importance: 0 }
  const categories: string[] = []
  let importance = 0
  for (const [cat, re, score] of RULES) if (re.test(changedText)) { categories.push(cat); importance = Math.max(importance, score) }
  if (!categories.length) {
    // 문장부호·공백만 바뀐 오타 수정 (§28: +1), 아니면 OTHER
    const letters = changedText.replace(/[\s\p{P}]/gu, '')
    return letters.length <= 2 ? { categories: ['OTHER'], importance: 1 } : { categories: ['OTHER'], importance: 10 }
  }
  return { categories, importance }
}

/** 바뀐 단어만 모은다 — 분류는 문서 전체가 아니라 변경분에만 건다 */
export function changedWords(before: string, after: string): string {
  return diffWords(before, after).filter((p) => p.added || p.removed).map((p) => p.value).join(' ')
}

export function diffSections(before: Section[], after: Section[]): ChangeSection[] {
  if (!before.length && !after.length) return []
  const key = (s: Section, seen: Map<string, number>) => {
    const n = (seen.get(s.identifier) ?? 0) + 1; seen.set(s.identifier, n)
    return n === 1 ? s.identifier : `${s.identifier}#${n}`
  }
  const a = new Map<string, Section>(), b = new Map<string, Section>()
  const sa = new Map<string, number>(), sb = new Map<string, number>()
  for (const s of before) a.set(key(s, sa), s)
  for (const s of after) b.set(key(s, sb), s)
  const out: ChangeSection[] = []
  for (const [k, s] of b) {
    const prev = a.get(k)
    const full = (x: Section) => [x.title, x.content].filter(Boolean).join('\n')
    if (!prev) out.push({ identifier: k, title: s.title, changeType: 'ADDED', afterText: full(s), ...classify(full(s)) })
    // 분류에는 바뀐 단어와 그 조문의 제목·번호를 같이 넣는다. "90%→전액" 만 보면 환급 조항인 줄 모른다.
    else if (full(prev) !== full(s)) out.push({ identifier: k, title: s.title, changeType: 'MODIFIED', beforeText: full(prev), afterText: full(s), ...classify(`${k} ${s.title}
${changedWords(full(prev), full(s))}`) })
  }
  for (const [k, s] of a) if (!b.has(k)) out.push({ identifier: k, title: s.title, changeType: 'REMOVED', beforeText: [s.title, s.content].filter(Boolean).join('\n'), ...classify(s.content) })
  return out
}

/** 조문 구조를 못 잡은 문서의 폴백: 줄 단위 diff 덩어리를 ¶ 섹션으로 낸다 (§26) */
export function diffParagraphs(before: string, after: string): ChangeSection[] {
  const out: ChangeSection[] = []
  let removed = ''
  let n = 0
  for (const part of diffLines(before, after)) {
    if (part.removed) { removed = part.value; continue }
    if (part.added) {
      n++
      const type: ChangeType = removed ? 'MODIFIED' : 'ADDED'
      out.push({ identifier: `¶${n}`, title: '', changeType: type, beforeText: removed || undefined, afterText: part.value, ...classify(removed ? changedWords(removed, part.value) : part.value) })
      removed = ''
    } else if (removed) {
      n++
      out.push({ identifier: `¶${n}`, title: '', changeType: 'REMOVED', beforeText: removed, ...classify(removed) })
      removed = ''
    }
  }
  if (removed) out.push({ identifier: `¶${n + 1}`, title: '', changeType: 'REMOVED', beforeText: removed, ...classify(removed) })
  return out
}

const HIGH_VALUE_TABLE = /위탁|제\s*3\s*자|국외/

export function diffTables(before: TableBlock[], after: TableBlock[]): TableRowChange[] {
  const out: TableRowChange[] = []
  const rowKey = (r: string[]) => (r[0] ?? '').replace(/\s+/g, ' ').trim()
  const tableKey = (t: TableBlock, i: number) => t.identifier || t.headers.join('/') || `table#${i}`
  const bmap = new Map(before.map((t, i) => [tableKey(t, i), t]))
  const amap = new Map(after.map((t, i) => [tableKey(t, i), t]))
  for (const [k, ta] of amap) {
    const tb = bmap.get(k)
    const prevRows = new Map((tb?.rows ?? []).map((r) => [rowKey(r), r]))
    const nextRows = new Map(ta.rows.map((r) => [rowKey(r), r]))
    const boost = HIGH_VALUE_TABLE.test(k + ' ' + ta.headers.join(' ')) ? 45 : 0
    for (const [rk, r] of nextRows) {
      const p = prevRows.get(rk)
      if (!p) { const c = classify(r.join(' ')); out.push({ tableIdentifier: k, rowKey: rk, changeType: 'ADDED', afterCells: r, categories: c.categories, importance: Math.max(c.importance, boost) }) }
      else if (p.join('') !== r.join('')) { const c = classify(changedWords(p.join(' '), r.join(' '))); out.push({ tableIdentifier: k, rowKey: rk, changeType: 'MODIFIED', beforeCells: p, afterCells: r, categories: c.categories, importance: Math.max(c.importance, boost ? 30 : 0) }) }
    }
    for (const [rk, r] of prevRows) if (!nextRows.has(rk)) { const c = classify(r.join(' ')); out.push({ tableIdentifier: k, rowKey: rk, changeType: 'REMOVED', beforeCells: r, categories: c.categories, importance: Math.max(c.importance, boost ? 30 : 0) }) }
  }
  return out
}

export function summarize(sections: ChangeSection[], rows: TableRowChange[]): { importance: number; categories: string[] } {
  const all = [...sections, ...rows]
  return {
    importance: all.reduce((m, x) => Math.max(m, x.importance), 0),
    categories: [...new Set(all.flatMap((x) => x.categories))],
  }
}
