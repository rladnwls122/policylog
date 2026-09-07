# POLICYLOG

국내 서비스의 이용약관·개인정보 처리방침 변경 이력을 보존하고 diff 를 보여주는 아카이브. Cloudflare Workers 한 개로 돈다.

설계서는 `POLICYLOG_IMPLEMENTATION_PLAN_v3.md` 이고, 이 저장소는 그중 **M1(아카이브가 동작한다)** 범위를 구현한다. 문서 안의 §번호는 그 설계서의 절 번호다.

## 스택

Cloudflare 로 유통하므로 전부 Cloudflare 원시 기능으로 맞췄다. 설계서 §11 의 NestJS·Redis·BullMQ·S3·Playwright 스택은 M1 에 필요 없다(§77).

| 설계서 §11 | 여기 | 이유 |
|---|---|---|
| NestJS + Next.js | Workers + Hono + JSX 서버 렌더링 | 앱 하나. 클라이언트 JS 0 바이트 |
| PostgreSQL | D1 (SQLite) | 문서 77건·버전 수백 건 규모. 쿼리 그대로 |
| Redis + BullMQ | Cron Trigger | 큐가 필요할 만큼 작업이 많지 않다 |
| S3 | R2 (비공개 버킷) | 원본 스냅샷 보관 |
| Cheerio | HTMLRewriter | 런타임 내장. 스트리밍 파서라 의존성 0 |
| Playwright | 없음 | 지금 수집하는 8건은 모두 정적이다. 렌더링은 §85 대상 |
| OpenSearch | 없음 | — |

의존성은 `hono` 와 `diff` 둘뿐이다.

## 지금 상태 (2026-09-07 실측)

로컬 워커를 실제 사이트에 붙여 수집한 결과다. 목업 없음. 문서 77건 중 수집 중 8, 렌더링 대기 22, 수집 불가 47이고 보존 버전은 100개다.

| 문서 | 버전 | 가장 오래된 | 이력 하베스터 |
|---|---|---|---|
| 당근 개인정보 처리방침 | 31 | 2020-10-21 | DIRECTORY_INDEX |
| 리디 개인정보 처리방침 | 31 | 2020-07-22 | LINK_LIST |
| 토스 서비스 이용약관 | 18 | 2015-06-07 | LINK_LIST |
| 리디 이용약관 | 16 | 2019-09-18 | LINK_LIST |
| 사람인 이용약관 | 1 | 2026-01-22 | 없음 |
| 사람인 개인정보 처리방침 | 1 | 2026-08-18 | 없음 |
| 쏘카 개인정보 처리방침 | 1 | 2026-07-24 | 없음 |
| NOL 개인정보 처리방침 | 1 | 2026-08-20 | 없음 |

변경 50건이 만들어졌다. 리디 개인정보 처리방침의 이력은 30건까지 받고 4건이 남았다 — 이력 수집은 문서당 하루 30건이 상한이라 다음 실행에서 이어받는다.

수집 불가 47건과 렌더링 대기 22건도 카탈로그에 남아 사유와 확인 날짜를 보여준다. 이게 §75가 말하는 관측 자료다.

### 카탈로그 넓히기

URL 을 추측하지 않는다. 82개 후보를 재봤더니 절반이 404 였다. 절차는 두 단계다.

```bash
# 1. 홈페이지에서 약관·처리방침 링크를 찾는다 (robots 를 먼저 본다)
node tools/discover.mjs https://example.com https://other.com

# 2. 찾은 URL 을 실제 파이프라인으로 재본다 — 셀렉터 후보를 돌려보고 가장 나은 것을 고른다
node tools/survey.mjs tools/candidates.json
```

프로브가 조문 수·표 수·시행일·이력 흔적을 돌려준다. 통과한 것만 `src/documents.ts` 에 손으로 넣는다. 차단된 것도 사유와 함께 넣는다.

측정에서 배운 것:

- **robots 차단이 가장 큰 벽이다.** 82개 후보 중 39개가 robots.txt 로 막혔다. 무신사·오늘의집·원티드·YES24·G마켓·업비트·네이버페이·카카오페이 등이다.
- **JS 렌더링이 그다음이다.** 22개가 robots 는 허용인데 HTTP 200 응답에 본문이 없다. 배달의민족·티빙·웨이브·교보문고·CGV·하나은행 등.
- **약관은 다른 호스트에 있는 경우가 많다.** 리디는 현행이 `ridibooks.com`, 과거 버전이 `policy.ridi.com` 이다. 쏘카는 zendesk 고객센터에 있다. 여기어때는 `goodchoice.kr` 에서 `yeogi.com` 으로 넘어간다. 그래서 실제로 가져올 모든 호스트를 각각 robots 판정한다.
- **규제 업종이 더 닫혀 있다.** 은행·카드·항공은 대부분 차단이거나 빈 DOM 이다. 설계서 §51.5 가 예측한 그대로다.

## 규칙

수집 정책은 `/bot` 페이지에 한국어로 게시되고, 코드가 이를 강제한다.

- **회피 없음 (§2.6).** User-Agent 는 설정값 하나. 프록시·핑거프린트 조작·캡차 우회 코드가 저장소에 없다는 것을 `test/policy.test.ts` 가 매 빌드마다 확인한다.
- **차단은 표시한다 (§2.7).** 차단된 문서도 카탈로그에 남고 사유와 확인 날짜를 함께 보여준다. 설정에 추출 규칙 자체가 없어서 가져올 방법이 없다.
- **전문은 공개하지 않는다 (D-1, §67.2).** 공개 표면은 변경분과 조문당 800자 이내 발췌, 그리고 원문 링크뿐이다. 한 응답이 문서의 20% 를 넘지 않는다. 원본 스냅샷은 관리자 인증 뒤에만 열린다.
- **버전은 INSERT 전용 (§44).** 정정은 새 행으로 남는다. 테이크다운은 `publication_suppressed` 플래그로 감추고 지우지 않는다.
- **AI 는 없다.** 분류는 규칙표(`src/diff.ts`)다. 감지는 SHA-256 해시 비교다.

## 오검출 방어 (§49)

1. **빈 DOM 게이트** — HTTP 200 에 본문 없는 응답을 버전으로 저장하지 않는다. 한글 비율 급락, 길이 급감, 한국어 소프트 블록 문구도 같이 본다.
2. **해시 네임스페이스** — `normalizationProfileId` 가 다르면 비교 자체가 예외를 던진다. 파서를 고쳐도 카탈로그 전체가 "변경됨" 으로 뒤집히지 않는다.
3. **반플랩** — 폴링으로 발견한 새 해시는 두 번 연속 관측돼야 발행된다. 단, 시행일이 새로 붙은 개정은 즉시 발행한다.
4. **백필 억제** — 이력 백필로 만든 변경은 알림 대상에서 빠진다.

## 멱등성

크론과 관리 작업은 몇 번을 돌려도 같은 결과가 된다.

- 같은 내용이면 해시가 같고, `(document_id, profile, hash)` 유니크 제약이 중복 저장을 막는다.
- 백필은 이미 저장한 `source_url` 을 건너뛴다. 2회차 실행은 `attempted: 0`.
- 변경 생성은 `(from_version_id, to_version_id)` 유니크 제약 + `INSERT OR IGNORE`.
- 카탈로그 동기화는 `ON CONFLICT DO UPDATE`.
- R2 키는 버전 id 라 덮어쓰기가 없다.

`test/api.test.ts` 의 "멱등성" 블록이 이를 실제 워커·실제 D1 에서 확인한다.

## 로컬 실행

```bash
npm install
npm run db:migrate:local
npm run dev                       # http://127.0.0.1:8788
```

`.dev.vars` 에 `ADMIN_PASSWORD` 를 넣으면 `/admin` 이 열린다.

```bash
# 실제 사이트에서 이력 백필 (당근 30건, 5초 간격이라 2분 반쯤 걸린다)
curl -u admin:devpassword -X POST http://127.0.0.1:8788/admin/backfill/daangn-privacy
curl -u admin:devpassword -X POST http://127.0.0.1:8788/admin/backfill/toss-terms

# 활성 문서 전체 폴링 (크론이 하루 한 번 하는 일과 같다)
curl -u admin:devpassword -X POST http://127.0.0.1:8788/admin/run
```

## 테스트

```bash
npm test          # 실제 워커 런타임(workerd)에서 65개
npx tsc --noEmit
```

픽스처는 실제 서비스에서 받은 한국어 정책 HTML 이다(`test/fixtures/`). 합성 픽스처는 쓰지 않는다 — 부칙 파싱, 표 구조, 인코딩 문제를 건드리지 못한다(§53).

## 배포

```bash
npx wrangler login
npx wrangler d1 create policylog          # 출력된 database_id 를 wrangler.jsonc 에 넣는다
npx wrangler r2 bucket create policylog-raw
npx wrangler secret put ADMIN_PASSWORD
npm run db:migrate                        # 원격 D1 마이그레이션
npm run deploy
```

배포 뒤 `wrangler.jsonc` 의 `SITE_URL`, `CONTACT_EMAIL`, `USER_AGENT` 를 실제 값으로 바꾼다. **첫 수집 전에 `/bot` 의 수집 정책을 게시하고, User-Agent 의 연락처가 실제로 열리는 메일함인지 확인한다 (§67.4).**

크론은 매일 UTC 18:17(한국시간 새벽 3시 17분)에 활성 문서를 폴링한다.

## 구조

```
src/
  documents.ts   문서 카탈로그. 설정은 서비스가 아니라 문서 단위 (§19)
  acquire.ts     robots 판정 · SSRF 가드 · fetch · 탐색 · 프로브 · 하베스터 · 백필 · 폴링
                 fetch 는 여기에만 있다
  extract.ts     HTMLRewriter 로 본문 텍스트와 표 추출
  normalize.ts   정규화 · 해시 · 빈 DOM 게이트 · 날짜 추출 · 조문 분할
  diff.ts        조문 diff · 표 행 diff · 규칙 분류
  db.ts          D1 접근. versions 의 UPDATE/DELETE 는 여기 없다
  public.ts      D-1 발췌 제한
  views.tsx      서버 렌더링 페이지
  index.tsx      라우트 · 공개 API · /admin · 크론
tools/
  discover.mjs   홈페이지에서 약관 링크 찾기
  survey.mjs     후보 URL 을 실제 파이프라인으로 재보기
```

## 다음

- 렌더링 수집(§85) — 배달의민족·티빙·교보문고 등 22건. Workers Browser Rendering 으로 붙인다.
- 이메일 알림(§78 M2) — 계정 없이 주소만으로 구독. 지금은 RSS 만 있다.
- 공개 요청(§83) — robots 로 막힌 39건에 대해 User-Agent 단위 허용 요청.
- 이력 공개 관측(§75) — "이 서비스는 과거 버전을 공개하는가" 를 표로 만든다.
