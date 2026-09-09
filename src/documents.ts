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
    checkedAt: CHECKED,
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
    checkedAt: CHECKED,
  },
  {
    id: 'ridi-terms', service: 'ridi', serviceName: '리디', type: 'TERMS', title: '리디 이용약관',
    canonicalUrl: 'https://ridibooks.com/legal/terms',
    blocker: 'NONE',
    extraction: { selector: 'main', ignore: IGNORE },
    // 현행 페이지가 policy.ridi.com 의 과거 버전을 버전 번호로 모두 링크한다.
    history: {
      harvester: 'LINK_LIST',
      indexUrl: 'https://ridibooks.com/legal/terms',
      entryPattern: 'href="https://policy\\.ridi\\.com/legal/terms/(v[\\d.]+)"',
      urlTemplate: 'https://policy.ridi.com/legal/terms/{key}',
    },
    checkedAt: CHECKED,
  },
  {
    id: 'ridi-privacy', service: 'ridi', serviceName: '리디', type: 'PRIVACY', title: '리디 개인정보 처리방침',
    canonicalUrl: 'https://ridibooks.com/legal/privacy',
    blocker: 'NONE',
    extraction: { selector: 'main', ignore: IGNORE },
    history: {
      harvester: 'LINK_LIST',
      indexUrl: 'https://ridibooks.com/legal/privacy',
      entryPattern: 'href="https://policy\\.ridi\\.com/legal/privacy/(v[\\d.]+)"',
      urlTemplate: 'https://policy.ridi.com/legal/privacy/{key}',
    },
    checkedAt: CHECKED,
  },
  {
    id: 'saramin-terms', service: 'saramin', serviceName: '사람인', type: 'TERMS', title: '사람인 이용약관',
    canonicalUrl: 'https://www.saramin.co.kr/zf_user/help/terms-of-service',
    blocker: 'NONE',
    extraction: { selector: 'div#content', ignore: IGNORE },
    checkedAt: CHECKED,
  },
  {
    id: 'saramin-privacy', service: 'saramin', serviceName: '사람인', type: 'PRIVACY', title: '사람인 개인정보 처리방침',
    canonicalUrl: 'https://www.saramin.co.kr/zf_user/help/privacy',
    blocker: 'NONE',
    extraction: { selector: 'div#content', ignore: IGNORE },
    checkedAt: CHECKED,
  },
  {
    id: 'socar-privacy', service: 'socar', serviceName: '쏘카', type: 'PRIVACY', title: '쏘카 개인정보 처리방침',
    canonicalUrl: 'https://socar-docs.zendesk.com/hc/ko/articles/360048398254',
    blocker: 'NONE',
    extraction: { selector: 'main', ignore: IGNORE },
    publicNote: '쏘카는 처리방침을 고객센터(zendesk) 문서로 게시합니다. 공식 이력 페이지는 확인하지 못했습니다.',
    checkedAt: CHECKED,
  },
  {
    id: 'yanolja-privacy', service: 'yanolja', serviceName: '야놀자(NOL)', type: 'PRIVACY', title: 'NOL 개인정보 처리방침',
    canonicalUrl: 'https://privacy.yanolja.com/policy/privacy-policy',
    blocker: 'NONE',
    // 페이지에 <main> 이 없다. 본문은 body 안에 서버 렌더링되어 들어온다.
    extraction: { selector: 'body', ignore: IGNORE },
    publicNote: '과거 버전 목록이 페이지에 있으나 본문은 클라이언트에서만 불러옵니다. 현행 본문만 수집합니다.',
    checkedAt: CHECKED,
  },
  {
    // 약관은 melon.com 이 아니라 info.melon.com 에 있고, 그 호스트의 robots.txt 는 이 경로를 허용한다.
    // 예전 카탈로그는 melon.com 홈페이지 URL 로 재서 "robots 차단" 으로 잘못 분류돼 있었다 (§16.1).
    id: 'melon-terms', service: 'melon', serviceName: '멜론', type: 'TERMS', title: '멜론 이용약관',
    canonicalUrl: 'https://info.melon.com/terms/web/terms1_1.html', blocker: 'NONE',
    extraction: { selector: 'div.wrap_terms', ignore: IGNORE },
    publicNote: '시행일자별 과거 20개 버전 목록이 페이지에 있으나 본문은 클라이언트에서만 불러옵니다. 현행 본문만 수집합니다.',
    checkedAt: CHECKED,
  },
  // ↓ 2026-09-09 재조사. 아래 넷은 카탈로그의 URL 이 404 이거나 홈페이지만 적혀 있어 못 가져오던 문서다.
  // 실제 위치를 찾아 /admin/probe 로 셀렉터까지 재고 옮겼다.
  {
    // 예전 URL(www.ssg.com/promotion/policyTerms.ssg)은 404 다. 약관은 회원 도메인에 있다.
    id: 'ssg-terms', service: 'ssg', serviceName: 'SSG닷컴', type: 'TERMS', title: 'SSG닷컴 이용약관',
    canonicalUrl: 'https://member.ssg.com/policies/terms.ssg', blocker: 'NONE',
    extraction: { selector: 'div#content', ignore: IGNORE },
    checkedAt: RECHECKED,
  },
  {
    // 이마트몰은 SSG.COM 과 같은 이용약관을 쓴다. 몰 구분은 site 파라미터뿐이고 본문은 같다.
    id: 'emart-terms', service: 'emart', serviceName: '이마트몰', type: 'TERMS', title: '이마트몰 이용약관',
    canonicalUrl: 'https://member.ssg.com/policies/terms.ssg?site=small', blocker: 'NONE',
    extraction: { selector: 'div#content', ignore: IGNORE },
    publicNote: '이마트몰은 SSG.COM 이용약관을 함께 씁니다. 본문이 SSG닷컴 항목과 같습니다.',
    checkedAt: RECHECKED,
  },
  {
    // 예전 URL(wadiz.kr/web/waccount/policy/terms)은 404 다. 지금은 wterms 아래에 있고 도메인도 .io 로 넘어간다.
    id: 'wadiz-terms', service: 'wadiz', serviceName: '와디즈', type: 'TERMS', title: '와디즈 이용약관',
    canonicalUrl: 'https://www.wadiz.io/web/wterms/signup', blocker: 'NONE',
    extraction: { selector: 'main', ignore: IGNORE },
    checkedAt: RECHECKED,
  },
  {
    // 예전 카탈로그에는 홈페이지만 적혀 있었다.
    id: 'jobkorea-privacy', service: 'jobkorea', serviceName: '잡코리아', type: 'PRIVACY', title: '잡코리아 개인정보 처리방침',
    canonicalUrl: 'https://www.jobkorea.co.kr/service/PolicyPrivacy', blocker: 'NONE',
    extraction: { selector: 'div#content', ignore: IGNORE },
    checkedAt: RECHECKED,
  },
]

// ── 렌더링 필요: robots 는 허용인데 HTTP 200 응답에 본문이 없다 (§84 RENDER_REQUIRED) ──
// 렌더링 수집(§85)이 붙기 전까지 "수집 준비 중" 으로 표시하고 가져오지 않는다.
const RENDER: [string, string, DocType, string, string?][] = [
  ['toss', '토스', 'PRIVACY', 'https://toss.im/privacy-policy'],
  ['yanolja', '야놀자(NOL)', 'TERMS', 'https://policy.yanolja.com/policy/?t=service'],
  ['baemin', '배달의민족', 'TERMS', 'https://terms.baemin.com/'],
  ['tving', '티빙', 'TERMS', 'https://www.tving.com/policy/terms'],
  ['wavve', '웨이브', 'TERMS', 'https://www.wavve.com/customer/terms'],
  ['yeogi', '여기어때', 'TERMS', 'https://www.yeogi.com/policy/terms'],
  ['kyobo', '교보문고', 'TERMS', 'https://www.kyobobook.co.kr/policy'],
  ['kyobo', '교보문고', 'PRIVACY', 'https://www.kyobobook.co.kr/policy/privacy'],
  ['watcha', '왓챠', 'TERMS', 'https://watcha.com/terms'],
  ['class101', '클래스101', 'TERMS', 'https://class101.net/ko/terms'],
  ['inflearn', '인프런', 'PRIVACY', 'https://www.inflearn.com/policy/privacy'],
  ['bunjang', '번개장터', 'TERMS', 'https://m.bunjang.co.kr/policy/terms'],
  ['tumblbug', '텀블벅', 'TERMS', 'https://tumblbug.com/terms'],
  ['cgv', 'CGV', 'TERMS', 'https://www.cgv.co.kr/user/join/agreement.aspx'],
  ['lottecinema', '롯데시네마', 'TERMS', 'https://www.lottecinema.co.kr/NLCHS/Cinema/Terms'],
  ['hanatour', '하나투어', 'TERMS', 'https://www.hanatour.com/els/prv/CHPC0PRV0004M200'],
  ['hanatour', '하나투어', 'PRIVACY', 'https://www.hanatour.com/els/prv/CHPC0PRV0005M200'],
  ['lguplus', 'LG유플러스', 'TERMS', 'https://www.lguplus.com/footer/agreement'],
  ['hanabank', '하나은행', 'PRIVACY', 'https://www.hanabank.com/inc/customer/privacy.jsp'],
  ['wooribank', '우리은행', 'PRIVACY', 'https://spot.wooribank.com/pot/Dream?withyou=CMCOM0016'],
  ['yogiyo', '요기요', 'TERMS', 'https://www.yogiyo.co.kr/mobile/#/terms/'],
  ['socar', '쏘카', 'TERMS', 'https://www.socar.kr/terms'],
  // ↓ 이전에 ROBOTS 로 분류돼 있던 문서. 2026-09-07 ADVISORY 로 실제로 가져와 보니 HTTP 200 에 본문이 없었다.
  ['daangn', '당근', 'TERMS', 'https://www.daangn.com/policy/terms/', 'robots 는 허용이지만 본문이 JavaScript 로만 렌더링됩니다. 렌더링 수집 준비 중입니다.'],
  ['melon', '멜론', 'PRIVACY', 'https://info.melon.com/terms/web/terms3.html'],
  ['genie', '지니뮤직', 'TERMS', 'https://www.genie.co.kr/guide/userAgreement'],
  ['genie', '지니뮤직', 'PRIVACY', 'https://www.genie.co.kr/guide/userPrivacy'],
  ['yes24', 'YES24', 'TERMS', 'https://www.yes24.com/Templates/FTUseAgreement.aspx'],
  ['yes24', 'YES24', 'PRIVACY', 'https://www.yes24.com/Templates/FTPrivacy.aspx'],
  ['upbit', '업비트', 'TERMS', 'https://upbit.com/service_center/terms_of_service'],
  ['ably', '에이블리', 'PRIVACY', 'https://a-bly.com/privacy'],
  ['oliveyoung', '올리브영', 'TERMS', 'https://www.oliveyoung.co.kr/store/main/getAgreement.do'],
  ['myrealtrip', '마이리얼트립', 'TERMS', 'https://www.myrealtrip.com/terms'],
  ['lguplus', 'LG유플러스', 'PRIVACY', 'https://privacy.lguplus.com/privacy/info/v1/1'],
  // ↓ 2026-09-09 재조사. ABSENT 에 있던 문서인데 실제 위치를 찾으니 200 이었다. 다만 본문이 비어 있어 렌더링이 필요하다.
  ['musinsa', '무신사', 'TERMS', 'https://www.musinsa.com/member/join/agreement/service'],
  ['musinsa', '무신사', 'PRIVACY', 'https://www.musinsa.com/member/join/agreement/privacy-policy'],
  ['kurly', '컬리', 'TERMS', 'https://www.kurly.com/user-terms/agreement'],
  ['laftel', '라프텔', 'TERMS', 'https://policy.laftel.net/service/'],
  ['lotteon', '롯데온', 'TERMS', 'https://www.lotteon.com/p/common/footerTerms?termsType=2'],
]

// ── robots.txt 는 비허용인데 수집하는 문서 (§24.4) ─────────────
// ROBOTS_MODE=ADVISORY 일 때만 수집된다. ENFORCE 로 되돌리면 자동으로 차단 표시로 돌아간다.
// 여기 들어가려면 /admin/probe 로 셀렉터를 실측해야 한다 — ROBOTS_BLOCKED 와 달리 추출 설정을 갖는다.
// robots 판정은 계속 재고 카탈로그에 그대로 보인다. 숨기지 않는다 (§2.7).
const ROBOTS_NOTE = 'robots.txt 는 이 경로를 비허용하지만, 공개 의무가 있는 문서라 3개월에 1회 이하로 수집합니다. 거부 요청은 즉시 반영합니다.'
const ROBOTS_COLLECTED: DocumentConfig[] = [
  {
    id: 'kakao-terms', service: 'kakao', serviceName: '카카오', type: 'TERMS', title: '카카오 이용약관',
    canonicalUrl: 'https://www.kakao.com/policy/terms', blocker: 'ROBOTS',
    extraction: { selector: 'div.cont_policy', ignore: IGNORE },
    publicNote: ROBOTS_NOTE, checkedAt: CHECKED,
  },
  {
    id: 'kakao-privacy', service: 'kakao', serviceName: '카카오', type: 'PRIVACY', title: '카카오 개인정보 처리방침',
    canonicalUrl: 'https://www.kakao.com/policy/privacy', blocker: 'ROBOTS',
    extraction: { selector: 'div.cont_policy', ignore: IGNORE },
    publicNote: ROBOTS_NOTE, checkedAt: CHECKED,
  },
  {
    id: 'wanted-terms', service: 'wanted', serviceName: '원티드', type: 'TERMS', title: '원티드 이용약관',
    canonicalUrl: 'https://www.wanted.co.kr/terms', blocker: 'ROBOTS',
    extraction: { selector: 'div.article-body', ignore: IGNORE },
    publicNote: ROBOTS_NOTE, checkedAt: CHECKED,
  },
  {
    id: 'wanted-privacy', service: 'wanted', serviceName: '원티드', type: 'PRIVACY', title: '원티드 개인정보 처리방침',
    canonicalUrl: 'https://www.wanted.co.kr/privacy', blocker: 'ROBOTS',
    extraction: { selector: 'div.article-body', ignore: IGNORE },
    publicNote: ROBOTS_NOTE, checkedAt: CHECKED,
  },
  {
    id: 'megabox-terms', service: 'megabox', serviceName: '메가박스', type: 'TERMS', title: '메가박스 이용약관',
    canonicalUrl: 'https://www.megabox.co.kr/support/terms', blocker: 'ROBOTS',
    extraction: { selector: 'div.terms-content', ignore: IGNORE },
    publicNote: `${ROBOTS_NOTE} 과거 13개 버전 목록이 페이지에 있으나 본문은 클라이언트에서만 불러옵니다.`, checkedAt: CHECKED,
  },
  {
    id: 'bugs-terms', service: 'bugs', serviceName: '벅스', type: 'TERMS', title: '벅스 이용약관',
    canonicalUrl: 'https://music.bugs.co.kr/rules/use', blocker: 'ROBOTS',
    extraction: { selector: 'article', ignore: IGNORE },
    publicNote: ROBOTS_NOTE, checkedAt: CHECKED,
  },
  {
    id: 'bugs-privacy', service: 'bugs', serviceName: '벅스', type: 'PRIVACY', title: '벅스 개인정보 처리방침',
    canonicalUrl: 'https://music.bugs.co.kr/rules/privacy', blocker: 'ROBOTS',
    extraction: { selector: 'div.content', ignore: IGNORE },
    publicNote: ROBOTS_NOTE, checkedAt: CHECKED,
  },
]

// ── robots.txt 만이 유일한 벽인 문서 (§84 ROBOTS) ──────────────
// 2026-09-07 재측정: 이전에 여기 있던 39건을 ROBOTS_MODE=ADVISORY 로 전부 실제로 가져와 봤다.
// robots 를 넘고 나서 본문이 나온 건 7건뿐이고, 나머지는 애초에 robots 가 아니라 빈 DOM·404·403·
// 네트워크 오류가 벽이었다. 7건은 ROBOTS_COLLECTED 로, 나머지는 실측 사유대로 RENDER·WAF_BLOCKED·
// ABSENT 로 옮겼다. 2026-09-09 에 삼성카드 하나가 다시 들어왔다 — 문서 위치는 찾았는데 robots 가 막는다.
const ROBOTS_BLOCKED: [string, string, DocType, string, string?][] = [
  // 예전 카탈로그에는 홈페이지만 적혀 있었다. 실제 처리방침은 여기 있고 200 이지만 robots.txt 가 이 경로를 막는다.
  // ADVISORY 로 본문을 재봐도 div#content·div#container 가 비어 있어 셀렉터를 아직 잡지 못했다.
  ['samsungcard', '삼성카드', 'PRIVACY', 'https://www.samsungcard.com/personal/customer-service/privacy/UHPPCC0378M0.jsp', 'robots.txt 가 이 경로를 차단합니다'],
]

// ── 봇 차단(WAF) 또는 403 (§84 WAF) ────────────────────────────
const WAF_BLOCKED: [string, string, DocType, string, string][] = [
  ['naver', '네이버', 'TERMS', 'https://policy.naver.com/', '도메인 수준의 봇 차단(WAF)에 걸립니다'],
  ['naver', '네이버', 'PRIVACY', 'https://policy.naver.com/', '도메인 수준의 봇 차단(WAF)에 걸립니다'],
  ['coupang', '쿠팡', 'TERMS', 'https://www.coupang.com/', 'www.coupang.com 이 403 을 반환합니다'],
  ['danawa', '다나와', 'TERMS', 'https://www.danawa.com/info/?nPage=terms', '요청에 403 을 반환합니다'],
  ['bithumb', '빗썸', 'TERMS', 'https://www.bithumb.com/react/policy/terms', '응답이 오지 않아 타임아웃됩니다'],
  // ↓ 이전에 ROBOTS 로 분류돼 있던 문서. 2026-09-07 ADVISORY 로 실제로 요청해 보니 서버가 거절했다.
  ['gmarket', 'G마켓', 'TERMS', 'https://www.gmarket.co.kr/pages/policy/terms', '요청에 403 을 반환합니다'],
  ['ohou', '오늘의집', 'TERMS', 'https://ohou.se/terms', '요청에 403 을 반환합니다'],
  ['ohou', '오늘의집', 'PRIVACY', 'https://ohou.se/privacy', '요청에 403 을 반환합니다'],
  ['zigbang', '직방', 'PRIVACY', 'https://www.zigbang.com/privacy', '요청에 403 을 반환합니다'],
  ['krafton', '크래프톤', 'PRIVACY', 'https://www.krafton.com/privacy-policy/', '요청에 403 을 반환합니다'],
  ['jejuair', '제주항공', 'PRIVACY', 'https://www.jejuair.net/', '홈페이지가 403 을 반환해 문서 위치를 확인하지 못했습니다'],
  ['koreanair', '대한항공', 'PRIVACY', 'https://www.koreanair.com/', '응답이 오지 않아 타임아웃됩니다'],
  ['incruit', '인크루트', 'TERMS', 'https://www.incruit.com/', '연결이 거부됩니다'],
  ['kakaopay', '카카오페이', 'TERMS', 'https://policy.kakaopay.com/terms', 'TLS 연결이 끊깁니다'],
  ['wemakeprice', '위메프', 'TERMS', 'https://www.wemakeprice.com/terms', 'TLS 연결이 끊깁니다'],
  ['interpark', '인터파크티켓', 'TERMS', 'https://ticket.interpark.com/Contents/Bbs/Terms', 'TLS 연결이 끊깁니다'],
  ['zigzag', '지그재그', 'PRIVACY', 'https://cf.zigzag.kr/policy/privacy.html', 'TLS 연결이 끊깁니다'],
  ['nexon', '넥슨', 'TERMS', 'https://member.nexon.com/policy/terms.aspx', 'https 요청이 http 로 리다이렉트됩니다 — 평문으로는 가져오지 않습니다'],
  ['ncsoft', '엔씨소프트', 'PRIVACY', 'https://kr.ncsoft.com/privacy', 'https 요청이 http 로 리다이렉트됩니다 — 평문으로는 가져오지 않습니다'],
]

// ── 웹에서 문서를 찾지 못함 (§84 DOCUMENT_ABSENT) ──────────────
const ABSENT: [string, string, DocType, string, string][] = [
  // 2026-09-09 재조사: 여기 있던 열한 건 중 아홉 건은 실제 위치를 찾아 ACTIVE·RENDER·ROBOTS_COLLECTED 로 옮겼다.
  // 남은 하나는 문서가 공개된 곳에 없다.
  ['naverpay', '네이버페이', 'TERMS', 'https://new-m.pay.naver.com/policy/terms', '약관 페이지가 네이버 로그인 뒤에 있어 공개 URL 로는 열리지 않습니다'],
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
