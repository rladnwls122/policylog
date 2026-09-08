-- 이메일 알림. 켠 회원에게만, 관심 약관에 변경이 생겼을 때 한 통씩 보낸다 (src/notify.ts).
ALTER TABLE users ADD COLUMN notify INTEGER NOT NULL DEFAULT 0;
