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

로컬 워커를 실제 사이트에 붙여 수집한 결과다. 목업 없음. 문서 79건 중 **수집 중 16, 렌더링 대기 33, 수집 불가 30** 이다.

수집 중 16건 가운데 7건은 robots.txt 가 비허용인 경로다 (§24.4). 카탈로그에 `robots 비허용 · 수집 중` 으로 표시된다.

| 문서 | 버전 | 가장 오래된 | 이력 하베스터 | robots |
|---|---|---|---|---|
| 당근 개인정보 처리방침 | 31 | 2020-10-21 | DIRECTORY_INDEX | 허용 |
| 리디 개인정보 처리방침 | 31 | 2020-07-22 | LINK_LIST | 허용 |
| 토스 서비스 이용약관 | 18 | 2015-06-07 | LINK_LIST | 허용 |
| 리디 이용약관 | 16 | 2019-09-18 | LINK_LIST | 허용 |
| 사람인 이용약관 · 처리방침 | 각 1 | 2026 | 없음 | 허용 |
| 쏘카 개인정보 처리방침 | 1 | 2026-07-24 | 없음 | 허용 |
| NOL 개인정보 처리방침 | 1 | 2026-08-20 | 없음 | 허용 |
| 멜론 이용약관 | 1 | 2024-04-11 | 없음 | 허용 |
| 카카오 이용약관 · 처리방침 | 각 1 | 2026 | 없음 | **비허용** |
| 원티드 이용약관 · 처리방침 | 각 1 | 2026 | 없음 | **비허용** |
| 메가박스 이용약관 | 1 | 2025-07-21 | 없음 | **비허용** |
| 벅스 이용약관 · 처리방침 | 각 1 | 2024~2026 | 없음 | **비허용** |

### robots 를 넘겨 보고 알게 된 것

이전 카탈로그는 "robots.txt 로 막힌 39건" 을 최대 수확처로 보고 있었다. `ROBOTS_MODE=ADVISORY` 로 39건을 전부 실제로 가져와 봤고, 결과는 예상과 달랐다.

| 실제로 막고 있던 것 | 건수 |
|---|---|
| robots 뿐 — 넘으니 본문이 나왔다 | **7** |
| robots 판정이 틀렸다 (약관이 다른 호스트에 있어 허용) | 1 |
| HTTP 200 인데 본문이 없다 (JS 렌더링) | 12 |
| 403 · 타임아웃 · TLS 끊김 (봇 차단) | 14 |
| 404 — 카탈로그의 URL 이 죽어 있었다 | 8 |

**39건 중 8건만 robots 문제였다.** 나머지 31건은 robots 를 넘어도 그대로 막힌다. 특히 404 8건은 robots 가 프로브를 먼저 막는 바람에 URL 이 한 번도 검증된 적이 없어서 생긴 것이다 — 차단이 관측을 막으면 카탈로그가 조용히 썩는다.

멜론이 그 반대 사례다. 약관은 `melon.com` 이 아니라 `info.melon.com` 에 있고 그 호스트의 robots.txt 는 허용인데, 홈페이지 URL 로 판정해 놓아 "robots 차단" 으로 잘못 분류돼 있었다. 지금은 정상 수집한다.

그래서 남은 판돈은 robots 가 아니라 **렌더링 33건** 이다. 그쪽에 Browser Rendering 을 붙였다 (§85).

### 카탈로그 넓히기

URL 을 추측하지 않는다. 절차는 두 단계다.

```bash
# 1. 홈페이지에서 약관·처리방침 링크를 찾는다
node tools/discover.mjs https://example.com https://other.com

# 2. 찾은 URL 을 실제 파이프라인으로 재본다 — 셀렉터 후보를 돌려보고 가장 나은 것을 고른다
node tools/survey.mjs tools/candidates.json

# 카탈로그에서 특정 사유로 막힌 문서를 한꺼번에 다시 잰다
node tools/survey.mjs --blocker=ROBOTS --out=tools/robots.json
node tools/survey.mjs --blocker=WAF
```

프로브가 조문 수·표 수·시행일·이력 흔적을 돌려주고, 통과한 것은 `src/documents.ts` 에 붙일 초안까지 찍어 준다. 통과한 것만 손으로 넣는다. 차단된 것도 사유와 함께 넣는다.

측정에서 배운 것:

- **robots 는 생각보다 작은 벽이었다.** 넘어보니 39건 중 8건. 대부분의 차단은 `Disallow: /policy` 같은 경로 전체 규칙이거나 `User-agent: *` 포괄 규칙이지, 약관 문서를 겨냥한 게 아니다.
- **JS 렌더링이 진짜 벽이다.** 33건. 정적 fetch 로는 방법이 없어 Browser Rendering 을 붙였다(§85). 배달의민족·티빙·웨이브·교보문고·CGV·하나은행·YES24·업비트 등.
- **봇 차단(403·타임아웃·TLS 끊김)이 그다음 19건.** 여기는 붙이지 않는다 — 아래 규칙 참조.
- **약관은 다른 호스트에 있는 경우가 많다.** 리디는 현행이 `ridibooks.com`, 과거 버전이 `policy.ridi.com` 이다. 쏘카는 zendesk 고객센터에 있다. 여기어때는 `goodchoice.kr` 에서 `yeogi.com` 으로 넘어간다. 그래서 실제로 가져올 모든 호스트를 각각 robots 판정한다.
- **규제 업종이 더 닫혀 있다.** 은행·카드·항공은 대부분 차단이거나 빈 DOM 이다. 설계서 §51.5 가 예측한 그대로다.

## 규칙

수집 정책은 `/bot` 페이지에 한국어로 게시되고, 코드가 이를 강제한다. `test/policy.test.ts` 가 매 빌드마다 확인한다.

- **회피 없음 (§2.6).** User-Agent 는 설정값 하나. 프록시·핑거프린트 조작·캡차 우회·스텔스 플러그인 코드가 저장소에 없다. 렌더링 수집도 마찬가지다 — 크롬을 띄우지만 UA 는 `env.USER_AGENT` 로 덮어쓰고 `navigator.webdriver` 를 숨기지 않는다. 그래서 403 으로 막힌 19건은 막힌 채로 둔다.
- **robots 는 판정하되, 게이트로 쓸지는 설정이다 (§24.4).** `ROBOTS_MODE` 가 `ENFORCE`(기본)면 비허용 문서를 수집하지 않고, `ADVISORY` 면 판정을 그대로 재고 기록하되 수집을 막지 않는다. 두 모드가 똑같이 지키는 것:
  - **`User-agent: POLICYLOG` 로 우리를 이름으로 지목한 거부는 모드와 무관하게 따른다.** 포괄 규칙만 넘어간다.
  - 문서당 하루 1회, 같은 도메인 10초 간격, 이력 5초 간격·하루 30건 상한.
  - `/bot` 문구가 모드를 따라 바뀐다. ADVISORY 면 "robots 비허용 문서도 수집 중" 이라고 그대로 적히고, 거부 요청 창구를 함께 보여준다.
- **차단은 표시한다 (§2.7).** 차단된 문서도 카탈로그에 남고 사유와 확인 날짜를 함께 보여준다. robots 비허용인데 수집 중인 문서는 `robots 비허용 · 수집 중` 배지로 구분해 보인다 — "수집 중" 으로 뭉뚱그리지 않는다.
- **전문은 공개하지 않는다 (D-1, §67.2).** 공개 표면은 변경분과 조문당 800자 이내 발췌, 그리고 원문 링크뿐이다. 한 응답이 문서의 20% 를 넘지 않는다. 원본 스냅샷은 관리자 인증 뒤에만 열린다.
- **버전은 INSERT 전용 (§44).** 정정은 새 행으로 남는다. 테이크다운은 `publication_suppressed` 플래그로 감추고 지우지 않는다.
- **AI 는 없다.** 분류는 규칙표(`src/diff.ts`)다. 감지는 SHA-256 해시 비교다.

### ROBOTS_MODE 되돌리기

`wrangler.jsonc` 의 `ROBOTS_MODE` 를 `"ENFORCE"` 로 바꾸면 끝이다. 다음 동기화부터 robots 비허용 7건이 자동으로 `수집 불가 · robots.txt` 로 돌아가고, 이미 보존한 버전은 그대로 남는다. 코드 변경은 필요 없다.

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

Browser Rendering(§85)은 유료 Workers 플랜에서만 붙는다. 무료 플랜이면 `wrangler.jsonc` 의 `browser` 바인딩을 지워도 된다 — 렌더링 필요 문서가 `수집 준비 중` 으로 남을 뿐 나머지는 그대로 돈다.

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

## 렌더링 수집 (§85)

정적 fetch 로 본문이 안 나오는 33건을 위해 Cloudflare Browser Rendering 을 붙였다. 헤드리스 크롬을 직접 다루지 않고 `@cloudflare/puppeteer` 를 그대로 쓴다 — 의존성이 셋으로 늘었다.

- `wrangler.jsonc` 의 `browser` 바인딩이 있으면 `blocker: 'RENDER_REQUIRED'` 이면서 셀렉터가 실측된 문서가 열린다. 바인딩이 없으면(무료 플랜·로컬 dev) 전부 `수집 준비 중` 인 채로 정적 수집만 돈다.
- 셀렉터를 재려면 `--render` 를 붙인다: `node tools/survey.mjs --blocker=RENDER_REQUIRED --render`
- 브라우저를 쓴다고 회피가 되는 게 아니다. UA 는 `env.USER_AGENT` 로 덮어쓰고 스텔스 플러그인은 붙이지 않는다.

**아직 실제 사이트로 검증하지 않았다.** Browser Rendering 은 유료 Workers 플랜이 필요하고 로컬은 `wrangler dev --remote` 라야 붙는다. 코드 경로와 타입은 맞췄지만, 33건에 대한 셀렉터 실측은 바인딩이 열린 뒤에 해야 한다.

## 다음

- 렌더링 셀렉터 실측 — 위 33건. 바인딩을 켜고 `--render` 서베이를 돌린다.
- 이메일 알림(§78 M2) — 계정 없이 주소만으로 구독. 지금은 RSS 만 있다.
- 공개 요청(§83) — 403 으로 막힌 19건에 대해 User-Agent 단위 허용 요청. robots 쪽은 §24.4 로 대체됐다.
- 404 8건의 실제 URL 찾기 — `tools/discover.mjs` 가 이제 robots 비허용 호스트에서도 링크를 돌려준다.
- 이력 공개 관측(§75) — "이 서비스는 과거 버전을 공개하는가" 를 표로 만든다.
- 이력 하베스터 확장 — 멜론(20건)·메가박스(13건)·카카오는 과거 버전 목록이 있지만 본문을 JS 로 불러온다. 지금의 `DIRECTORY_INDEX`/`LINK_LIST` 로는 못 잡는다.
