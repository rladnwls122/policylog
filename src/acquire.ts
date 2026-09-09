// 수집 파이프라인 (§15). robots 판정 → 안전한 정적 fetch → 추출 → 정규화 → 게이트 → 해시 → 버전 → diff.
// 회피는 없다 (§2.6). User-Agent 는 env.USER_AGENT 하나뿐이고, 이 파일 밖에서 fetch 를 부르지 않는다.
// robots 판정을 게이트로 쓸지는 env.ROBOTS_MODE 가 정한다 (§24.4). 판정 자체는 어느 모드에서든 재고 기록한다.
import puppeteer from '@cloudflare/puppeteer'
import { DOCUMENTS, robotsEnforced, isCollectible, fetchModeOf, type DocumentConfig } from './documents'
import { extract, type TableBlock } from './extract'
import { normalize, sha256, gate, extractDates, sectionsOf, yyyymmdd, hangulRatio, NORMALIZATION_PROFILE, PARSER_VERSION } from './normalize'
import { diffSections, diffParagraphs, diffTables, summarize } from './diff'
import { type Env, type VersionRow, now, uid, getDocument, getVersion, updateDocument, latestVersion, findVersionByHash, insertVersion, insertChange, changeBetween, storedSourceUrls, getChange } from './db'
import { notifyChange } from './notify'
import { dbOf } from './sql'

export const HISTORY_INTERVAL_MS = 5_000       // §71.4
export const HISTORY_DAILY_CAP = 30            // §71.4
const ROBOTS_TTL_MS = 7 * 24 * 3600_000        // §24.1 주 1회
const MAX_BODY = 5 * 1024 * 1024
const TIMEOUT_MS = 20_000

// ── robots (§24) ─────────────────────────────────────────────
export type RobotsVerdict = 'ALLOWED' | 'DISALLOWED' | 'UNKNOWN'

// 수집 여부 판정은 documents.ts 에 있다 (순수 함수라 db.ts 도 같은 규칙을 쓴다).
// ADVISORY 여도 달라지지 않는 것: User-Agent 는 env.USER_AGENT 하나이고, 접근 간격 상한도 그대로다.
// 회피 수단(프록시·핑거프린트 조작·캡차)은 모드와 무관하게 코드에 없다 (§2.6).
export { robotsEnforced, isCollectible, fetchModeOf } from './documents'

export const robotsVerdict = async (env: Env, url: string) => (await robotsCheck(env, url)).verdict

/**
 * robots 판정 + 그 판정이 우리를 이름으로 지목한 그룹에서 나왔는지.
 * `User-agent: POLICYLOG` 로 명시된 거부는 ADVISORY 모드에서도 따른다 (/bot 에 그렇게 적혀 있다).
 * 포괄 규칙(`*`·경로 전체 차단)만 ADVISORY 에서 게이트로 쓰지 않는다.
 */
export async function robotsCheck(env: Env, url: string): Promise<{ verdict: RobotsVerdict; named: boolean }> {
  const u = new URL(url)
  let res: Response
  try {
    res = await rawFetch(env, `${u.origin}/robots.txt`)
  } catch { return { verdict: 'DISALLOWED', named: false } }   // 타임아웃·연결 실패 = 동의 아님 (11번가 사례)
  if (res.status === 404 || res.status === 410) return { verdict: 'ALLOWED', named: false }
  if (res.status !== 200) return { verdict: 'DISALLOWED', named: false } // 403 on robots.txt itself → DISALLOWED (쿠팡 사례)
  const ct = res.headers.get('content-type') ?? ''
  const body = await res.text()
  if (ct.includes('text/html') || /^\s*<!doctype html|^\s*<html/i.test(body)) return { verdict: 'ALLOWED', named: false } // HTML 404 페이지 (policy.yanolja.com)
  return { verdict: evaluateRobots(body, u.pathname + u.search, 'POLICYLOG'), named: robotsNamesUs(body, 'POLICYLOG') }
}

/** robots.txt 안에 `*` 가 아니라 우리 이름을 지목한 User-agent 그룹이 있는가. */
export const robotsNamesUs = (txt: string, agent: string) =>
  [...txt.matchAll(/^[ \t]*user-agent[ \t]*:(.*)$/gim)]
    .map((m) => m[1].replace(/#.*/, '').trim().toLowerCase())
    .some((a) => a !== '' && a !== '*' && agent.toLowerCase().includes(a))

/** Google 식 최장 일치. 우리 이름의 그룹이 있으면 그것만, 없으면 `*` 그룹. 그룹이 하나도 없으면 ALLOWED. */
export function evaluateRobots(txt: string, path: string, agent: string): RobotsVerdict {
  const groups: { agents: string[]; rules: { allow: boolean; pattern: string }[] }[] = []
  let cur: (typeof groups)[number] | null = null
  let lastWasAgent = false
  for (const raw of txt.split(/\r?\n/)) {
    const line = raw.replace(/#.*/, '').trim()
    if (!line) continue
    const m = line.match(/^([a-z-]+)\s*:\s*(.*)$/i)
    if (!m) continue
    const [, k, v] = [m[0], m[1].toLowerCase(), m[2].trim()]
    if (k === 'user-agent') {
      if (!cur || !lastWasAgent) { cur = { agents: [], rules: [] }; groups.push(cur) }
      cur.agents.push(v.toLowerCase()); lastWasAgent = true
    } else if ((k === 'allow' || k === 'disallow') && cur) {
      if (v) cur.rules.push({ allow: k === 'allow', pattern: v })
      lastWasAgent = false
    } else lastWasAgent = false
  }
  const mine = groups.filter((g) => g.agents.some((a) => a !== '*' && agent.toLowerCase().includes(a)))
  const star = groups.filter((g) => g.agents.includes('*'))
  const rules = (mine.length ? mine : star).flatMap((g) => g.rules)
  if (!rules.length) return 'ALLOWED'
  let best: { allow: boolean; len: number } | null = null
  for (const r of rules) {
    if (!matchRobots(r.pattern, path)) continue
    if (!best || r.pattern.length > best.len || (r.pattern.length === best.len && r.allow)) best = { allow: r.allow, len: r.pattern.length }
  }
  return !best || best.allow ? 'ALLOWED' : 'DISALLOWED'
}

function matchRobots(pattern: string, path: string): boolean {
  const re = '^' + pattern.split('*').map((s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*').replace(/\\\$$/, '$')
  return new RegExp(pattern.endsWith('$') ? re : re).test(path)
}

// ── 안전한 fetch (§43 SSRF, §24.2 UA) ─────────────────────────
function assertSafeUrl(url: string) {
  const u = new URL(url)
  if (u.protocol !== 'https:') throw new Error(`UNSAFE_SCHEME ${u.protocol}`)
  const h = u.hostname.toLowerCase()
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.internal') || h.endsWith('.local') || /^[\d.]+$/.test(h) || h.includes(':'))
    throw new Error(`UNSAFE_HOST ${h}`)
}

async function rawFetch(env: Env, url: string): Promise<Response> {
  assertSafeUrl(url)
  let current = url
  for (let hop = 0; hop < 5; hop++) {
    const ctl = new AbortController()
    const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS)
    let res: Response
    try {
      res = await fetch(current, { headers: { 'user-agent': env.USER_AGENT, accept: 'text/html,application/xhtml+xml,*/*;q=0.8', 'accept-language': 'ko' }, redirect: 'manual', signal: ctl.signal })
    } finally { clearTimeout(timer) }
    if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
      current = new URL(res.headers.get('location')!, current).toString()
      assertSafeUrl(current)
      continue
    }
    const len = Number(res.headers.get('content-length') ?? 0)
    if (len > MAX_BODY) throw new Error('BODY_TOO_LARGE')
    return res
  }
  throw new Error('TOO_MANY_REDIRECTS')
}

/** 본문 fetch. 403 은 답이지 오류가 아니다 — 재시도하지 않는다 (§24.4). */
/**
 * 렌더링 수집 (§85). Cloudflare Browser Rendering 으로 페이지를 띄우고 렌더된 DOM 을 돌려준다.
 * 헤드리스 크롬을 직접 붙이지 않고 @cloudflare/puppeteer 를 그대로 쓴다.
 *
 * 브라우저를 쓴다고 회피를 하는 게 아니다 (§2.6) — User-Agent 는 여전히 env.USER_AGENT 하나이고,
 * 스텔스 플러그인·핑거프린트 조작·캡차 해결은 붙이지 않는다. JS 로만 그려지는 본문을 읽을 뿐이다.
 */
export async function renderDocument(env: Env, url: string): Promise<{ status: number; html: string; finalUrl: string }> {
  assertSafeUrl(url)
  if (!env.BROWSER) throw new Error('NO_BROWSER_BINDING')
  const browser = await puppeteer.launch(env.BROWSER)
  try {
    const page = await browser.newPage()
    await page.setUserAgent(env.USER_AGENT)
    await page.setExtraHTTPHeaders({ 'accept-language': 'ko' })
    const res = await page.goto(url, { waitUntil: 'networkidle0', timeout: TIMEOUT_MS })
    const html = await page.content()
    if (html.length > MAX_BODY) throw new Error('BODY_TOO_LARGE')
    return { status: res?.status() ?? 0, html, finalUrl: page.url() }
  } finally {
    await browser.close()
  }
}

export async function fetchDocument(env: Env, url: string, mode: 'STATIC' | 'RENDER' = 'STATIC'): Promise<{ status: number; html: string; finalUrl: string }> {
  if (mode === 'RENDER') return renderDocument(env, url)
  const res = await rawFetch(env, url)
  const buf = await res.arrayBuffer()
  if (buf.byteLength > MAX_BODY) throw new Error('BODY_TOO_LARGE')
  const charset = /charset=([\w-]+)/i.exec(res.headers.get('content-type') ?? '')?.[1]
  let html: string
  try { html = new TextDecoder(charset ?? 'utf-8').decode(buf) } catch { html = new TextDecoder('utf-8').decode(buf) }
  if (!charset) { const meta = /<meta[^>]+charset=["']?([\w-]+)/i.exec(html.slice(0, 4000))?.[1]; if (meta && !/utf-?8/i.test(meta)) { try { html = new TextDecoder(meta).decode(buf) } catch {} } }
  return { status: res.status, html, finalUrl: res.url || url }
}

// ── 이력 하베스터 (§71) ───────────────────────────────────────
export interface HistoricalRef { key: string; url: string; effectiveAt?: string }

export async function harvest(env: Env, doc: DocumentConfig): Promise<HistoricalRef[]> {
  const h = doc.history
  if (!h) return []
  const { status, html } = await fetchDocument(env, h.indexUrl)
  if (status !== 200) throw new Error(`INDEX_HTTP_${status}`)
  const re = new RegExp(h.entryPattern, 'g')
  const seen = new Set<string>()
  const refs: HistoricalRef[] = []
  for (const m of html.matchAll(re)) {
    const key = m[1]
    if (seen.has(key)) continue
    seen.add(key)
    const ref: HistoricalRef = { key, url: h.urlTemplate.replace('{key}', key) }
    if (h.keyIsDate) ref.effectiveAt = yyyymmdd(key) ?? undefined
    refs.push(ref)
  }
  return refs
}

// ── 한 번의 캡처 ─────────────────────────────────────────────
export interface CaptureResult { created: boolean; versionId?: string; reason?: string; hash?: string }

export async function capture(env: Env, doc: DocumentConfig, opts: { url: string; provenance: 'OFFICIAL_HISTORY' | 'SELF_FETCH'; effectiveAt?: string; versionKey?: string; earliest?: string | null; publishGate?: boolean }): Promise<CaptureResult> {
  const ex = doc.extraction!
  const observedAt = now()
  const { status, html, finalUrl } = await fetchDocument(env, opts.url, fetchModeOf(doc))
  if (status !== 200) return { created: false, reason: `HTTP_${status}` }

  const extracted = await extract(html, ex.selector, ex.ignore)
  const text = normalize(extracted.text)
  const prev = await latestVersion(env, doc.id)
  const g = gate(text, prev ? { length: prev.normalized_text.length, hangulRatio: hangulRatio(prev.normalized_text) } : undefined)
  if (!g.ok) return { created: false, reason: g.reason }

  const hash = await sha256(text)
  const dup = await findVersionByHash(env, doc.id, NORMALIZATION_PROFILE, hash)
  if (dup) return { created: false, reason: 'UNCHANGED', hash, versionId: dup.id }

  // 반플랩 (§73 Layer 3): 실시간 감지는 같은 해시를 두 번 봐야 발행. 시행일이 새로 뽑히면 즉시.
  const dates = extractDates(text, { leadingDate: ex.leadingDate })
  const effectiveAt = opts.effectiveAt ?? dates.effectiveAt ?? null   // T3 라벨 > 본문 추출 (§72.1)
  if (opts.publishGate) {
    const d = await getDocument(env, doc.id)
    const datedRevision = effectiveAt && effectiveAt !== prev?.effective_at
    if (d?.pending_hash !== hash && !datedRevision) {
      await updateDocument(env, doc.id, { pending_hash: hash })
      return { created: false, reason: 'PENDING_CONFIRMATION', hash }
    }
  }

  const id = uid()
  const rawKey = `raw/${doc.id}/${id}.html`
  await env.RAW.put(rawKey, html, { httpMetadata: { contentType: 'text/html; charset=utf-8' }, customMetadata: { sourceUrl: finalUrl, observedAt } })
  const v: VersionRow = {
    id, document_id: doc.id, observed_at: observedAt, effective_at: effectiveAt, announced_at: dates.announcedAt ?? null,
    earliest_possible_change_at: opts.earliest ?? null, lifecycle: 'CURRENT', source_url: opts.url, provenance: opts.provenance,
    acquisition_tier: opts.provenance === 'OFFICIAL_HISTORY' ? 'T3' : 'T1', fetch_mode: 'STATIC', raw_object_key: rawKey,
    normalized_text: text, content_hash: hash, normalization_profile_id: NORMALIZATION_PROFILE, parser_version: PARSER_VERSION,
    extraction_method: `html:${ex.selector}`,
    metadata: JSON.stringify({ title: extracted.title, finalUrl, versionKey: opts.versionKey, versionKeySource: opts.effectiveAt ? 'HISTORY_LABEL' : dates.effectiveAt ? 'IN_TEXT' : 'NONE', dates: dates.all.slice(0, 20), tables: extracted.tables, sectionCount: sectionsOf(text).length }),
    created_at: observedAt,
  }
  await insertVersion(env, v)
  if (opts.publishGate) await updateDocument(env, doc.id, { pending_hash: null })
  return { created: true, versionId: id, hash }
}

// ── 백필 (§72): 공식 이력 → 버전 → 억제된 변경 ─────────────────
export async function backfill(env: Env, docId: string, cap = HISTORY_DAILY_CAP, sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))) {
  const doc = DOCUMENTS.find((d) => d.id === docId)
  if (!doc?.history || !isCollectible(env, doc)) throw new Error('NOT_HARVESTABLE')
  await ensureAllowed(env, doc)
  const refs = await harvest(env, doc)
  const stored = await storedSourceUrls(env, docId)
  const todo = refs.filter((r) => !stored.has(r.url)).slice(0, cap)
  const log: { key: string; result: CaptureResult }[] = []
  for (const [i, ref] of todo.entries()) {
    if (i) await sleep(HISTORY_INTERVAL_MS)
    try {
      log.push({ key: ref.key, result: await capture(env, doc, { url: ref.url, provenance: 'OFFICIAL_HISTORY', effectiveAt: ref.effectiveAt, versionKey: ref.key }) })
    } catch (e) { log.push({ key: ref.key, result: { created: false, reason: String(e) } }) }
  }
  await rebuildChanges(env, docId, 'BACKFILL')
  await updateDocument(env, docId, { last_checked_at: now(), last_success_at: now(), last_error: null })
  return { total: refs.length, attempted: todo.length, remaining: refs.length - stored.size - todo.length, log }
}

/** 시간순 인접 버전 쌍마다 change 를 만든다. 이미 있으면 건너뛴다. 백필 변경은 알림 대상이 아니다 (§72.2). */
export async function rebuildChanges(env: Env, docId: string, suppressedReason: string | null) {
  const vs = await dbOf(env).all<VersionRow>(`SELECT * FROM versions WHERE document_id = ? ORDER BY COALESCE(effective_at, substr(observed_at,1,10)), observed_at`, [docId])
  for (let i = 1; i < vs.length; i++) {
    if (await changeBetween(env, vs[i - 1].id, vs[i].id)) continue
    await createChange(env, vs[i - 1], vs[i], suppressedReason)
  }
}

export async function createChange(env: Env, from: VersionRow, to: VersionRow, suppressedReason: string | null) {
  if (from.normalization_profile_id !== to.normalization_profile_id) throw new Error('CROSS_PROFILE_COMPARISON') // §21
  const sa = sectionsOf(from.normalized_text), sb = sectionsOf(to.normalized_text)
  const sections = sa.length && sb.length ? diffSections(sa, sb) : diffParagraphs(from.normalized_text, to.normalized_text)
  const ta: TableBlock[] = JSON.parse(from.metadata).tables ?? [], tb: TableBlock[] = JSON.parse(to.metadata).tables ?? []
  const tableRows = diffTables(ta, tb)
  const { importance, categories } = summarize(sections, tableRows)
  const id = uid()
  await insertChange(env, {
    id, document_id: to.document_id, from_version_id: from.id, to_version_id: to.id, importance, categories: JSON.stringify(categories),
    sections: JSON.stringify(sections), table_rows: JSON.stringify(tableRows),
    detection_window_start: to.earliest_possible_change_at, detection_window_end: to.observed_at, suppressed_reason: suppressedReason, created_at: now(),
  })
  // insertChange 는 (from, to) 가 이미 있으면 조용히 넘긴다. 그때는 방금 만든 id 가 아니라 살아 있는 행의 id 를 돌려준다 —
  // 부르는 쪽이 이 id 로 행을 다시 읽기 때문에, 새 id 를 주면 없는 행을 가리킨다.
  return (await changeBetween(env, from.id, to.id))?.id ?? id
}

// ── 실시간 폴링 (§47): 현재 본문 캡처, 새 버전이면 변경 발행 ────
export async function poll(env: Env, docId: string) {
  const doc = DOCUMENTS.find((d) => d.id === docId)
  if (!doc || !isCollectible(env, doc)) return { skipped: 'NOT_ACTIVE' }
  const row = await getDocument(env, docId)
  try {
    await ensureAllowed(env, doc)
    const prev = await latestVersion(env, docId)
    const r = await capture(env, doc, { url: doc.canonicalUrl, provenance: 'SELF_FETCH', earliest: row?.last_success_at ?? null, publishGate: true })
    await updateDocument(env, docId, { last_checked_at: now(), last_error: r.created || r.reason === 'UNCHANGED' || r.reason === 'PENDING_CONFIRMATION' ? null : r.reason, ...(r.created || r.reason === 'UNCHANGED' ? { last_success_at: now() } : {}) })
    if (r.created && prev) {
      const to = (await getVersion(env, r.versionId!))!
      const changeId = await createChange(env, prev, to, null)
      // 알림 실패는 수집 실패가 아니다. 기록은 이미 남았으니 여기서 삼킨다.
      const c = (await getChange(env, changeId))!
      await notifyChange(env, c, to.effective_at, to.observed_at).catch((e) => console.error('notify', docId, String(e)))
    }
    return r
  } catch (e) {
    await updateDocument(env, docId, { last_checked_at: now(), last_error: String(e) })
    return { created: false, reason: String(e) }
  }
}

async function ensureAllowed(env: Env, doc: DocumentConfig) {
  const row = await getDocument(env, doc.id)
  const stale = !row?.robots_checked_at || Date.now() - Date.parse(row.robots_checked_at) > ROBOTS_TTL_MS
  let verdict = row?.robots_verdict as RobotsVerdict | undefined
  let named = row?.robots_named === 1
  if (stale || verdict === 'UNKNOWN') {
    ;({ verdict, named } = await robotsCheck(env, doc.canonicalUrl))
    // 이력 인덱스와 과거 본문이 다른 호스트에 있을 수 있다 (리디: ridibooks.com → policy.ridi.com).
    // 실제로 가져올 모든 호스트를 각각 판정한다 (§16.1).
    for (const url of doc.history ? [doc.history.indexUrl, doc.history.urlTemplate.replace('{key}', 'v1')] : [])
      if (verdict === 'ALLOWED') ({ verdict, named } = await robotsCheck(env, url))
    const demote = verdict !== 'ALLOWED' && (robotsEnforced(env) || named)
    await updateDocument(env, doc.id, { robots_verdict: verdict, robots_named: named ? 1 : 0, robots_checked_at: now(), ...(demote ? { status: 'BLOCKED', blocker_type: 'ROBOTS' } : {}) })
  }
  // 우리를 이름으로 지목한 거부는 모드와 무관하게 따른다. 포괄 규칙만 ADVISORY 에서 넘어간다 (§24.4).
  if (verdict !== 'ALLOWED' && (robotsEnforced(env) || named)) throw new Error(`ROBOTS_${verdict}${named ? '_BY_NAME' : ''}`)
}

/** 크론: 활성 문서 전부 폴링. 도메인당 10초 간격 (§24.3). */
export async function runScheduled(env: Env) {
  const results: Record<string, unknown> = {}
  let lastHost = ''
  for (const doc of DOCUMENTS.filter((d) => isCollectible(env, d))) {
    const host = new URL(doc.canonicalUrl).host
    if (host === lastHost) await new Promise((r) => setTimeout(r, 10_000))
    lastHost = host
    results[doc.id] = await poll(env, doc.id)
  }
  return results
}

// ── 후보 탐색 (§16.1) ────────────────────────────────────────
// 새 문서를 카탈로그에 넣기 전에 robots 를 먼저 보고, 허용된 경우에만 본문을 확인한다.
// 차단이면 그 사실만 돌려주고 페이지는 건드리지 않는다.

const POLICY_LINK = /이용\s*약관|서비스\s*약관|개인정보\s*(처리|취급)?\s*방침|privacy|terms|policy/i
const CANDIDATE_SELECTORS = ['main', 'article', 'div#content', 'div#container', 'div.content', 'div.policy', 'section', 'body']

export interface LinkCandidate { url: string; text: string; type: 'TERMS' | 'PRIVACY' | 'UNKNOWN' }

/** 홈페이지에서 약관·처리방침으로 보이는 링크를 긁는다. 다른 호스트로 넘어가는 링크도 포함한다. */
export async function discover(env: Env, pageUrl: string): Promise<{ robots: RobotsVerdict; status?: number; links: LinkCandidate[] }> {
  const robots = await robotsVerdict(env, pageUrl)
  if (robots !== 'ALLOWED' && robotsEnforced(env)) return { robots, links: [] }
  const { status, html, finalUrl } = await fetchDocument(env, pageUrl)
  const links: LinkCandidate[] = []
  const seen = new Set<string>()
  for (const m of html.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]{0,200}?)<\/a>/gi)) {
    const text = m[2].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
    if (!POLICY_LINK.test(text) && !POLICY_LINK.test(m[1])) continue
    let url: string
    try { url = new URL(m[1], finalUrl).toString() } catch { continue }
    if (!url.startsWith('https://') || seen.has(url)) continue
    seen.add(url)
    const t = text + ' ' + url
    links.push({ url, text: text.slice(0, 60), type: /개인정보|privacy/i.test(t) ? 'PRIVACY' : /약관|terms/i.test(t) ? 'TERMS' : 'UNKNOWN' })
  }
  return { robots, status, links }
}

export interface ProbeResult {
  url: string
  robots: RobotsVerdict
  status?: number
  best?: { selector: string; textLength: number; sections: number; tables: number; effectiveAt?: string; gate: string }
  tried?: { selector: string; textLength: number; sections: number; gate: string }[]
  historyHint?: string
  error?: string
}

/** 후보 URL 한 개를 실제 파이프라인으로 재본다. 셀렉터는 여러 개 시도하고 가장 나은 것을 고른다. */
export async function probe(env: Env, url: string, selectors = CANDIDATE_SELECTORS, mode: 'STATIC' | 'RENDER' = 'STATIC'): Promise<ProbeResult> {
  const robots = await robotsVerdict(env, url)
  if (robots !== 'ALLOWED' && robotsEnforced(env)) return { url, robots }
  let status: number, html: string
  try { ({ status, html } = await fetchDocument(env, url, mode)) } catch (e) { return { url, robots, error: String(e) } }
  if (status !== 200) return { url, robots, status }

  const tried: NonNullable<ProbeResult['tried']> = []
  let best: ProbeResult['best']
  for (const selector of selectors) {
    const e = await extract(html, selector, ['nav', 'header', 'footer', 'aside', 'script', 'style', 'button', 'svg', 'select'])
    const text = normalize(e.text)
    const g = gate(text)
    const sections = sectionsOf(text).length
    tried.push({ selector, textLength: text.length, sections, gate: g.ok ? 'ok' : g.reason })
    if (!g.ok) continue
    // 조문이 잡히고 짧은 쪽이 낫다 — body 는 언제나 통과하지만 네비게이션까지 함께 들어온다.
    const better = !best || sections > best.sections || (sections === best.sections && text.length < best.textLength)
    if (better) best = { selector, textLength: text.length, sections, tables: e.tables.length, effectiveAt: extractDates(text).effectiveAt, gate: 'ok' }
  }
  return { url, robots, status, best, tried, historyHint: historyHint(html) }
}

/** 공식 이력이 있을 법한 흔적. 실제 하베스터는 사람이 보고 붙인다. */
function historyHint(html: string): string {
  const opts = (html.match(/<option[^>]*>[^<]*20\d{2}[^<]*</g) ?? []).length
  const dated = new Set((html.match(/href="[^"]*(?:20\d{2}[-.]?\d{2}[-.]?\d{2}|version=|prev|history)[^"]*"/gi) ?? []).map((s) => s.slice(0, 80)))
  const hints: string[] = []
  if (opts >= 3) hints.push(`날짜 option ${opts}개`)
  if (dated.size >= 3) hints.push(`버전 링크 후보 ${dated.size}개`)
  return hints.join(' · ')
}
