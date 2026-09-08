-- 회원. 이메일 가입(비밀번호 해시)과 Google 로그인(google_sub) 둘 다 여기 한 행이다. 같은 이메일이면 같은 사람으로 잇는다.
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,               -- 소문자로 정규화
  name TEXT,
  picture TEXT,
  password_hash TEXT,                       -- pbkdf2-sha256$iterations$salt$hash. Google 로만 가입했으면 NULL
  google_sub TEXT UNIQUE,                   -- Google 계정 고유 id. 이메일 가입만 했으면 NULL
  created_at TEXT NOT NULL,
  last_login_at TEXT
);

-- 로그인 세션. id 는 쿠키에 든 토큰의 SHA-256 이라 DB 가 새어도 쿠키를 만들 수 없다.
CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  user_agent TEXT
);
CREATE INDEX sessions_user ON sessions(user_id);
