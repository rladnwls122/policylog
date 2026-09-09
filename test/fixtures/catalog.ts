// 테스트가 쓰는 카탈로그. 운영 카탈로그(src/documents.ts)는 수집 대상 정책이 바뀔 때마다 흔들린다 —
// 2026-09-09 에 대상을 중소기업으로 한정하면서 79건이 4건이 됐고, 거기에 기대던 테스트가 전부 깨졌다.
// 파이프라인과 화면이 맞게 도는지는 대상 정책과 무관한 사실이므로, 스냅샷 픽스처와 짝이 맞는 목록을 여기 고정한다.
import type { DocumentConfig, DocType } from '../../src/documents'

const CHECKED = '2026-09-07'
const IGNORE = ['nav', 'header', 'footer', 'aside', 'script', 'style', 'button', 'svg']

/** test/fixtures 의 HTML 스냅샷과 짝이 맞는 둘. 추출·정규화·diff 테스트가 이 설정을 그대로 쓴다. */
const REAL: DocumentConfig[] = [
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
]

/** 화면 테스트가 그리드·상위 세 장·비회원 상한을 재려면 기업이 넉넉해야 한다. 본문은 필요 없으므로 설정만 채운다. */
const FILLER: [string, string, DocType, 'NONE' | 'RENDER_REQUIRED' | 'WAF'][] = [
  ['ridi', '리디', 'TERMS', 'NONE'],
  ['ridi', '리디', 'PRIVACY', 'NONE'],
  ['saramin', '사람인', 'TERMS', 'NONE'],
  ['melon', '멜론', 'TERMS', 'NONE'],
  ['socar', '쏘카', 'PRIVACY', 'NONE'],
  ['kakao', '카카오', 'TERMS', 'NONE'],
  ['kakao', '카카오', 'PRIVACY', 'NONE'],
  ['wanted', '원티드', 'TERMS', 'RENDER_REQUIRED'],
  ['baemin', '배달의민족', 'TERMS', 'RENDER_REQUIRED'],
  ['coupang', '쿠팡', 'TERMS', 'WAF'],
  ['naver', '네이버', 'TERMS', 'WAF'],
]

export const TEST_DOCS: DocumentConfig[] = [
  ...REAL,
  ...FILLER.map(([service, serviceName, type, blocker]): DocumentConfig => ({
    id: `${service}-${type.toLowerCase()}`, service, serviceName, type,
    title: `${serviceName} ${type === 'TERMS' ? '이용약관' : '개인정보 처리방침'}`,
    canonicalUrl: `https://${service}.example/${type.toLowerCase()}`,
    blocker,
    ...(blocker === 'NONE' ? { extraction: { selector: 'main', ignore: IGNORE } } : { publicNote: '테스트 픽스처' }),
    checkedAt: CHECKED,
  })),
]

export const testDoc = (id: string) => TEST_DOCS.find((d) => d.id === id)!
