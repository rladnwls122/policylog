// 공개 표면의 모양을 잡는다. 조문 본문은 그대로 내보내고, 원본 스냅샷(raw)만 관리자 뒤에 남는다.
import type { Section } from './normalize'
import type { VersionRow } from './db'
import { diffWords } from 'diff'

/** 카드처럼 자리가 좁은 곳에서만 쓴다. cap 은 화면 사정이지 공개 정책이 아니다. */
export function excerpt(text: string | undefined, cap: number): string | undefined {
  if (text == null) return undefined
  return text.length <= cap ? text : text.slice(0, cap) + ' …'
}

export interface PublicSection { identifier: string; title: string; text: string }

/** 버전 조회 공개용: 메타데이터 + 조문 단위 본문. normalized_text 통짜는 내보내지 않고 조문으로 쪼개 준다. */
export function shapeVersion(v: VersionRow, sections: Section[]) {
  const out: PublicSection[] = sections.map((s) => ({ identifier: s.identifier, title: s.title, text: s.content }))
  const { normalized_text: _hidden, ...meta } = v
  return { ...meta, textLength: v.normalized_text.length, sections: out }
}

/**
 * 변경 지점 중심으로 접는다. 긴 조문에서 안 바뀐 문단까지 다 펴 두면 변경이 화면 밖으로 밀린다
 * (토스 제33조 실측). 바뀐 구간과 그 앞뒤 문맥만 남기고 나머지는 ' … ' 로 접는다.
 * cap 은 카드처럼 자리가 좁은 곳에서만 준다. 기본은 안 자른다.
 */
export function focusOnChange(before: string, after: string, context = 160, cap = Infinity): { before: string; after: string } {
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
  const tail = (s: string) =>
    dropped && s && !s.trimEnd().endsWith('…') ? s.slice(0, cap - 2).trimEnd() + ' …' : s
  return { before: tail(b.join('')), after: tail(a.join('')) }
}
