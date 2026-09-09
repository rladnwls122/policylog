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
// 중소기업으로 대상을 바꾸고 새로 넣은 날.
const ADDED = '2026-09-10'
const IGNORE = ['nav', 'header', 'footer', 'aside', 'script', 'style', 'button', 'svg']

// ── 수집 중 ────────────────────────────────────────────────────
// 2026-09-10 에 넣은 열둘. 고른 기준은 "감시가 덜하면서 소비자 분쟁이 실제로 터지는 업종" 이다 —
// P2P·유사투자자문·결제, 화물·이사, 게임 아이템 거래, 강의 구독, 호스팅·쇼핑몰 빌더.
// 전부 /admin/probe 로 셀렉터를 재고 넣었다. robots 는 넣을 때 모두 ALLOWED 였다.
const ACTIVE: DocumentConfig[] = [
  {
    id: 'thinkpool-privacy', service: 'thinkpool', serviceName: '씽크풀', type: 'PRIVACY', title: '씽크풀 개인정보 처리방침',
    canonicalUrl: 'https://www.thinkpool.com/policy/privacy', blocker: 'NONE',
    extraction: { selector: 'article', ignore: IGNORE }, checkedAt: ADDED,
  },
  {
    id: 'payapp-privacy', service: 'payapp', serviceName: '페이앱', type: 'PRIVACY', title: '페이앱 개인정보 처리방침',
    canonicalUrl: 'https://www.payapp.kr/homepage/udidTerms/payapp_privacy.html', blocker: 'NONE',
    extraction: { selector: 'article', ignore: IGNORE }, checkedAt: ADDED,
  },
  {
    id: 'hwamulman-terms', service: 'hwamulman', serviceName: '화물맨', type: 'TERMS', title: '화물맨 이용약관',
    canonicalUrl: 'https://www.2424-2424.com/agreement01.html', blocker: 'NONE',
    extraction: { selector: 'div#content', ignore: IGNORE }, checkedAt: ADDED,
  },
  {
    id: 'onecall-privacy', service: 'onecall', serviceName: '원콜', type: 'PRIVACY', title: '원콜 개인정보 처리방침',
    canonicalUrl: 'https://www.15881063.co.kr/Membership/PrivacyPolicy', blocker: 'NONE',
    // 페이지에 본문을 감싸는 컨테이너가 없다. 본문이 body 안에 서버 렌더링되어 들어온다.
    extraction: { selector: 'body', ignore: IGNORE }, checkedAt: ADDED,
  },
  {
    id: 'elancer-privacy', service: 'elancer', serviceName: '이랜서', type: 'PRIVACY', title: '이랜서 개인정보 처리방침',
    canonicalUrl: 'https://www.elancer.co.kr/policy', blocker: 'NONE',
    extraction: { selector: 'body', ignore: IGNORE }, checkedAt: ADDED,
  },
  {
    id: 'hostingkr-privacy', service: 'hostingkr', serviceName: '호스팅케이알', type: 'PRIVACY', title: '호스팅케이알 개인정보 처리방침',
    canonicalUrl: 'https://www.hosting.kr/servlet/html?pgm_id=HOSTING000050', blocker: 'NONE',
    extraction: { selector: 'body', ignore: IGNORE },
    publicNote: '페이지에 과거 개정본 링크가 남아 있습니다. 이력 하베스터는 아직 붙이지 않았습니다.',
    checkedAt: ADDED,
  },
  {
    id: 'sixshop-privacy', service: 'sixshop', serviceName: '식스샵', type: 'PRIVACY', title: '식스샵 개인정보 처리방침',
    canonicalUrl: 'https://www.sixshop.com/privacy', blocker: 'NONE',
    extraction: { selector: 'main', ignore: IGNORE }, checkedAt: ADDED,
  },
  {
    id: 'itembay-privacy', service: 'itembay', serviceName: '아이템베이', type: 'PRIVACY', title: '아이템베이 개인정보 처리방침',
    canonicalUrl: 'https://www.itembay.com/member/terms/protectionContents', blocker: 'NONE',
    extraction: { selector: 'body', ignore: IGNORE },
    publicNote: '시행일자별 과거 개정본 42개가 페이지에 있습니다. 이력 하베스터는 아직 붙이지 않았습니다.',
    checkedAt: ADDED,
  },
  {
    id: 'airklass-privacy', service: 'airklass', serviceName: '에어클래스', type: 'PRIVACY', title: '에어클래스 개인정보 처리방침',
    canonicalUrl: 'https://www.airklass.com/privacy', blocker: 'NONE',
    extraction: { selector: 'body', ignore: IGNORE }, checkedAt: ADDED,
  },
  {
    id: 'taling-privacy', service: 'taling', serviceName: '탈잉', type: 'PRIVACY', title: '탈잉 개인정보 처리방침',
    canonicalUrl: 'https://talingrules.oopy.io/privacy', blocker: 'NONE',
    extraction: { selector: 'body', ignore: IGNORE }, checkedAt: ADDED,
  },
  {
    id: 'studypie-privacy', service: 'studypie', serviceName: '스터디파이', type: 'PRIVACY', title: '스터디파이 개인정보 처리방침',
    canonicalUrl: 'https://studypie.co/agreement/privacy_policy', blocker: 'NONE',
    extraction: { selector: 'main', ignore: IGNORE }, checkedAt: ADDED,
  },
  {
    id: 'codeit-privacy', service: 'codeit', serviceName: '코드잇', type: 'PRIVACY', title: '코드잇 개인정보 처리방침',
    canonicalUrl: 'https://www.codeit.kr/terms/PRIVACY_POLICY', blocker: 'NONE',
    extraction: { selector: 'main', ignore: IGNORE }, checkedAt: ADDED,
  },
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
