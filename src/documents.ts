// 문서 카탈로그. 설정은 서비스 단위가 아니라 문서 단위다 (§19).
// 차단된 문서도 항목을 갖는다 — 카탈로그에 상태와 함께 표시되고, 절대 가져오지 않는다 (§2.7).
// 측정일 2026-09-07. 근거는 README 의 "측정 결과" 표.

export type DocType = 'TERMS' | 'PRIVACY'
export type Blocker = 'NONE' | 'ROBOTS' | 'WAF' | 'RENDER_REQUIRED' | 'DOCUMENT_ABSENT'

export interface HistoryConfig {
  harvester: 'DIRECTORY_INDEX' | 'LINK_LIST'
  indexUrl: string
  /** 인덱스 안에서 버전 링크를 고르는 정규식. 1번 그룹이 버전 키 */
  entryPattern: string
  /** 버전 키로 본문 URL 을 만드는 템플릿. {key} 치환 */
  urlTemplate: string
  /** 키가 YYYYMMDD 처럼 날짜 자체인가 (DIRECTORY_INDEX). 아니면 본문에서 날짜를 뽑는다 */
  keyIsDate?: boolean
}

export interface DocumentConfig {
  id: string
  service: string
  serviceName: string
  type: DocType
  title: string
  canonicalUrl: string
  blocker: Blocker
  /** blocker 가 NONE 일 때만 의미 있음 */
  extraction?: {
    /** 본문 컨테이너 CSS 셀렉터 (HTMLRewriter 가 지원하는 단순 셀렉터) */
    selector: string
    /** 본문 안에서 버릴 요소 */
    ignore?: string[]
    /** 라벨 없는 선두 날짜(토스)를 시행일로 쓸지 (§69.2 규칙 7) */
    leadingDate?: boolean
  }
  history?: HistoryConfig
  /** 차단·미수집 사유. 공개 카탈로그에 그대로 표시 */
  publicNote?: string
  checkedAt: string
}

export const DOCUMENTS: DocumentConfig[] = [
  // ── 수집 가능 ────────────────────────────────────────────────
  {
    id: 'daangn-privacy', service: 'daangn', serviceName: '당근', type: 'PRIVACY', title: '당근 개인정보 처리방침',
    canonicalUrl: 'https://privacy-policy.daangn.com/',
    blocker: 'NONE',
    extraction: { selector: 'main#content', ignore: ['nav', 'header', 'footer', 'script', 'style'] },
    history: {
      harvester: 'DIRECTORY_INDEX',
      indexUrl: 'https://privacy-policy.daangn.com/previous_pp/',
      entryPattern: 'href="(\\d{8})/"',
      urlTemplate: 'https://privacy-policy.daangn.com/previous_pp/{key}/',
      keyIsDate: true,
    },
    checkedAt: '2026-09-07',
  },
  {
    id: 'toss-terms', service: 'toss', serviceName: '토스', type: 'TERMS', title: '토스 서비스 이용약관',
    canonicalUrl: 'https://toss.im/docs/11027',
    blocker: 'NONE',
    extraction: { selector: 'div.container', ignore: ['div.dropdown', 'script', 'style', 'nav', 'header', 'footer'], leadingDate: true },
    history: {
      harvester: 'LINK_LIST',
      indexUrl: 'https://toss.im/docs/11027',
      entryPattern: 'href="/docs/11027/(\\d+)"',
      urlTemplate: 'https://toss.im/docs/11027/{key}',
    },
    checkedAt: '2026-09-07',
  },
  {
    id: 'yanolja-privacy', service: 'yanolja', serviceName: '야놀자(NOL)', type: 'PRIVACY', title: 'NOL 개인정보 처리방침',
    canonicalUrl: 'https://privacy.yanolja.com/policy/privacy-policy',
    blocker: 'NONE',
    // 페이지에 <main> 이 없다. 본문은 body 안에 서버 렌더링되어 들어온다 (2026-09-07 실측).
    extraction: { selector: 'body', ignore: ['nav', 'header', 'footer', 'aside', 'script', 'style', 'button', 'svg'] },
    publicNote: '과거 버전 목록이 페이지에 있으나 본문은 클라이언트에서만 불러옵니다. 현행 본문만 수집합니다 (2026-09-07 확인).',
    checkedAt: '2026-09-07',
  },

  // ── 렌더링 필요 (robots 허용, HTTP 200 + 빈 DOM). M2.5 까지 "수집 준비 중" ──
  { id: 'toss-privacy', service: 'toss', serviceName: '토스', type: 'PRIVACY', title: '토스 개인정보 처리방침',
    canonicalUrl: 'https://toss.im/privacy-policy', blocker: 'RENDER_REQUIRED',
    publicNote: '본문이 JavaScript 로만 렌더링됩니다. 렌더링 수집(§85) 준비 중.', checkedAt: '2026-09-07' },
  { id: 'yanolja-terms', service: 'yanolja', serviceName: '야놀자(NOL)', type: 'TERMS', title: 'NOL 서비스 이용약관',
    canonicalUrl: 'https://policy.yanolja.com/policy/?t=service', blocker: 'RENDER_REQUIRED',
    publicNote: 'policy.yanolja.com 은 JavaScript 로만 렌더링됩니다. 날짜 목록이 있는 accounts.yanolja.com 은 robots.txt 가 전체를 차단합니다.', checkedAt: '2026-09-07' },

  // ── 차단 (robots / WAF). 카탈로그에만 있고 절대 가져오지 않는다 ──
  ...blocked('melon', '멜론', 'https://www.melon.com/', 'robots.txt 가 User-agent: * 에 대해 / 전체를 차단합니다'),
  ...blocked('kakao', '카카오', 'https://www.kakao.com/policy/', 'robots.txt 가 /policy 경로를 차단합니다'),
  ...blocked('naver', '네이버', 'https://policy.naver.com/', '도메인 수준의 봇 차단(WAF)에 걸립니다', 'WAF'),
  { id: 'coupang-terms', service: 'coupang', serviceName: '쿠팡', type: 'TERMS', title: '쿠팡 이용약관',
    canonicalUrl: 'https://www.coupang.com/', blocker: 'WAF', publicNote: 'www.coupang.com 이 403 을 반환합니다', checkedAt: '2026-09-07' },
  { id: 'daangn-terms', service: 'daangn', serviceName: '당근', type: 'TERMS', title: '당근 이용약관',
    canonicalUrl: 'https://www.daangn.com/policy/terms/', blocker: 'ROBOTS', publicNote: 'robots.txt 가 /policy 경로를 차단합니다', checkedAt: '2026-09-07' },
]

function blocked(service: string, serviceName: string, url: string, note: string, blocker: Blocker = 'ROBOTS'): DocumentConfig[] {
  return (['TERMS', 'PRIVACY'] as DocType[]).map((type) => ({
    id: `${service}-${type.toLowerCase()}`, service, serviceName, type,
    title: `${serviceName} ${type === 'TERMS' ? '이용약관' : '개인정보 처리방침'}`,
    canonicalUrl: url, blocker, publicNote: note, checkedAt: '2026-09-07',
  }))
}

export const byId = (id: string) => DOCUMENTS.find((d) => d.id === id)
