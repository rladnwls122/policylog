import { describe, it, expect } from 'vitest'
import { evaluateRobots, robotsEnforced, isCollectible } from '../src/acquire'
import { shapeVersion, EXCERPT_CAP, DOCUMENT_SHARE_CAP } from '../src/public'
import { DOCUMENTS } from '../src/documents'
import type { VersionRow } from '../src/db'

// 소스 전체를 문자열로 읽어 규칙 위반을 찾는다. 번들에 포함되므로 워커 안에서도 동작한다.
const SOURCE = Object.entries(import.meta.glob('../src/**/*.{ts,tsx}', { query: '?raw', import: 'default', eager: true }) as Record<string, string>)
const source = () => SOURCE

describe('D-1: 전체 본문은 공개 표면에 나가지 않는다 (§67.2)', () => {
  const v: VersionRow = {
    id: 'v1', document_id: 'd', observed_at: '2026-09-07T00:00:00Z', effective_at: '2026-09-01', announced_at: null,
    earliest_possible_change_at: null, lifecycle: 'CURRENT', source_url: 'https://x/', provenance: 'SELF_FETCH',
    acquisition_tier: 'T1', fetch_mode: 'STATIC', raw_object_key: 'k', normalized_text: '제1조 (목적)\n' + '가'.repeat(20_000),
    content_hash: 'h', normalization_profile_id: 'v1', parser_version: '0.1.0', extraction_method: 'html', metadata: '{}', created_at: '',
  }
  const shaped = shapeVersion(v, [{ identifier: '제1조', title: '목적', content: '가'.repeat(20_000) }])

  it('shapeVersion 은 normalized_text 를 내보내지 않는다', () => {
    expect(JSON.stringify(shaped)).not.toContain('normalized_text')
    expect(JSON.stringify(shaped).length).toBeLessThan(v.normalized_text.length)
  })
  it('조문 발췌는 800자 상한을 넘지 않는다', () => {
    for (const s of shaped.sections) expect(s.excerpt.length).toBeLessThanOrEqual(EXCERPT_CAP)
  })
  it('한 응답이 문서의 20% 를 넘지 않는다', () => {
    const total = shaped.sections.reduce((n, s) => n + s.excerpt.length, 0)
    expect(total).toBeLessThanOrEqual(v.normalized_text.length * DOCUMENT_SHARE_CAP)
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
  it('fetch 호출은 acquire.ts 안에만 있다', () => {
    for (const [p, s] of source())
      if (!p.endsWith('acquire.ts')) expect(s.replace(/app\.fetch|\.fetch\b/g, ''), p).not.toMatch(/(?<![.\w])fetch\s*\(/)
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
