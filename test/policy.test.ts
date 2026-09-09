import { describe, it, expect } from 'vitest'
import { evaluateRobots, robotsEnforced, isCollectible, dueDocuments } from '../src/acquire'
import { shapeVersion } from '../src/public'
import { DOCUMENTS, type DocumentConfig } from '../src/documents'
import type { VersionRow } from '../src/db'

// 소스 전체를 문자열로 읽어 규칙 위반을 찾는다. 번들에 포함되므로 워커 안에서도 동작한다.
const SOURCE = Object.entries(import.meta.glob('../src/**/*.{ts,tsx}', { query: '?raw', import: 'default', eager: true }) as Record<string, string>)
const source = () => SOURCE

describe('공개 표면은 조문 단위로 준다', () => {
  const v: VersionRow = {
    id: 'v1', document_id: 'd', observed_at: '2026-09-07T00:00:00Z', effective_at: '2026-09-01', announced_at: null,
    earliest_possible_change_at: null, lifecycle: 'CURRENT', source_url: 'https://x/', provenance: 'SELF_FETCH',
    acquisition_tier: 'T1', fetch_mode: 'STATIC', raw_object_key: 'k', normalized_text: '제1조 (목적)\n' + '가'.repeat(20_000),
    content_hash: 'h', normalization_profile_id: 'v1', parser_version: '0.1.0', extraction_method: 'html', metadata: '{}', created_at: '',
  }
  const shaped = shapeVersion(v, [{ identifier: '제1조', title: '목적', content: '가'.repeat(20_000) }])

  it('normalized_text 통짜 필드는 내보내지 않는다 — 조문으로 쪼개 준다', () => {
    expect(JSON.stringify(shaped)).not.toContain('normalized_text')
    expect(shaped.textLength).toBe(v.normalized_text.length)
  })
  it('조문 본문은 자르지 않는다', () => {
    expect(shaped.sections).toHaveLength(1)
    expect(shaped.sections[0].text).toHaveLength(20_000)
  })
})

describe('§2.6: 회피 수단이 코드에 존재하지 않는다', () => {
  it('User-Agent 는 설정된 하나뿐이다', () => {
    for (const [p, s] of source()) {
      const uas = [...s.matchAll(/['"]user-agent['"]\s*:\s*(.+)/gi)].map((m) => m[1])
      for (const ua of uas) expect(ua, p).toMatch(/env\.USER_AGENT/)
      expect(s, p).not.toMatch(/Mozilla\/5\.0|Chrome\/\d|Safari\/\d/)
    }
  })
  it('프록시·핑거프린트 조작 코드가 없다', () => {
    for (const [p, s] of source())
      expect(s, p).not.toMatch(/proxy(Url|Pool|Rotat)|residential|navigator\.webdriver|stealth|undetected|solveCaptcha|ja3/i)
  })
  it('fetch 호출은 acquire.ts 와, 호스트가 상수인 호출 하나뿐인 auth.ts(Google 토큰)·notify.ts(Resend) 안에만 있다', () => {
    for (const [p, s] of source()) {
      if (p.endsWith('acquire.ts')) continue
      const body = s.replace(/app\.fetch|\.fetch\b/g, '')
      if (p.endsWith('notify.ts')) {
        expect(body.match(/(?<![.\w])fetch\s*\(/g) ?? [], p).toHaveLength(1)
        expect(body, p).toMatch(/fetch\(RESEND_URL,/)
        expect(s, p).toMatch(/RESEND_URL = 'https:\/\/api\.resend\.com\/emails'/)
        continue
      }
      if (p.endsWith('auth.ts')) {
        // 수집이 아니라 로그인이다. 호스트가 상수로 고정된 호출 하나만 허용한다.
        expect(body.match(/(?<![.\w])fetch\s*\(/g) ?? [], p).toHaveLength(1)
        expect(body, p).toMatch(/fetch\(GOOGLE_TOKEN_URL,/)
        expect(s, p).toMatch(/GOOGLE_TOKEN_URL = 'https:\/\/oauth2\.googleapis\.com\/token'/)
        continue
      }
      expect(body, p).not.toMatch(/(?<![.\w])fetch\s*\(/)
    }
  })
})

describe('robots 판정 (§24)', () => {
  it('Disallow 경로를 차단한다 (당근 이용약관 사례)', () => {
    expect(evaluateRobots('User-agent: *\nDisallow: /policy', '/policy/terms/', 'POLICYLOG')).toBe('DISALLOWED')
  })
  it('전체 차단은 전체 차단이다 (멜론 사례)', () => {
    expect(evaluateRobots('User-agent: Googlebot\nAllow: /album\n\nUser-agent: *\nDisallow: /', '/policy/terms', 'POLICYLOG')).toBe('DISALLOWED')
  })
  it('더 긴 Allow 가 Disallow 를 이긴다', () => {
    expect(evaluateRobots('User-agent: *\nDisallow: /\nAllow: /policy/privacy', '/policy/privacy', 'POLICYLOG')).toBe('ALLOWED')
  })
  it('우리 이름으로 된 그룹이 있으면 그 그룹만 본다', () => {
    const txt = 'User-agent: POLICYLOG\nAllow: /\n\nUser-agent: *\nDisallow: /'
    expect(evaluateRobots(txt, '/policy', 'POLICYLOG')).toBe('ALLOWED')
  })
  it('규칙이 없으면 허용 (토스 사례)', () => {
    expect(evaluateRobots('User-agent: *\nDisallow: /auth/\nSitemap: https://x/s.xml', '/docs/11027', 'POLICYLOG')).toBe('ALLOWED')
  })
  it('빈 Disallow 는 규칙이 아니다', () => {
    expect(evaluateRobots('User-agent: *\nDisallow:', '/anything', 'POLICYLOG')).toBe('ALLOWED')
  })
})

describe('robots 모드 (§24.4)', () => {
  const env = (m?: string) => ({ ROBOTS_MODE: m } as unknown as Parameters<typeof robotsEnforced>[0])
  const doc = (over: Partial<(typeof DOCUMENTS)[number]>) => ({ ...DOCUMENTS[0], ...over })

  it('기본은 ENFORCE 다 — 설정을 안 건드리면 동작이 안 바뀐다', () => {
    expect(robotsEnforced(env(undefined))).toBe(true)
    expect(robotsEnforced(env('ENFORCE'))).toBe(true)
    expect(robotsEnforced(env('ADVISORY'))).toBe(false)
  })
  it('ENFORCE 에서는 robots 차단 문서가 수집 대상이 아니다', () => {
    expect(isCollectible(env('ENFORCE'), doc({ blocker: 'ROBOTS', extraction: { selector: 'main' } }))).toBe(false)
  })
  it('ADVISORY 에서는 셀렉터가 실측된 robots 차단 문서만 열린다', () => {
    expect(isCollectible(env('ADVISORY'), doc({ blocker: 'ROBOTS', extraction: { selector: 'main' } }))).toBe(true)
    expect(isCollectible(env('ADVISORY'), doc({ blocker: 'ROBOTS', extraction: undefined }))).toBe(false)
  })
  it('ADVISORY 라도 WAF·렌더링·문서없음은 열리지 않는다', () => {
    for (const b of ['WAF', 'RENDER_REQUIRED', 'DOCUMENT_ABSENT'] as const)
      expect(isCollectible(env('ADVISORY'), doc({ blocker: b, extraction: { selector: 'main' } })), b).toBe(false)
  })
  it('모드는 robots 판정 자체를 바꾸지 않는다 — 차단은 계속 차단으로 기록된다', () => {
    expect(evaluateRobots('User-agent: *\nDisallow: /policy', '/policy/terms/', 'POLICYLOG')).toBe('DISALLOWED')
  })
})

describe('카탈로그 불변식 (§2.7, §19)', () => {
  // ROBOTS 는 우리 쪽 정책 게이트라 ADVISORY 에서 열 수 있다 (§24.4). 나머지 셋은 기술적으로 못 가져온다.
  it('robots 외의 차단은 추출 설정을 갖지 않는다 — 가져올 방법 자체가 없다', () => {
    for (const d of DOCUMENTS) if (d.blocker !== 'NONE' && d.blocker !== 'ROBOTS') { expect(d.extraction, d.id).toBeUndefined(); expect(d.history, d.id).toBeUndefined() }
  })
  it('추출 설정 없는 robots 차단 문서는 어느 모드에서도 수집 대상이 아니다', () => {
    const advisory = { ROBOTS_MODE: 'ADVISORY' } as unknown as Parameters<typeof isCollectible>[0]
    for (const d of DOCUMENTS) if (d.blocker === 'ROBOTS' && !d.extraction) expect(isCollectible(advisory, d), d.id).toBe(false)
  })
  it('차단된 문서는 공개 사유 문구를 갖는다', () => {
    for (const d of DOCUMENTS) if (d.blocker !== 'NONE') expect(d.publicNote, d.id).toBeTruthy()
  })
  it('수집 대상은 모두 https 다', () => {
    for (const d of DOCUMENTS) expect(d.canonicalUrl.startsWith('https://'), d.id).toBe(true)
  })
  it('문서 id 는 유일하다', () => {
    expect(new Set(DOCUMENTS.map((d) => d.id)).size).toBe(DOCUMENTS.length)
  })
})

describe('조회 주기 (§24.3)', () => {
  const doc = (id: string): DocumentConfig => ({
    id, service: id, serviceName: id, type: 'TERMS', title: id,
    canonicalUrl: `https://${id}.example/terms`, blocker: 'NONE',
    extraction: { selector: 'main' }, checkedAt: '2026-01-01',
  })
  const at = Date.parse('2026-09-09T00:00:00Z')
  const ago = (days: number) => new Date(at - days * 86_400_000).toISOString()

  it('주기가 안 된 문서는 가져오지 않는다', () => {
    const docs = [doc('a'), doc('b')]
    const rows = new Map([['a', ago(10)], ['b', ago(89)]])
    expect(dueDocuments(docs, rows, at)).toEqual([])
  })
  it('한 번도 안 본 문서가 가장 먼저다', () => {
    const docs = [doc('a'), doc('b')]
    const rows = new Map<string, string | null>([['a', ago(200)], ['b', null]])
    expect(dueDocuments(docs, rows, at).map((d) => d.id)).toEqual(['b'])
  })
  it('한꺼번에 만기가 돼도 하루 몫만 집는다 — 다음 주기에는 저절로 흩어진다', () => {
    const docs = Array.from({ length: 180 }, (_, i) => doc(`d${String(i).padStart(3, '0')}`))
    const rows = new Map(docs.map((d) => [d.id, ago(100)]))
    expect(dueDocuments(docs, rows, at)).toHaveLength(2)   // 180 / 90
  })
  it('오래 안 본 것부터 가져온다', () => {
    const docs = [doc('a'), doc('b'), doc('c')]
    const rows = new Map([['a', ago(91)], ['b', ago(400)], ['c', ago(200)]])
    expect(dueDocuments(docs, rows, at).map((d) => d.id)).toEqual(['b'])
  })
})
