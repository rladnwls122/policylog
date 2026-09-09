// 저장소 접근. versions 는 INSERT 전용 — 이 파일에 versions 의 UPDATE/DELETE 는 없다 (§44).
// 엔진(Postgres · 테스트용 D1)과 연결 범위는 sql.ts 가 맡는다. 여기 쿼리는 두 엔진이 함께 읽는 문법만 쓴다.
import { DOCUMENTS, isCollectible, type DocumentConfig } from './documents'
import { dbOf, stmt } from './sql'

/** 워커 바인딩. 실제 선언은 src/env.d.ts 의 Cloudflare.Env 다 — 테스트의 env 와 같은 타입을 쓴다. */
export type Env = Cloudflare.Env

export interface DocumentRow {
  id: string; service: string; service_name: string; type: string; title: string; canonical_url: string
  status: string; acquisition_tier: string; blocker_type: string; fetch_mode: string
  robots_verdict: string; robots_named: number; robots_checked_at: string | null; official_history_url: string | null; history_harvester: string | null
  public_note: string | null; publication_suppressed: number; takedown_at: string | null; pending_hash: string | null
  last_checked_at: string | null; last_success_at: string | null; last_error: string | null
}

export interface VersionRow {
  id: string; document_id: string; observed_at: string; effective_at: string | null; announced_at: string | null
  earliest_possible_change_at: string | null; lifecycle: string; source_url: string; provenance: string
  acquisition_tier: string; fetch_mode: string; raw_object_key: string; normalized_text: string; content_hash: string
  normalization_profile_id: string; parser_version: string; extraction_method: string; metadata: string; created_at: string
}

export interface ChangeRow {
  id: string; document_id: string; from_version_id: string; to_version_id: string; importance: number
  categories: string; sections: string; table_rows: string; detection_window_start: string | null
  detection_window_end: string; suppressed_reason: string | null; created_at: string
}

export const now = () => new Date().toISOString()
export const uid = () => crypto.randomUUID()

/** 설정(코드)의 정적 속성을 DB 에 맞춘다. 런타임 상태 컬럼은 건드리지 않는다. */
export async function syncDocuments(env: Env, docs: DocumentConfig[] = DOCUMENTS) {
  const sql = (n: number) => `
    INSERT INTO documents (id, service, service_name, type, title, canonical_url, status, acquisition_tier, blocker_type, official_history_url, history_harvester, public_note)
    VALUES ${Array.from({ length: n }, (_, r) => `(${Array.from({ length: SYNC_COLS }, (_, c) => `?${r * SYNC_COLS + c + 1}`).join(', ')})`).join(', ')}
    ON CONFLICT(id) DO UPDATE SET service=excluded.service, service_name=excluded.service_name, type=excluded.type, title=excluded.title,
      canonical_url=excluded.canonical_url, status=excluded.status, acquisition_tier=excluded.acquisition_tier, blocker_type=excluded.blocker_type,
      official_history_url=excluded.official_history_url, history_harvester=excluded.history_harvester, public_note=excluded.public_note`
  const rows = docs.map((d) => {
    // 상태는 blocker 가 아니라 "지금 설정에서 실제로 수집하는가" 를 따른다.
    // robots 차단이어도 ADVISORY 면 ACTIVE 다 — blocker_type 은 그대로 남아 카탈로그에 사유가 보인다 (§2.7).
    const status = isCollectible(env, d) ? 'ACTIVE' : d.blocker === 'RENDER_REQUIRED' ? 'PENDING_RENDER' : 'BLOCKED'
    const tier = !isCollectible(env, d) ? 'NONE' : d.history ? 'T3' : 'T1'
    return [d.id, d.service, d.serviceName, d.type, d.title, d.canonicalUrl, status, tier, d.blocker,
      d.history?.indexUrl ?? null, d.history?.harvester ?? null, d.publicNote ?? null]
  })
  // 한 행씩 보내면 문서 수만큼 왕복한다 (79건이면 8초). 여러 행을 한 문장에 담아 왕복을 10분의 1로 줄인다.
  // 묶음 크기는 D1 의 "한 문장에 바인딩 100개" 상한에 맞춘다 — 8행 × 12열 = 96.
  const chunks: unknown[][][] = []
  for (let i = 0; i < rows.length; i += SYNC_CHUNK) chunks.push(rows.slice(i, i + SYNC_CHUNK))
  await dbOf(env).batch(chunks.map((c) => stmt(sql(c.length), ...c.flat())))
}
const SYNC_COLS = 12
const SYNC_CHUNK = 8

export const listDocuments = (env: Env) =>
  dbOf(env).all<DocumentRow>(`SELECT * FROM documents
    ORDER BY CASE status WHEN 'ACTIVE' THEN 0 WHEN 'PENDING_RENDER' THEN 1 ELSE 2 END, service_name, type`)

export const getDocument = (env: Env, id: string) =>
  dbOf(env).first<DocumentRow>('SELECT * FROM documents WHERE id = ?', [id])

export async function updateDocument(env: Env, id: string, patch: Partial<DocumentRow>) {
  const keys = Object.keys(patch)
  if (!keys.length) return
  await dbOf(env).run(`UPDATE documents SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`,
    [...keys.map((k) => (patch as any)[k]), id])
}

const VERSION_META = 'id, document_id, observed_at, effective_at, announced_at, earliest_possible_change_at, lifecycle, source_url, provenance, acquisition_tier, fetch_mode, raw_object_key, content_hash, normalization_profile_id, parser_version, extraction_method, metadata, created_at, length(normalized_text) AS text_length'

/** 시간순 (시행일 우선, 없으면 감지일). 본문은 싣지 않는다. */
export const listVersions = (env: Env, documentId: string) =>
  dbOf(env).all<Omit<VersionRow, 'normalized_text'> & { text_length: number }>(
    `SELECT ${VERSION_META} FROM versions WHERE document_id = ? ORDER BY COALESCE(effective_at, substr(observed_at,1,10)) DESC, observed_at DESC`, [documentId])

export const getVersion = (env: Env, id: string) =>
  dbOf(env).first<VersionRow>('SELECT * FROM versions WHERE id = ?', [id])

export const latestVersion = (env: Env, documentId: string) =>
  dbOf(env).first<VersionRow>(`SELECT * FROM versions WHERE document_id = ? ORDER BY COALESCE(effective_at, substr(observed_at,1,10)) DESC, observed_at DESC LIMIT 1`, [documentId])

/** 게이트가 직전 버전에서 쓰는 것. 본문 전체가 아니라 길이와 앞부분 표본만 받는다. */
export interface VersionGate { id: string; effective_at: string | null; normalization_profile_id: string; len: number; head: string }

/**
 * 게이트 판정용 직전 버전. `SELECT *` 로 본문을 통째로 끌어오면 문서 하나에 5만 자, 크론 한 번에 수십만 자가
 * 연결을 타고 넘어온다. 게이트에 필요한 것은 길이와 한글 비율뿐이다.
 * 한글 비율은 앞 4,000자 표본으로 잰다 — 게이트가 잡으려는 것은 본문이 통째로 사라진 응답이라 표본으로 충분하다.
 * 실제로 diff 를 만들 때는 그때 전체 행을 읽는다 (acquire.ts 의 poll).
 */
export const latestVersionGate = (env: Env, documentId: string) =>
  dbOf(env).first<VersionGate>(`SELECT id, effective_at, normalization_profile_id,
      length(normalized_text) AS len, substr(normalized_text, 1, 4000) AS head
    FROM versions WHERE document_id = ? ORDER BY COALESCE(effective_at, substr(observed_at,1,10)) DESC, observed_at DESC LIMIT 1`, [documentId])

export const findVersionByHash = (env: Env, documentId: string, profile: string, hash: string) =>
  dbOf(env).first<{ id: string }>('SELECT id FROM versions WHERE document_id = ? AND normalization_profile_id = ? AND content_hash = ?', [documentId, profile, hash])

export const storedSourceUrls = (env: Env, documentId: string) =>
  dbOf(env).all<{ source_url: string }>('SELECT DISTINCT source_url FROM versions WHERE document_id = ?', [documentId])
    .then((r) => new Set(r.map((x) => x.source_url)))

export async function insertVersion(env: Env, v: VersionRow) {
  await dbOf(env).run(`INSERT INTO versions (id, document_id, observed_at, effective_at, announced_at, earliest_possible_change_at, lifecycle, source_url, provenance,
      acquisition_tier, fetch_mode, raw_object_key, normalized_text, content_hash, normalization_profile_id, parser_version, extraction_method, metadata, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [v.id, v.document_id, v.observed_at, v.effective_at, v.announced_at, v.earliest_possible_change_at, v.lifecycle, v.source_url, v.provenance,
      v.acquisition_tier, v.fetch_mode, v.raw_object_key, v.normalized_text, v.content_hash, v.normalization_profile_id, v.parser_version, v.extraction_method, v.metadata, v.created_at])
}

/** (from, to) 쌍은 유니크다. 이미 있으면 조용히 건너뛴다 — 멱등. */
export async function insertChange(env: Env, c: ChangeRow) {
  await dbOf(env).run(`INSERT INTO changes (id, document_id, from_version_id, to_version_id, importance, categories, sections, table_rows,
      detection_window_start, detection_window_end, suppressed_reason, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT DO NOTHING`,
    [c.id, c.document_id, c.from_version_id, c.to_version_id, c.importance, c.categories, c.sections, c.table_rows,
      c.detection_window_start, c.detection_window_end, c.suppressed_reason, c.created_at])
}

export const getChange = (env: Env, id: string) => dbOf(env).first<ChangeRow>('SELECT * FROM changes WHERE id = ?', [id])

export const changeBetween = (env: Env, fromId: string, toId: string) =>
  dbOf(env).first<{ id: string }>('SELECT id FROM changes WHERE from_version_id = ? AND to_version_id = ?', [fromId, toId])

export interface ChangeListRow extends ChangeRow { title: string; service_name: string; effective_at: string | null; observed_at: string; publication_suppressed: number }

const CHANGE_COLS = 'c.*, d.title, d.service_name, d.publication_suppressed, v.effective_at, v.observed_at'
const CHANGE_FROM = 'FROM changes c JOIN documents d ON d.id = c.document_id JOIN versions v ON v.id = c.to_version_id'
const CHANGE_LIST = `SELECT ${CHANGE_COLS} ${CHANGE_FROM}`

export const listChangesForDocument = (env: Env, documentId: string) =>
  dbOf(env).all<ChangeListRow>(`${CHANGE_LIST} WHERE c.document_id = ? ORDER BY COALESCE(v.effective_at, substr(v.observed_at,1,10)) DESC, v.observed_at DESC`, [documentId])

/** 공개 억제되지 않은 문서의 최근 변경. 백필 변경도 보이지만 실시간 감지가 앞선다. */
export const recentChanges = (env: Env, limit = 20) =>
  dbOf(env).all<ChangeListRow>(`${CHANGE_LIST} WHERE d.publication_suppressed = 0
    ORDER BY (c.suppressed_reason IS NULL) DESC, COALESCE(v.effective_at, substr(v.observed_at,1,10)) DESC LIMIT ?`, [limit])

export const versionCounts = (env: Env) =>
  dbOf(env).all<{ document_id: string; n: number; oldest: string }>(
    'SELECT document_id, COUNT(*) AS n, MIN(COALESCE(effective_at, substr(observed_at,1,10))) AS oldest FROM versions GROUP BY document_id')
    .then((r) => new Map(r.map((x) => [x.document_id, x])))

/** 문서마다 가장 최근 변경 하나. 홈 카드와 검색 결과에 "최근 변경" 을 적는 데 쓴다. */
export const latestChanges = (env: Env) =>
  dbOf(env).all<ChangeListRow & { rn: number }>(`SELECT * FROM (SELECT ${CHANGE_COLS},
      ROW_NUMBER() OVER (PARTITION BY c.document_id ORDER BY COALESCE(v.effective_at, substr(v.observed_at,1,10)) DESC, v.observed_at DESC) AS rn
    ${CHANGE_FROM} WHERE d.publication_suppressed = 0) AS t WHERE rn = 1`)
    .then((r) => new Map(r.map(({ rn: _rn, ...c }) => [c.document_id, c as ChangeListRow])))

export const countChanges = (env: Env) =>
  dbOf(env).first<{ n: number }>('SELECT COUNT(*) AS n FROM changes c JOIN documents d ON d.id = c.document_id WHERE d.publication_suppressed = 0')
    .then((r) => r?.n ?? 0)

// ── 조회 집계. 홈의 "이번 주 조회 상위 기업" 에만 쓴다. 개인을 식별하는 정보는 저장하지 않는다. ──
export const today = () => now().slice(0, 10)

/** 문서 하나의 오늘 조회수를 1 올린다. 집계가 실패해도 페이지는 떠야 하므로 예외를 삼킨다. */
export async function recordView(env: Env, documentId: string) {
  try {
    await dbOf(env).run(`INSERT INTO document_views (document_id, day, n) VALUES (?1, ?2, 1)
      ON CONFLICT(document_id, day) DO UPDATE SET n = document_views.n + 1`, [documentId, today()])
  } catch (e) { console.warn('recordView', String(e)) }
}

/** 최근 7일(오늘 포함) 문서별 조회수 합. */
export const weeklyViews = (env: Env, days = 7) => {
  const since = new Date(Date.now() - (days - 1) * 86_400_000).toISOString().slice(0, 10)
  return dbOf(env).all<{ document_id: string; n: number }>('SELECT document_id, SUM(n) AS n FROM document_views WHERE day >= ? GROUP BY document_id', [since])
    .then((r) => new Map(r.map((x) => [x.document_id, x.n])))
}

// ── 회원·세션 (migrations/0004_users.sql) ────────────────────────
export interface UserRow {
  id: string; email: string; name: string | null; picture: string | null; password_hash: string | null; google_sub: string | null
  created_at: string; last_login_at: string | null; feed_key?: string | null; notify?: number
}
export interface SessionRow { id: string; user_id: string; created_at: string; expires_at: string; user_agent: string | null }

export const findUserByEmail = (env: Env, email: string) => dbOf(env).first<UserRow>('SELECT * FROM users WHERE email = ?', [email])
export const findUserByGoogleSub = (env: Env, sub: string) => dbOf(env).first<UserRow>('SELECT * FROM users WHERE google_sub = ?', [sub])
export const getUser = (env: Env, id: string) => dbOf(env).first<UserRow>('SELECT * FROM users WHERE id = ?', [id])

export const findUserByFeedKey = (env: Env, key: string) => dbOf(env).first<UserRow>('SELECT * FROM users WHERE feed_key = ?', [key])

export async function insertUser(env: Env, u: UserRow) {
  await dbOf(env).run('INSERT INTO users (id, email, name, picture, password_hash, google_sub, created_at, last_login_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    [u.id, u.email, u.name, u.picture, u.password_hash, u.google_sub, u.created_at, u.last_login_at])
}

export async function updateUser(env: Env, id: string, patch: Partial<UserRow>) {
  const keys = Object.keys(patch)
  if (!keys.length) return
  await dbOf(env).run(`UPDATE users SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`, [...keys.map((k) => (patch as any)[k]), id])
}

export async function insertSession(env: Env, s: SessionRow) {
  await dbOf(env).run('INSERT INTO sessions (id, user_id, created_at, expires_at, user_agent) VALUES (?, ?, ?, ?, ?)', [s.id, s.user_id, s.created_at, s.expires_at, s.user_agent])
}

/** 살아 있는 세션의 회원. 만료됐으면 없는 것과 같다. */
export const sessionUser = (env: Env, sessionId: string, at: string) =>
  dbOf(env).first<UserRow>('SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.id = ? AND s.expires_at > ?', [sessionId, at])

export const deleteSession = (env: Env, sessionId: string) => dbOf(env).run('DELETE FROM sessions WHERE id = ?', [sessionId])
export const deleteExpiredSessions = (env: Env) => dbOf(env).run('DELETE FROM sessions WHERE expires_at <= ?', [now()])
export const countUsers = (env: Env) => dbOf(env).first<{ n: number }>('SELECT COUNT(*) AS n FROM users').then((r) => r?.n ?? 0)

/** 이 문서를 관심에 두고 알림을 켠 회원의 이메일 (migrations/0006_notify.sql). */
export const notifyRecipients = (env: Env, docId: string) =>
  dbOf(env).all<{ email: string }>('SELECT u.email FROM watches w JOIN users u ON u.id = w.user_id WHERE w.document_id = ? AND u.notify = 1', [docId]).then((r) => r.map((x) => x.email))

export const deleteUserSessions = (env: Env, userId: string) => dbOf(env).run('DELETE FROM sessions WHERE user_id = ?', [userId])

/** 탈퇴. 관심·세션·회원을 한 트랜잭션으로 지운다. 조회 집계에는 회원이 없으니 남는 것이 없다. */
export const deleteUser = (env: Env, userId: string) => dbOf(env).batch([
  stmt('DELETE FROM watches WHERE user_id = ?', userId),
  stmt('DELETE FROM sessions WHERE user_id = ?', userId),
  stmt('DELETE FROM users WHERE id = ?', userId),
])

// ── 관심 약관 (migrations/0005_watches.sql) ─────────────────────
export const listWatched = (env: Env, userId: string) =>
  dbOf(env).all<{ document_id: string }>('SELECT document_id FROM watches WHERE user_id = ? ORDER BY created_at DESC', [userId])
    .then((r) => new Set(r.map((x) => x.document_id)))

export const addWatch = (env: Env, userId: string, documentId: string) =>
  dbOf(env).run('INSERT INTO watches (user_id, document_id, created_at) VALUES (?, ?, ?) ON CONFLICT DO NOTHING', [userId, documentId, now()])

export const removeWatch = (env: Env, userId: string, documentId: string) =>
  dbOf(env).run('DELETE FROM watches WHERE user_id = ? AND document_id = ?', [userId, documentId])

/** 관심 문서들의 최근 변경. 개인 RSS 와 내 페이지가 쓴다. */
export const watchedChanges = (env: Env, userId: string, limit = 30) =>
  dbOf(env).all<ChangeListRow>(`${CHANGE_LIST} JOIN watches w ON w.document_id = c.document_id AND w.user_id = ?
    WHERE d.publication_suppressed = 0 ORDER BY COALESCE(v.effective_at, substr(v.observed_at,1,10)) DESC, v.observed_at DESC LIMIT ?`, [userId, limit])

/** 변경 기록 목록에 주제·중요도 거르기. categories 는 JSON 배열 문자열이라 따옴표째로 찾는다. */
export const listChanges = (env: Env, f: { cat?: string; minImportance?: number; limit?: number } = {}) => {
  const where = ['d.publication_suppressed = 0']
  const params: unknown[] = []
  if (f.cat) { where.push('c.categories LIKE ?'); params.push(`%"${f.cat}"%`) }
  if (f.minImportance) { where.push('c.importance >= ?'); params.push(f.minImportance) }
  params.push(f.limit ?? 100)
  return dbOf(env).all<ChangeListRow>(`${CHANGE_LIST} WHERE ${where.join(' AND ')}
    ORDER BY (c.suppressed_reason IS NULL) DESC, COALESCE(v.effective_at, substr(v.observed_at,1,10)) DESC LIMIT ?`, params)
}

// ── 로그인 시도 제한 ──────────────────────────────────────────
export interface AttemptRow { key: string; window_start: string; n: number }
export const getAttempt = (env: Env, key: string) => dbOf(env).first<AttemptRow>('SELECT * FROM login_attempts WHERE key = ?', [key])
export const putAttempt = (env: Env, a: AttemptRow) =>
  dbOf(env).run('INSERT INTO login_attempts (key, window_start, n) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET window_start = excluded.window_start, n = excluded.n', [a.key, a.window_start, a.n])
export const clearAttempts = (env: Env, keys: string[]) => keys.length ? dbOf(env).batch(keys.map((k) => stmt('DELETE FROM login_attempts WHERE key = ?', k))) : Promise.resolve()
export const purgeAttempts = (env: Env, before: string) => dbOf(env).run('DELETE FROM login_attempts WHERE window_start < ?', [before])
