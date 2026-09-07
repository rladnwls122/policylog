-- robots.txt 가 `*` 가 아니라 우리 이름을 지목한 그룹으로 판정했는지 (§24.4).
-- 이름으로 지목한 거부는 ROBOTS_MODE 와 무관하게 따른다.
ALTER TABLE documents ADD COLUMN robots_named INTEGER NOT NULL DEFAULT 0;
