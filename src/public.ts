// D-1 (§67.2): 공개 표면은 diff 조각 + 제한된 발췌 + 원문 링크뿐이다. 전체 본문을 내보내는 공개 경로는 없다.
import type { Section } from './normalize'
import type { VersionRow } from './db'
import { diffWords } from 'diff'

export const EXCERPT_CAP = 800
export const DOCUMENT_SHARE_CAP = 0.2

export function excerpt(text: string | undefined, cap = EXCERPT_CAP): string | undefined {
  if (text == null) return undefined
  return text.length <= cap ? text : text.slice(0, cap) + ' …'
}

export interface PublicSection { identifier: string; title: string; excerpt: string; truncated: boolean }

/** 버전 조회 공개용: 메타데이터 + 조문 식별자 + 발췌. 조문당 800자, 문서 전체의 20% 를 넘지 않는다. */
export function shapeVersion(v: VersionRow, sections: Section[]) {
  const budget = Math.floor(v.normalized_text.length * DOCUMENT_SHARE_CAP)
  let used = 0
  const out: PublicSection[] = []
  for (const s of sections) {
    const room = Math.min(EXCERPT_CAP, budget - used)
    const body = s.content
    if (room <= 0) { out.push({ identifier: s.identifier, title: s.title, excerpt: '', truncated: body.length > 0 }); continue }
    const ex = body.slice(0, room)
    used += ex.length
    out.push({ identifier: s.identifier, title: s.title, excerpt: ex, truncated: body.length > ex.length })
  }
  const { normalized_text: _hidden, ...meta } = v
  return { ...meta, textLength: v.normalized_text.length, sections: out }
}

/**
 * 변경 지점 중심 발췌. 조문이 길면 앞에서 800자를 자르는 방식으로는 변경이 화면 밖으로 밀린다
 * (토스 제33조 실측). 바뀐 구간과 그 앞뒤 문맥만 남기고 나머지는 접는다.
 */
export function focusOnChange(before: string, after: string, context = 160, cap = EXCERPT_CAP): { before: string; after: string } {
  const parts = diffWords(before, after)
  const b: string[] = []
  const a: string[] = []
  let usedB = 0
  let usedA = 0
  let dropped = false
  parts.forEach((p, i) => {
    const prevChanged = i > 0 && (parts[i - 1].added || parts[i - 1].removed)
    const nextChanged = i + 1 < parts.length && (parts[i + 1].added || parts[i + 1].removed)
    if (p.added || p.removed) {
      const v = p.value.slice(0, cap)
      if (p.removed) { b.push(v); usedB += v.length } else { a.push(v); usedA += v.length }
      return
    }
    // 변경에 인접한 문맥만 남긴다. 양쪽 다 아니면 통째로 접는다.
    let v = p.value
    if (v.length > context * 2) {
      const head = prevChanged ? v.slice(0, context) : ''
      const tail = nextChanged ? v.slice(-context) : ''
      v = [head, tail].filter(Boolean).join(' … ') || (i === 0 || i === parts.length - 1 ? '' : ' … ')
      if (!head && !tail) v = ' … '
    }
    if (usedB + v.length <= cap) { b.push(v); usedB += v.length } else dropped = true
    if (usedA + v.length <= cap) { a.push(v); usedA += v.length } else dropped = true
  })
  // 상한에 걸려 뒤를 버렸으면 그렇게 보여야 한다. 문장이 그냥 끊긴 것처럼 두지 않는다.
  // 말줄임을 붙이느라 상한을 넘기지는 않는다 (D-1, §67.2).
  const tail = (s: string) =>
    dropped && s && !s.trimEnd().endsWith('…') ? s.slice(0, cap - 2).trimEnd() + ' …' : s
  return { before: tail(b.join('')), after: tail(a.join('')) }
}
