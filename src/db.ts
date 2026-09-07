// D1 접근. versions 는 INSERT 전용 — 이 파일에 versions 의 UPDATE/DELETE 는 없다 (§44).
import { DOCUMENTS, type DocumentConfig } from './documents'

/** 워커 바인딩. 실제 선언은 src/env.d.ts 의 Cloudflare.Env 다 — 테스트의 env 와 같은 타입을 쓴다. */
export type Env = Cloudflare.Env

export interface DocumentRow {
  id: string; service: string; service_name: string; type: string; title: string; canonical_url: string
  status: string; acquisition_tier: string; blocker_type: string; fetch_mode: string
  robots_verdict: string; robots_checked_at: string | null; official_history_url: string | null; history_harvester: string | null
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
  const stmt = env.DB.prepare(`
    INSERT INTO documents (id, service, service_name, type, title, canonical_url, status, acquisition_tier, blocker_type, official_history_url, history_harvester, public_note)
    VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)
    ON CONFLICT(id) DO UPDATE SET service=?2, service_name=?3, type=?4, title=?5, canonical_url=?6, status=?7, acquisition_tier=?8,
      blocker_type=?9, official_history_url=?10, history_harvester=?11, public_note=?12`)
  await env.DB.batch(docs.map((d) => {
    const status = d.blocker === 'NONE' ? 'ACTIVE' : d.blocker === 'RENDER_REQUIRED' ? 'PENDING_RENDER' : 'BLOCKED'
    const tier = d.blocker !== 'NONE' ? 'NONE' : d.history ? 'T3' : 'T1'
    return stmt.bind(d.id, d.service, d.serviceName, d.type, d.title, d.canonicalUrl, status, tier, d.blocker,
      d.history?.indexUrl ?? null, d.history?.harvester ?? null, d.publicNote ?? null)
  }))
}

export const listDocuments = (env: Env) =>
  env.DB.prepare(`SELECT * FROM documents
    ORDER BY CASE status WHEN 'ACTIVE' THEN 0 WHEN 'PENDING_RENDER' THEN 1 ELSE 2 END, service_name, type`)
    .all<DocumentRow>().then((r) => r.results)

export const getDocument = (env: Env, id: string) =>
  env.DB.prepare('SELECT * FROM documents WHERE id = ?').bind(id).first<DocumentRow>()

export async function updateDocument(env: Env, id: string, patch: Partial<DocumentRow>) {
  const keys = Object.keys(patch)
  if (!keys.length) return
  await env.DB.prepare(`UPDATE documents SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`)
    .bind(...keys.map((k) => (patch as any)[k]), id).run()
}

const VERSION_META = 'id, document_id, observed_at, effective_at, announced_at, earliest_possible_change_at, lifecycle, source_url, provenance, acquisition_tier, fetch_mode, raw_object_key, content_hash, normalization_profile_id, parser_version, extraction_method, metadata, created_at, length(normalized_text) AS text_length'

/** 시간순 (시행일 우선, 없으면 감지일). 본문은 싣지 않는다. */
export const listVersions = (env: Env, documentId: string) =>
  env.DB.prepare(`SELECT ${VERSION_META} FROM versions WHERE document_id = ? ORDER BY COALESCE(effective_at, substr(observed_at,1,10)) DESC, observed_at DESC`)
    .bind(documentId).all<Omit<VersionRow, 'normalized_text'> & { text_length: number }>().then((r) => r.results)

export const getVersion = (env: Env, id: string) =>
  env.DB.prepare('SELECT * FROM versions WHERE id = ?').bind(id).first<VersionRow>()

export const latestVersion = (env: Env, documentId: string) =>
  env.DB.prepare(`SELECT * FROM versions WHERE document_id = ? ORDER BY COALESCE(effective_at, substr(observed_at,1,10)) DESC, observed_at DESC LIMIT 1`)
    .bind(documentId).first<VersionRow>()

export const findVersionByHash = (env: Env, documentId: string, profile: string, hash: string) =>
  env.DB.prepare('SELECT id FROM versions WHERE document_id = ? AND normalization_profile_id = ? AND content_hash = ?')
    .bind(documentId, profile, hash).first<{ id: string }>()

export const storedSourceUrls = (env: Env, documentId: string) =>
  env.DB.prepare('SELECT DISTINCT source_url FROM versions WHERE document_id = ?').bind(documentId).all<{ source_url: string }>()
    .then((r) => new Set(r.results.map((x) => x.source_url)))

export async function insertVersion(env: Env, v: VersionRow) {
  await env.DB.prepare(`INSERT INTO versions (id, document_id, observed_at, effective_at, announced_at, earliest_possible_change_at, lifecycle, source_url, provenance,
      acquisition_tier, fetch_mode, raw_object_key, normalized_text, content_hash, normalization_profile_id, parser_version, extraction_method, metadata, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(v.id, v.document_id, v.observed_at, v.effective_at, v.announced_at, v.earliest_possible_change_at, v.lifecycle, v.source_url, v.provenance,
      v.acquisition_tier, v.fetch_mode, v.raw_object_key, v.normalized_text, v.content_hash, v.normalization_profile_id, v.parser_version, v.extraction_method, v.metadata, v.created_at)
    .run()
}

export async function insertChange(env: Env, c: ChangeRow) {
  await env.DB.prepare(`INSERT OR IGNORE INTO changes (id, document_id, from_version_id, to_version_id, importance, categories, sections, table_rows,
      detection_window_start, detection_window_end, suppressed_reason, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(c.id, c.document_id, c.from_version_id, c.to_version_id, c.importance, c.categories, c.sections, c.table_rows,
      c.detection_window_start, c.detection_window_end, c.suppressed_reason, c.created_at).run()
}

export const getChange = (env: Env, id: string) => env.DB.prepare('SELECT * FROM changes WHERE id = ?').bind(id).first<ChangeRow>()

export const changeBetween = (env: Env, fromId: string, toId: string) =>
  env.DB.prepare('SELECT id FROM changes WHERE from_version_id = ? AND to_version_id = ?').bind(fromId, toId).first<{ id: string }>()

export interface ChangeListRow extends ChangeRow { title: string; service_name: string; effective_at: string | null; observed_at: string; publication_suppressed: number }

const CHANGE_LIST = `SELECT c.*, d.title, d.service_name, d.publication_suppressed, v.effective_at, v.observed_at
  FROM changes c JOIN documents d ON d.id = c.document_id JOIN versions v ON v.id = c.to_version_id`

export const listChangesForDocument = (env: Env, documentId: string) =>
  env.DB.prepare(`${CHANGE_LIST} WHERE c.document_id = ? ORDER BY COALESCE(v.effective_at, substr(v.observed_at,1,10)) DESC, v.observed_at DESC`)
    .bind(documentId).all<ChangeListRow>().then((r) => r.results)

/** 홈 화면: 공개 억제되지 않은 문서의 최근 변경. 백필 변경도 타임라인엔 보이지만 홈에서는 실시간 감지가 우선 */
export const recentChanges = (env: Env, limit = 20) =>
  env.DB.prepare(`${CHANGE_LIST} WHERE d.publication_suppressed = 0 ORDER BY (c.suppressed_reason IS NULL) DESC, COALESCE(v.effective_at, substr(v.observed_at,1,10)) DESC LIMIT ?`)
    .bind(limit).all<ChangeListRow>().then((r) => r.results)

export const versionCounts = (env: Env) =>
  env.DB.prepare('SELECT document_id, COUNT(*) AS n, MIN(COALESCE(effective_at, substr(observed_at,1,10))) AS oldest FROM versions GROUP BY document_id')
    .all<{ document_id: string; n: number; oldest: string }>().then((r) => new Map(r.results.map((x) => [x.document_id, x])))
