-- 문서별 일일 조회수. 홈의 "이번 주 조회 상위 기업" 카드를 고르는 데만 쓴다.
-- 개인을 식별하는 정보는 없다 — (문서, 날짜) 쌍당 정수 하나가 전부다.
CREATE TABLE document_views (
  document_id TEXT NOT NULL REFERENCES documents(id),
  day TEXT NOT NULL,                        -- YYYY-MM-DD (UTC)
  n INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (document_id, day)
);
