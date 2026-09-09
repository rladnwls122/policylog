-- 이용자 제보와 조항 평가 (ToS;DR 방식). 둘 다 사람이 넣고 관리자가 승인한다.

-- 제보는 후보일 뿐이다. 이용자가 넣은 주소를 크롤러가 바로 가져가면 남이 우리 워커로 아무 데나
-- 요청을 보낼 수 있다. 관리자가 /admin/probe 로 재보고 셀렉터를 확인한 뒤에야 카탈로그로 간다.
CREATE TABLE submissions (
  id TEXT PRIMARY KEY,
  url TEXT NOT NULL,
  service_name TEXT NOT NULL,
  type TEXT NOT NULL,                        -- TERMS | PRIVACY
  note TEXT,                                 -- 제보자가 남긴 말
  user_id TEXT NOT NULL REFERENCES users(id),
  status TEXT NOT NULL DEFAULT 'PENDING',    -- PENDING | ACCEPTED | REJECTED
  review_note TEXT,
  reviewed_at TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX submissions_status ON submissions(status, created_at);
-- 같은 주소를 여러 사람이 제보하는 것은 막지 않는다. 한 사람이 같은 주소를 두 번 넣는 것만 막는다.
CREATE UNIQUE INDEX submissions_once ON submissions(user_id, url);

-- 조항 평가. 조문 하나에 한 줄이고, 유리(GOOD)·불리(BAD)·중립(NEUTRAL)과 무게(1~3)를 매긴다.
-- 회원이 제안하면 PROPOSED 로 쌓이고, 관리자가 APPROVED 로 바꾼 것만 등급 계산과 공개 화면에 들어간다.
CREATE TABLE ratings (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL REFERENCES documents(id),
  identifier TEXT NOT NULL,                  -- 조문 식별자 (제15조 · 1. …)
  category TEXT NOT NULL,                    -- src/diff.ts 의 분류 키
  verdict TEXT NOT NULL,                     -- GOOD | BAD | NEUTRAL
  weight INTEGER NOT NULL DEFAULT 1,         -- 1~3
  comment TEXT,
  user_id TEXT NOT NULL REFERENCES users(id),
  status TEXT NOT NULL DEFAULT 'PROPOSED',   -- PROPOSED | APPROVED | REJECTED
  reviewed_at TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX ratings_doc ON ratings(document_id, status);
-- 한 사람이 같은 조문을 두 번 매기지 않는다. 고치려면 그 줄을 지우고 다시 낸다.
CREATE UNIQUE INDEX ratings_once ON ratings(document_id, identifier, user_id);
