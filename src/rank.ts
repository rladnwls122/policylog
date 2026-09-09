// 홈 화면의 순서를 정하는 순수 함수들. DB 를 만지지 않으므로 라우트와 테스트가 같은 규칙을 쓴다.
import type { DocumentRow, ChangeListRow } from './db'

export interface Signals {
  /** 문서별 최근 7일 조회수 */
  views: Map<string, number>
  /** 문서별 보존 버전 수와 가장 오래된 버전 */
  counts: Map<string, { n: number; oldest: string }>
  /** 문서별 가장 최근 변경 */
  latest: Map<string, ChangeListRow>
  /** 회원의 관심 문서 id. 비회원이면 없다 — 카드의 별이 로그인으로 간다 */
  watched?: Set<string>
}

/** 변경의 날짜 키. 시행일이 있으면 시행일, 없으면 감지일. 변경이 없으면 빈 문자열이라 정렬에서 뒤로 간다. */
export const changeDate = (c?: ChangeListRow) => (c ? c.effective_at ?? c.observed_at.slice(0, 10) : '')

const statusRank = (d: DocumentRow) => (d.status === 'ACTIVE' ? 0 : d.status === 'PENDING_RENDER' ? 1 : 2)

/**
 * "이번 주 조회 상위 기업" 세 장. 조회수 내림차순, 같으면 최근 변경이 새로운 순, 그다음 보존 버전이 많은 순.
 * 조회 기록이 아직 없어도 세 장은 채워진다 — 빈 상단은 화면을 죽인다.
 * 한 기업은 한 장만. 수집 중(ACTIVE)인 문서만 후보다 — 못 가져오는 문서를 "상위" 로 세우지 않는다.
 */
export function rankFeatured(docs: DocumentRow[], s: Signals, n = 3): DocumentRow[] {
  const sorted = docs
    .filter((d) => d.status === 'ACTIVE')
    .sort((a, b) =>
      (s.views.get(b.id) ?? 0) - (s.views.get(a.id) ?? 0) ||
      changeDate(s.latest.get(b.id)).localeCompare(changeDate(s.latest.get(a.id))) ||
      (s.counts.get(b.id)?.n ?? 0) - (s.counts.get(a.id)?.n ?? 0) ||
      a.service_name.localeCompare(b.service_name, 'ko'))
  const out: DocumentRow[] = []
  const seen = new Set<string>()
  for (const d of sorted) {
    if (seen.has(d.service)) continue
    seen.add(d.service)
    out.push(d)
    if (out.length >= n) break
  }
  return out
}

/** 비회원에게 보여주는 카드 수. 나머지는 가입해야 보인다 — 상위 세 장은 누구에게나 보인다. */
export const PREVIEW_CARDS = 6

/** 하단 그리드 순서. 수집 중 → 준비 중 → 못 가져옴, 같은 상태 안에서는 최근 변경이 새로운 순. */
export function orderForGrid(docs: DocumentRow[], s: Signals): DocumentRow[] {
  return [...docs].sort((a, b) =>
    statusRank(a) - statusRank(b) ||
    changeDate(s.latest.get(b.id)).localeCompare(changeDate(s.latest.get(a.id))) ||
    (s.counts.get(b.id)?.n ?? 0) - (s.counts.get(a.id)?.n ?? 0) ||
    a.service_name.localeCompare(b.service_name, 'ko'))
}

export interface ServiceGroup { service: string; serviceName: string; docs: DocumentRow[] }

/**
 * 같은 기업의 문서를 한 묶음으로 만든다. 한 기업이 이용약관과 처리방침을 따로 두는 것은 그 기업의 사정이지
 * 보는 사람의 사정이 아니다 — 찾을 때는 기업 하나로 보이고, 고를 때 문서를 고른다.
 * 묶음의 자리는 그 안에서 가장 앞선 문서의 자리다 (orderForGrid 를 그대로 따른다).
 */
export function groupByService(docs: DocumentRow[], s: Signals): ServiceGroup[] {
  const out: ServiceGroup[] = []
  const at = new Map<string, ServiceGroup>()
  for (const d of orderForGrid(docs, s)) {
    const g = at.get(d.service)
    if (g) { g.docs.push(d); continue }
    const made = { service: d.service, serviceName: d.service_name, docs: [d] }
    at.set(d.service, made)
    out.push(made)
  }
  return out
}

const TYPE_WORDS: Record<string, string[]> = {
  TERMS: ['약관', '이용약관', 'terms'],
  PRIVACY: ['개인정보', '처리방침', '개인정보처리방침', 'privacy'],
}

/** 검색용 문자열. 카드의 data-q 와 서버 검색이 같은 값을 쓴다. 소문자, 공백 제거. */
export const searchKey = (d: Pick<DocumentRow, 'service' | 'service_name' | 'title' | 'type' | 'id'>) =>
  [d.service_name, d.title, d.service, d.id, ...(TYPE_WORDS[d.type] ?? [])].join(' ').toLowerCase().replace(/\s+/g, '')

/** 낱말 전부가 걸려야 한다. "카카오 개인정보" 는 카카오 처리방침 하나만 돌려준다. */
export function matchDocuments<T extends Pick<DocumentRow, 'service' | 'service_name' | 'title' | 'type' | 'id'>>(docs: T[], q: string): T[] {
  const terms = q.toLowerCase().split(/\s+/).filter(Boolean)
  if (!terms.length) return []
  return docs.filter((d) => { const k = searchKey(d); return terms.every((t) => k.includes(t)) })
}
