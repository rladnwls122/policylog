-- 관심 약관. 회원이 고른 문서. 홈 상단 "내 관심 약관" 과 개인 RSS 가 여기서 나온다.
CREATE TABLE watches (
  user_id TEXT NOT NULL REFERENCES users(id),
  document_id TEXT NOT NULL REFERENCES documents(id),
  created_at TEXT NOT NULL,
  PRIMARY KEY (user_id, document_id)
);

-- 개인 RSS 키. RSS 리더는 쿠키를 못 보내므로 주소에 든 키로 회원을 찾는다. 처음 쓸 때 만들고, 다시 만들면 옛 주소는 죽는다.
ALTER TABLE users ADD COLUMN feed_key TEXT;
CREATE UNIQUE INDEX users_feed_key ON users(feed_key);

-- 로그인 실패 횟수. 이메일과 IP 각각 15분 창에 10회를 넘기면 그 창이 끝날 때까지 막는다. 성공하면 지운다.
CREATE TABLE login_attempts (
  key TEXT PRIMARY KEY,                     -- email:<이메일> 또는 ip:<주소>
  window_start TEXT NOT NULL,
  n INTEGER NOT NULL DEFAULT 0
);
