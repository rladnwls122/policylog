// D-1 (§67.2): 공개 표면은 diff 조각 + 제한된 발췌 + 원문 링크뿐이다. 전체 본문을 내보내는 공개 경로는 없다.
import type { Section } from './normalize'
import type { VersionRow } from './db'

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
