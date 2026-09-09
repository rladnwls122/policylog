// 문서 카탈로그. 설정은 서비스 단위가 아니라 문서 단위다 (§19).
// 차단·미수집 문서도 항목을 갖는다 — 카탈로그에 상태와 함께 표시되고, 절대 가져오지 않는다 (§2.7).
//
// 모든 항목은 /admin/probe 로 실제로 재본 결과다. 추측한 URL 은 넣지 않는다 — checkedAt 이 잰 날이다.
// 2026-09-09 에 404 이거나 홈페이지만 적혀 있던 11건을 다시 찾았다. 9건은 실제 위치가 있었고, 남은 2건은
// 로그인 뒤(네이버페이)이거나 robots 가 막는다(삼성카드).
// 새 문서를 넣는 절차는 README 의 "카탈로그 넓히기" 를 따른다.

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
  /** 정적 fetch 로 본문이 안 나오는 문서. Browser Rendering 으로 가져온다 (§85) */
  fetchMode?: 'STATIC' | 'RENDER'
  history?: HistoryConfig
  /** 차단·미수집 사유. 공개 카탈로그에 그대로 표시 */
  publicNote?: string
  checkedAt: string
}

/**
 * 수집 여부를 정하는 순수 판정들. fetch 를 하지 않으므로 여기 둔다 — acquire.ts 와 db.ts 가 같은 규칙을 쓴다.
 * 필요한 설정만 구조적으로 받는다 (Env 를 import 하면 db.ts 와 순환이 된다).
 */
export type CollectEnv = { ROBOTS_MODE?: 'ENFORCE' | 'ADVISORY'; BROWSER?: unknown }

/** robots 판정을 수집 게이트로 쓸지 (§24.4). 기본은 ENFORCE — 설정을 안 건드리면 동작이 안 바뀐다. */
export const robotsEnforced = (env: CollectEnv) => (env.ROBOTS_MODE ?? 'ENFORCE') !== 'ADVISORY'

/**
 * 문서 하나를 다시 보는 주기 (§24.3). 크론은 매일 돌지만 문서는 이 주기마다 한 번만 본다.
 * 공개 화면과 /bot 의 문구가 이 값을 그대로 읽으므로, 바꾸면 약속도 같이 바뀐다.
 * 여기 두는 이유는 순환 import 때문이다 — views 가 acquire 를 부르면 notify 를 거쳐 views 로 돌아온다.
 */
export const CHECK_INTERVAL_DAYS = 90

export const fetchModeOf = (doc: DocumentConfig) => doc.fetchMode ?? (doc.blocker === 'RENDER_REQUIRED' ? 'RENDER' : 'STATIC')

/**
 * 이 문서를 지금 설정에서 실제로 수집하는가.
 * robots 차단은 ROBOTS_MODE=ADVISORY 에서, 렌더링 필요는 BROWSER 바인딩이 있을 때 열린다.
 * 어느 쪽이든 셀렉터를 실측해 둔 문서만 열린다 — 설정이 없으면 가져올 방법 자체가 없다 (§2.7).
 */
export const isCollectible = (env: CollectEnv, doc: DocumentConfig) =>
  !!doc.extraction && (
    doc.blocker === 'NONE' ||
    (doc.blocker === 'ROBOTS' && !robotsEnforced(env)) ||
    (doc.blocker === 'RENDER_REQUIRED' && !!env.BROWSER))

const CHECKED = '2026-09-07'
// 404 이거나 홈페이지만 적혀 있던 문서를 다시 찾아본 날. 이 날짜가 붙은 항목은 URL 을 새로 실측한 것이다.
const RECHECKED = '2026-09-09'
const IGNORE = ['nav', 'header', 'footer', 'aside', 'script', 'style', 'button', 'svg']

// ── 수집 중 ────────────────────────────────────────────────────
const ACTIVE: DocumentConfig[] = [
]

// ── 렌더링 필요: robots 는 허용인데 HTTP 200 응답에 본문이 없다 (§84 RENDER_REQUIRED) ──
// 렌더링 수집(§85)이 붙기 전까지 "수집 준비 중" 으로 표시하고 가져오지 않는다.
const RENDER: [string, string, DocType, string, string?][] = [
  ['class101', '클래스101', 'TERMS', 'https://class101.net/ko/terms'],
  ['inflearn', '인프런', 'PRIVACY', 'https://www.inflearn.com/policy/privacy'],
  ['tumblbug', '텀블벅', 'TERMS', 'https://tumblbug.com/terms'],
  ['laftel', '라프텔', 'TERMS', 'https://policy.laftel.net/service/'],
]

// ── robots.txt 는 비허용인데 수집하는 문서 (§24.4) ─────────────
// ROBOTS_MODE=ADVISORY 일 때만 수집된다. ENFORCE 로 되돌리면 자동으로 차단 표시로 돌아간다.
// 여기 들어가려면 /admin/probe 로 셀렉터를 실측해야 한다 — ROBOTS_BLOCKED 와 달리 추출 설정을 갖는다.
// robots 판정은 계속 재고 카탈로그에 그대로 보인다. 숨기지 않는다 (§2.7).
const ROBOTS_NOTE = 'robots.txt 는 이 경로를 비허용하지만, 공개 의무가 있는 문서라 3개월에 1회 이하로 수집합니다. 거부 요청은 즉시 반영합니다.'
const ROBOTS_COLLECTED: DocumentConfig[] = [
]

// ── robots.txt 만이 유일한 벽인 문서 (§84 ROBOTS) ──────────────
// 2026-09-07 재측정: 이전에 여기 있던 39건을 ROBOTS_MODE=ADVISORY 로 전부 실제로 가져와 봤다.
// robots 를 넘고 나서 본문이 나온 건 7건뿐이고, 나머지는 애초에 robots 가 아니라 빈 DOM·404·403·
// 네트워크 오류가 벽이었다. 7건은 ROBOTS_COLLECTED 로, 나머지는 실측 사유대로 RENDER·WAF_BLOCKED·
// ABSENT 로 옮겼다. 2026-09-09 에 삼성카드 하나가 다시 들어왔다 — 문서 위치는 찾았는데 robots 가 막는다.
const ROBOTS_BLOCKED: [string, string, DocType, string, string?][] = [
]

// ── 봇 차단(WAF) 또는 403 (§84 WAF) ────────────────────────────
const WAF_BLOCKED: [string, string, DocType, string, string][] = [
]

// ── 웹에서 문서를 찾지 못함 (§84 DOCUMENT_ABSENT) ──────────────
const ABSENT: [string, string, DocType, string, string][] = [
]

const title = (name: string, type: DocType) => `${name} ${type === 'TERMS' ? '이용약관' : '개인정보 처리방침'}`
const id = (service: string, type: DocType) => `${service}-${type.toLowerCase()}`

export const DOCUMENTS: DocumentConfig[] = [
  ...ACTIVE,
  ...RENDER.map(([service, name, type, url, note]): DocumentConfig => ({
    id: id(service, type), service, serviceName: name, type, title: title(name, type), canonicalUrl: url,
    blocker: 'RENDER_REQUIRED', publicNote: note ?? '본문이 JavaScript 로만 렌더링됩니다. 렌더링 수집 준비 중입니다.', checkedAt: CHECKED,
  })),
  ...ROBOTS_BLOCKED.map(([service, name, type, url, note]): DocumentConfig => ({
    id: id(service, type), service, serviceName: name, type, title: title(name, type), canonicalUrl: url,
    blocker: 'ROBOTS', publicNote: note ?? 'robots.txt 가 이 경로를 차단합니다', checkedAt: CHECKED,
  })),
  ...ROBOTS_COLLECTED,
  ...WAF_BLOCKED.map(([service, name, type, url, note]): DocumentConfig => ({
    id: id(service, type), service, serviceName: name, type, title: title(name, type), canonicalUrl: url,
    blocker: 'WAF', publicNote: note, checkedAt: CHECKED,
  })),
  ...ABSENT.map(([service, name, type, url, note]): DocumentConfig => ({
    id: id(service, type), service, serviceName: name, type, title: title(name, type), canonicalUrl: url,
    blocker: 'DOCUMENT_ABSENT', publicNote: note, checkedAt: CHECKED,
  })),
]

export const byId = (id: string) => DOCUMENTS.find((d) => d.id === id)

// ── 서비스 로고 ──────────────────────────────────────────────
// 각 서비스 홈페이지의 <link rel=icon> 또는 /favicon.ico 를 2026-09-08 에 실측한 주소. 카드 제목 옆에 작게 찍는다.
// 방문자 브라우저가 그 서비스에서 직접 받는다 — referrer 는 보내지 않는다 (views.tsx Logo). 없는 서비스는 첫 글자로 대신한다.
export const LOGOS: Record<string, string> = {
  ably: 'https://m.a-bly.com/favicon.ico',
  baemin: 'https://www.baemin.com/_next/static/media/favicon.41582b85.ico',
  bugs: 'https://file.bugsm.co.kr/wbugs/common/faviconBugs.ico',
  bunjang: 'https://static.bunjang.co.kr/web/ui/favicon.ico',
  cgv: 'https://cgv.co.kr/favicon.ico',
  class101: 'https://class101.net/images/apple-touch-icon-57x57.png',
  coupang: 'https://www.coupang.com/favicon.ico',
  daangn: 'https://www.daangn.com/_remix/favicon-ptbCteuu.png',
  danawa: 'https://img.danawa.com/new/danawa_main/v1/img/danawa_favicon.ico',
  emart: 'https://sui.ssgcdn.com/ui/common/img/ssg.ico',
  genie: 'https://www.genie.co.kr/resources/favicon_32.ico?v=202602091400',
  gmarket: 'https://image.gmarket.co.kr/Gmarket_Mobile_v2/icon_01.png',
  hanabank: 'https://www.hanabank.com/favicon.ico',
  hanatour: 'https://www.hanatour.com/favicon.ico',
  incruit: 'https://www.incruit.com/favicon.ico',
  inflearn: 'https://cdn.inflearn.com/dist/favicon.ico',
  interpark: 'https://yaimg.yanolja.com/joy/sunny/static/images/nol/favicon/favicon-16x16.ico',
  jejuair: 'https://static.jejuair.net/hpgg/resources/images/icon/favicon.ico',
  jobkorea: 'https://www.jobkorea.co.kr/display/images/favicon.png',
  kakao: 'https://www.kakao.com/favicon.ico',
  kakaopay: 'https://t1.kakaocdn.net/kakaopay/icons/favicon.ico',
  koreanair: 'https://www.koreanair.com/favicon.ico?3',
  krafton: 'https://www.krafton.com/wp-content/uploads/2026/02/cropped-cropped-ms-icon-70x70-1-32x32.png',
  kurly: 'https://res.kurly.com/favicon.ico',
  kyobo: 'https://contents.kyobobook.co.kr/resources/fo/images/favicon/kyobo.ico',
  laftel: 'https://static.laftel.net/favicon.ico',
  lguplus: 'https://www.lguplus.com/static/pc-static/favicon_16_lgu.ico',
  lottecinema: 'https://www.lottecinema.co.kr/favicon.ico',
  lotteon: 'https://static.lotteon.com/p/common/assets/favicon/1/favicon-32.png',
  megabox: 'https://www.megabox.co.kr/static/pc/images/favicon.ico',
  melon: 'https://www.melon.com/favicon.ico?2',
  musinsa: 'https://image.msscdn.net/static/assets/bi/favicon/favicon.svg',
  myrealtrip: 'https://dffoxz5he03rp.cloudfront.net/logos/logo_mrt_v2_web_72x72.png',
  naver: 'https://www.naver.com/favicon.ico?1',
  naverpay: 'https://www.naver.com/favicon.ico?1',
  ncsoft: 'https://assets.playnccdn.com/purple/resources/favicon/nc-192x192.png',
  nexon: 'https://rs.nxfs.nexon.com/common/images/nexon.ico',
  ohou: 'https://ohou.se/favicon.ico?v=3',
  oliveyoung: 'https://static.oliveyoung.co.kr/pc-static-root/image/comm/favicon.ico',
  ridi: 'https://static.ridicdn.net/books-frontend/p/61ee65/_next/static/media/favicon.2-qehufv3g0yx.ico',
  saramin: 'https://www.saramin.co.kr/favicon.ico?ver=3',
  socar: 'https://www.socar.kr/assets/favicons/favicon_16x16.png',
  ssg: 'https://sui.ssgcdn.com/ui/common/img/ssg.ico',
  toss: 'https://static.toss.im/assets/toss-im/asset/favicon/favicon-32x32.png',
  tumblbug: 'https://cdn.tumblbug.com/appicon/favicon/favicon-32x32.png',
  tving: 'https://www.tving.com/favicon.ico',
  upbit: 'https://www.upbit.com/favicon.jpg',
  wadiz: 'https://cdn-static.wadiz.io/assets/icon/favicon.ico',
  wanted: 'https://static.wanted.co.kr/favicon/new/favicon.ico',
  watcha: 'https://watcha.com/favicon.ico',
  wavve: 'https://www.wavve.com/favicon.ico',
  wooribank: 'https://www.wooribank.com/favicon.ico',
  yanolja: 'https://yaimg.yanolja.com/joy/sunny/static/images/nol/favicon/favicon-16x16.ico',
  yeogi: 'https://www.yeogi.com/favicon/rel_icon/favicon_png_16.png',
  yes24: 'https://image.yes24.com/sysimage/renew/gnb/favicon_n.ico',
  yogiyo: 'https://www.yogiyo.co.kr/mobile/image/app_128x128.png',
  zigbang: 'https://s.zigbang.com/favicon.ico',
  zigzag: 'https://cf.res.s.zigzag.kr/favicons/zigzag/favicon.ico',
}
