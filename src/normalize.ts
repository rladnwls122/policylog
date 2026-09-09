// 정규화 · 해시 · 빈 DOM 게이트 · 시행일 추출 · 조문 분할.
// NORMALIZATION_PROFILE 은 출력 텍스트가 달라질 수 있는 변경에만 올린다 (§74). 다른 프로필의 해시끼리는 비교하지 않는다.

export const NORMALIZATION_PROFILE = 'v1'
export const PARSER_VERSION = '0.1.0'

export function normalize(raw: string): string {
  return raw
    .normalize('NFC')
    .replace(new RegExp("[" + String.fromCharCode(0xa0, 0x200b, 0xfeff) + "]", "g"), " ")
    .replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xff10 + 0x30)) // 전각 숫자
    .replace(/（/g, '(').replace(/）/g, ')')                                            // 전각 괄호
    .split('\n')
    .map((l) => l.replace(/[ \t]+/g, ' ').trim())
    .filter(Boolean)
    .join('\n')
}

export async function sha256(s: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s))
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

// ── 빈 DOM · 소프트 블록 게이트 (§22) ──────────────────────────
export type GateResult = { ok: true } | { ok: false; reason: string }

export function gate(text: string, previous?: { length: number; hangulRatio: number }): GateResult {
  if (/잠시 후 다시 시도해 주세요|접근이 제한되었습니다|Access Denied|보안 문자를 입력/.test(text.slice(0, 2000)) && text.length < 3000)
    return { ok: false, reason: 'SOFT_BLOCK' }
  if (text.length < 200) return { ok: false, reason: 'EMPTY_DOM' }
  if (sectionsOf(text).length === 0 && text.length < 1000) return { ok: false, reason: 'NO_SECTIONS' }
  const ratio = hangulRatio(text)
  if (previous && previous.hangulRatio > 0.6 && ratio < 0.3) return { ok: false, reason: 'HANGUL_RATIO_DROP' }
  if (previous && text.length < previous.length * 0.2) return { ok: false, reason: 'LENGTH_DROP' }
  return { ok: true }
}

export function hangulRatio(text: string): number {
  const letters = text.replace(/[\s\d\p{P}]/gu, '')
  if (!letters.length) return 0
  return (letters.match(/[가-힣]/g)?.length ?? 0) / letters.length
}

// ── 날짜 (§69) ──────────────────────────────────────────────────
const DATE = /(20\d{2})\s*[.년\-/]\s*(\d{1,2})\s*[.월\-/]\s*(\d{1,2})\s*[.일]?/g

export interface DateCandidates { effectiveAt?: string; announcedAt?: string; revisedAt?: string; all: { date: string; cue: string; phrase: string }[] }

export function extractDates(text: string, opts: { leadingDate?: boolean } = {}): DateCandidates {
  const all: DateCandidates['all'] = []
  const eff: string[] = []
  const ann: string[] = []
  const rev: string[] = []
  for (const m of text.matchAll(DATE)) {
    const iso = toIso(m[1], m[2], m[3])
    if (!iso) continue
    const end = m.index! + m[0].length
    // 창을 구분자에서 끊는다. "공고일자 : 2025년 11월 20일 / 시행일자 : …" 에서 앞 날짜가
    // 뒤 항목의 '시행' 을 주워 시행일로 오분류되는 것을 막는다 (네이버웹툰 실측 패턴).
    const before = cut(text.slice(Math.max(0, m.index! - 30), m.index!), true)
    const after = cut(text.slice(end, end + 20), false)
    // 날짜 뒤의 단서를 먼저 본다 ("…부터 시행됩니다"). 없으면 앞을 본다 ("시행일자 : …").
    // 반대로 하면 "고지하겠습니다. 이 방침은 2026년 7월 7일부터 시행됩니다" 가 공고일로 오분류된다 (당근 실측).
    const cue = cueOf(after) || cueOf(before)
    if (cue === 'announced') ann.push(iso)
    else if (cue === 'effective') eff.push(iso)
    else if (cue === 'revised') rev.push(iso)
    all.push({ date: iso, cue, phrase: `${before}[${m[0]}]${after}` })
  }
  const out: DateCandidates = { all }
  if (eff.length) out.effectiveAt = eff.sort().at(-1)                // 여러 개면 가장 늦은 것 (규칙 3)
  else if (opts.leadingDate && all.length) out.effectiveAt = all[0].date // 라벨 없는 선두 날짜 (규칙 7)
  if (ann.length) out.announcedAt = ann.sort().at(-1)
  if (rev.length) out.revisedAt = rev.sort().at(-1)                  // revisedAt 만 있으면 effectiveAt 을 채우지 않는다 (규칙 4)
  return out
}

/** 구분자에서 창을 자른다. before 면 마지막 구분자 뒤, after 면 첫 구분자 앞. */
function cut(win: string, before: boolean): string {
  const parts = win.split(/[/|·,\n]|(?<=[다요])\.\s/)
  return (before ? parts[parts.length - 1] : parts[0]).trim()
}

function cueOf(s: string): string {
  if (/시행|적용|발효/.test(s)) return 'effective'
  if (/공고|공지|고지/.test(s)) return 'announced'
  if (/개정|수정|최종|인쇄/.test(s)) return 'revised'
  return ''
}

/**
 * 달력에 실제로 있는 날짜만 통과시킨다. 2월 31일 같은 값은 null 이다 —
 * 없는 날짜가 effective_at 이 되면 정렬(§72.1)과 D-n 표기가 틀어지고, 반플랩 게이트도 그냥 지나간다.
 */
export function toIso(y: string, m: string, d: string): string | null {
  const mm = Number(m), dd = Number(d)
  if (mm < 1 || mm > 12 || dd < 1 || dd > 31) return null
  const iso = `${y}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`
  const t = Date.UTC(Number(y), mm - 1, dd)
  return !Number.isNaN(t) && new Date(t).toISOString().slice(0, 10) === iso ? iso : null
}

/** YYYYMMDD → ISO */
export const yyyymmdd = (k: string) => toIso(k.slice(0, 4), k.slice(4, 6), k.slice(6, 8))

// ── 조문 분할 (§68) ─────────────────────────────────────────────
export interface Section { identifier: string; title: string; content: string }

// 경계: 제N조 / 제 N 조 / 제N조의2 / 제N장 / 부칙
const ARTICLE = /^(제\s*\d+\s*(?:조|장)(?:의\s*\d+)?|부\s*칙)\s*(.*)$/
// "1. 개인정보 수집", "01 목적", "2) 이용" 식 번호 제목. 숫자 뒤에 공백이 있어야 한다 — "3개월" 은 걸리지 않는다.
// 제목이지 문장이 아니어야 한다: 짧고, 마침표로 끝나지 않는다. "1. 회사는 … 수 있습니다." 는 본문이다.
const NUMBERED = /^(\d{1,2}[.)]?)\s+([가-힣][^.]{0,34})$/

/**
 * 조문 인용인가. 개인정보 처리방침의 수집 항목 표는 행마다 법적 근거 열이 "제15조 제1항 제4호" 로 시작한다.
 * 표를 줄로 펴면 그 줄이 조문 머리처럼 보인다 — 잡코리아 한 문서에서만 56줄이 그랬다.
 * 조문 머리의 제목은 "(목적)" 이지 "제1항 제4호" 가 아니다.
 */
const isCitation = (title: string) => /^제?\s*\d+\s*항/.test(title)

export function sectionsOf(text: string): Section[] {
  const lines = text.split('\n')
  /** 이 줄이 조문 머리인가. 표에서는 조 번호와 항·호가 다른 칸이라 줄이 나뉜다 — 제목 자리가 비면 다음 줄로 본다. */
  const article = (i: number) => {
    const line = lines[i]
    if (line.length >= 80) return null
    const m = line.match(ARTICLE)
    return m && !isCitation(m[2] || lines[i + 1] || '') ? m : null
  }
  // 제N조 로 짜인 문서가 아니면 번호 매김을 조문 머리로 친다 (카카오·야놀자는 "1. 개인정보 수집" 으로 쓴다).
  // "하나도 없을 때" 로 하면 본문에 조문을 한 줄 인용한 문서까지 번호 모드가 꺼진다 (사람인 처리방침이 그랬다).
  // 조로 짜인 문서는 조가 여럿이므로 셋을 넘는지로 가른다.
  const numbered = lines.filter((_, i) => article(i)).length < 3

  const out: Section[] = []
  let cur: Section | null = null
  for (const [i, line] of lines.entries()) {
    const m = article(i) ?? (numbered && line.length < 80 ? line.match(NUMBERED) : null)
    if (m) {
      if (cur) out.push(cur)
      // "제1조. 목적" 처럼 번호 뒤에 구분점을 찍는 문서가 있다 (메가박스). 제목에서 그 점을 뗀다.
      cur = { identifier: m[1].replace(/\s+/g, ''), title: m[2].trim().replace(/^[.)·:\-]\s*/, ''), content: '' }
    } else if (cur && !cur.title && !cur.content && line.length < 60) cur.title = line // 번호와 제목이 다른 줄인 경우 (당근)
    else if (cur) cur.content += (cur.content ? '\n' : '') + line
  }
  if (cur) out.push(cur)

  // 목차. 본문 없는 머리가 같은 번호로 본문과 함께 또 나오면 그것은 목차다 — 문서 앞머리의 조문 목록이
  // 통째로 빈 조문이 되어 있었다 (SSG 199개 중 99개). 목차가 본문 뒤에 붙는 문서도 있어 앞뒤를 다 본다.
  // 장 머리는 한 번만 나오므로 그대로 남는다.
  // 같은 번호가 본문과 함께 어디든 또 있으면 목차이고, 본문 없이 뒤에 또 있어도 앞의 것이 목차다 (장 머리가 그렇다).
  return out.filter((s, i) => s.content || !out.some((o, j) => o.identifier === s.identifier && (j > i || o.content)))
}
