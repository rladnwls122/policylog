-- 문서 카탈로그의 런타임 상태. 정적 속성은 src/documents.ts 가 원본이고 매 실행 때 upsert 된다.
CREATE TABLE documents (
  id TEXT PRIMARY KEY,
  service TEXT NOT NULL,
  service_name TEXT NOT NULL,
  type TEXT NOT NULL,                       -- TERMS | PRIVACY
  title TEXT NOT NULL,
  canonical_url TEXT NOT NULL,
  status TEXT NOT NULL,                     -- ACTIVE | BLOCKED | PENDING_RENDER
  acquisition_tier TEXT NOT NULL,           -- T1 | T3 | NONE
  blocker_type TEXT NOT NULL DEFAULT 'NONE',-- NONE | ROBOTS | WAF | RENDER_REQUIRED | DOCUMENT_ABSENT
  fetch_mode TEXT NOT NULL DEFAULT 'STATIC',
  robots_verdict TEXT NOT NULL DEFAULT 'UNKNOWN',
  robots_checked_at TEXT,
  official_history_url TEXT,
  history_harvester TEXT,
  public_note TEXT,
  publication_suppressed INTEGER NOT NULL DEFAULT 0,
  takedown_at TEXT,
  pending_hash TEXT,                        -- 반플랩: 두 번 연속 관측돼야 발행
  last_checked_at TEXT,
  last_success_at TEXT,
  last_error TEXT
);

-- INSERT 전용. 절대 UPDATE/DELETE 하지 않는다 (§44).
CREATE TABLE versions (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL REFERENCES documents(id),
  observed_at TEXT NOT NULL,
  effective_at TEXT,
  announced_at TEXT,
  earliest_possible_change_at TEXT,
  lifecycle TEXT NOT NULL DEFAULT 'CURRENT', -- SUPERSEDED | CURRENT | PENDING
  source_url TEXT NOT NULL,
  provenance TEXT NOT NULL,                  -- OFFICIAL_HISTORY | SELF_FETCH
  acquisition_tier TEXT NOT NULL,
  fetch_mode TEXT NOT NULL DEFAULT 'STATIC',
  raw_object_key TEXT NOT NULL,
  normalized_text TEXT NOT NULL,             -- 내부 증거. 공개 API 로 절대 전체를 내보내지 않는다 (D-1)
  content_hash TEXT NOT NULL,
  normalization_profile_id TEXT NOT NULL,
  parser_version TEXT NOT NULL,
  extraction_method TEXT NOT NULL,
  metadata TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  UNIQUE (document_id, normalization_profile_id, content_hash)
);
CREATE INDEX versions_doc ON versions(document_id, effective_at, observed_at);

CREATE TABLE changes (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL REFERENCES documents(id),
  from_version_id TEXT NOT NULL REFERENCES versions(id),
  to_version_id TEXT NOT NULL REFERENCES versions(id),
  importance INTEGER NOT NULL,
  categories TEXT NOT NULL,                  -- JSON array
  sections TEXT NOT NULL,                    -- JSON ChangeSection[]
  table_rows TEXT NOT NULL,                  -- JSON TableRowChange[]
  detection_window_start TEXT,
  detection_window_end TEXT NOT NULL,
  suppressed_reason TEXT,                    -- BACKFILL | PARSER_CUTOVER | NULL
  created_at TEXT NOT NULL,
  UNIQUE (from_version_id, to_version_id)
);
CREATE INDEX changes_doc ON changes(document_id, created_at);
