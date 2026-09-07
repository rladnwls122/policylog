// 문서 카탈로그. 설정은 서비스 단위가 아니라 문서 단위다 (§19).
// 차단·미수집 문서도 항목을 갖는다 — 카탈로그에 상태와 함께 표시되고, 절대 가져오지 않는다 (§2.7).
//
// 모든 항목은 2026-09-07 에 /admin/probe 로 실제로 재본 결과다. 추측한 URL 은 넣지 않는다.
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
  history?: HistoryConfig
  /** 차단·미수집 사유. 공개 카탈로그에 그대로 표시 */
  publicNote?: string
  checkedAt: string
}

const CHECKED = '2026-09-07'
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
]

// ── 렌더링 필요: robots 는 허용인데 HTTP 200 응답에 본문이 없다 (§84 RENDER_REQUIRED) ──
// 렌더링 수집(§85)이 붙기 전까지 "수집 준비 중" 으로 표시하고 가져오지 않는다.
const RENDER: [string, string, DocType, string][] = [
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
]

// ── robots.txt 가 막는다 (§84 ROBOTS) ──────────────────────────
// [service, 이름, 종류, url, 사유]. 사유가 없으면 경로 차단이 기본이다.
const ROBOTS_BLOCKED: [string, string, DocType, string, string?][] = [
  ['kakao', '카카오', 'TERMS', 'https://www.kakao.com/policy/terms', 'robots.txt 가 /policy 경로를 차단합니다'],
  ['kakao', '카카오', 'PRIVACY', 'https://www.kakao.com/policy/privacy', 'robots.txt 가 /policy 경로를 차단합니다'],
  ['melon', '멜론', 'TERMS', 'https://www.melon.com/', 'robots.txt 가 User-agent: * 에 대해 / 전체를 차단합니다'],
  ['melon', '멜론', 'PRIVACY', 'https://www.melon.com/', 'robots.txt 가 User-agent: * 에 대해 / 전체를 차단합니다'],
  ['daangn', '당근', 'TERMS', 'https://www.daangn.com/policy/terms/', 'robots.txt 가 /policy 경로를 차단합니다'],
  ['musinsa', '무신사', 'TERMS', 'https://www.musinsa.com/member/termsOfUse'],
  ['musinsa', '무신사', 'PRIVACY', 'https://www.musinsa.com/member/privacy'],
  ['ohou', '오늘의집', 'TERMS', 'https://ohou.se/terms'],
  ['ohou', '오늘의집', 'PRIVACY', 'https://ohou.se/privacy'],
  ['wanted', '원티드', 'TERMS', 'https://www.wanted.co.kr/terms'],
  ['wanted', '원티드', 'PRIVACY', 'https://www.wanted.co.kr/privacy'],
  ['yes24', 'YES24', 'TERMS', 'https://www.yes24.com/Templates/FTUseAgreement.aspx'],
  ['yes24', 'YES24', 'PRIVACY', 'https://www.yes24.com/Templates/FTPrivacy.aspx'],
  ['gmarket', 'G마켓', 'TERMS', 'https://www.gmarket.co.kr/pages/policy/terms'],
  ['ssg', 'SSG닷컴', 'TERMS', 'https://www.ssg.com/promotion/policyTerms.ssg'],
  ['emart', '이마트몰', 'TERMS', 'https://emart.ssg.com/policy/terms.ssg'],
  ['lotteon', '롯데온', 'TERMS', 'https://www.lotteon.com/p/display/main/policy'],
  ['wemakeprice', '위메프', 'TERMS', 'https://www.wemakeprice.com/terms'],
  ['zigzag', '지그재그', 'PRIVACY', 'https://cf.zigzag.kr/policy/privacy.html'],
  ['ably', '에이블리', 'PRIVACY', 'https://a-bly.com/privacy'],
  ['oliveyoung', '올리브영', 'TERMS', 'https://www.oliveyoung.co.kr/store/main/getAgreement.do'],
  ['interpark', '인터파크티켓', 'TERMS', 'https://ticket.interpark.com/Contents/Bbs/Terms'],
  ['megabox', '메가박스', 'TERMS', 'https://www.megabox.co.kr/support/terms'],
  ['myrealtrip', '마이리얼트립', 'TERMS', 'https://www.myrealtrip.com/terms'],
  ['zigbang', '직방', 'PRIVACY', 'https://www.zigbang.com/privacy'],
  ['bugs', '벅스', 'TERMS', 'https://music.bugs.co.kr/terms/service'],
  ['genie', '지니뮤직', 'TERMS', 'https://www.genie.co.kr/policy/terms'],
  ['upbit', '업비트', 'TERMS', 'https://upbit.com/service_center/terms_of_service'],
  ['naverpay', '네이버페이', 'TERMS', 'https://nid.naver.com/user2/help/agree'],
  ['kakaopay', '카카오페이', 'TERMS', 'https://policy.kakaopay.com/terms'],
  ['wadiz', '와디즈', 'TERMS', 'https://www.wadiz.kr/web/waccount/policy/terms'],
  ['nexon', '넥슨', 'TERMS', 'https://member.nexon.com/policy/terms.aspx'],
  ['ncsoft', '엔씨소프트', 'PRIVACY', 'https://kr.ncsoft.com/privacy'],
  ['krafton', '크래프톤', 'PRIVACY', 'https://www.krafton.com/privacy-policy/'],
  ['lguplus', 'LG유플러스', 'PRIVACY', 'https://privacy.lguplus.com/privacy/info/v1/1'],
  ['incruit', '인크루트', 'TERMS', 'https://www.incruit.com/', '홈페이지 robots.txt 가 / 전체를 차단해 문서 위치를 확인하지 못했습니다'],
  ['koreanair', '대한항공', 'PRIVACY', 'https://www.koreanair.com/', '홈페이지 robots.txt 가 / 전체를 차단해 문서 위치를 확인하지 못했습니다'],
  ['jejuair', '제주항공', 'PRIVACY', 'https://www.jejuair.net/', '홈페이지 robots.txt 가 / 전체를 차단해 문서 위치를 확인하지 못했습니다'],
  ['samsungcard', '삼성카드', 'PRIVACY', 'https://www.samsungcard.com/', '홈페이지 robots.txt 가 / 전체를 차단해 문서 위치를 확인하지 못했습니다'],
]

// ── 봇 차단(WAF) 또는 403 (§84 WAF) ────────────────────────────
const WAF_BLOCKED: [string, string, DocType, string, string][] = [
  ['naver', '네이버', 'TERMS', 'https://policy.naver.com/', '도메인 수준의 봇 차단(WAF)에 걸립니다'],
  ['naver', '네이버', 'PRIVACY', 'https://policy.naver.com/', '도메인 수준의 봇 차단(WAF)에 걸립니다'],
  ['coupang', '쿠팡', 'TERMS', 'https://www.coupang.com/', 'www.coupang.com 이 403 을 반환합니다'],
  ['danawa', '다나와', 'TERMS', 'https://www.danawa.com/info/?nPage=terms', '요청에 403 을 반환합니다'],
  ['bithumb', '빗썸', 'TERMS', 'https://www.bithumb.com/react/policy/terms', '응답이 오지 않아 타임아웃됩니다'],
]

// ── 웹에서 문서를 찾지 못함 (§84 DOCUMENT_ABSENT) ──────────────
const ABSENT: [string, string, DocType, string, string][] = [
  ['kurly', '컬리', 'TERMS', 'https://www.kurly.com/', '홈페이지에서 약관 링크를 찾지 못했고 흔한 경로는 404 입니다'],
  ['jobkorea', '잡코리아', 'PRIVACY', 'https://www.jobkorea.co.kr/', '홈페이지에서 처리방침 링크를 찾지 못했습니다'],
  ['laftel', '라프텔', 'TERMS', 'https://laftel.net/', '홈페이지에서 약관 링크를 찾지 못했습니다'],
]

const title = (name: string, type: DocType) => `${name} ${type === 'TERMS' ? '이용약관' : '개인정보 처리방침'}`
const id = (service: string, type: DocType) => `${service}-${type.toLowerCase()}`

export const DOCUMENTS: DocumentConfig[] = [
  ...ACTIVE,
  ...RENDER.map(([service, name, type, url]): DocumentConfig => ({
    id: id(service, type), service, serviceName: name, type, title: title(name, type), canonicalUrl: url,
    blocker: 'RENDER_REQUIRED', publicNote: '본문이 JavaScript 로만 렌더링됩니다. 렌더링 수집 준비 중입니다.', checkedAt: CHECKED,
  })),
  ...ROBOTS_BLOCKED.map(([service, name, type, url, note]): DocumentConfig => ({
    id: id(service, type), service, serviceName: name, type, title: title(name, type), canonicalUrl: url,
    blocker: 'ROBOTS', publicNote: note ?? 'robots.txt 가 이 경로를 차단합니다', checkedAt: CHECKED,
  })),
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
