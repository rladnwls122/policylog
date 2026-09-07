// 서버 렌더링 페이지. 공개 표면은 D-1 을 지킨다: 본문 전체를 그리는 컴포넌트는 없다.
import type { FC, PropsWithChildren } from 'hono/jsx'
import { raw } from 'hono/html'
import { diffWords } from 'diff'
import type { DocumentRow, ChangeListRow, ChangeRow } from './db'
import type { ChangeSection, TableRowChange } from './diff'
import type { PublicSection } from './public'
import { excerpt, focusOnChange } from './public'

// OFF+BRAND. 스타일 참조를 이 아카이브에 맞게 옮긴 것 (tokens.json · DESIGN.md).
//
// 그대로 가져온 것: parchment/ink/paper/ash/stone 무채색 사다리, 그림자 없음,
//   카드 반경 0 · 인터랙션 반경 10px, 헤어라인만 쓰는 구분선, 76~119px 섹션 간격,
//   18/15 본문 쌍, 30px 카드 패딩 · 19px 요소 간격, 채운 버튼 없이 고스트 링크.
//
// 옮기면서 바꾼 것 — 이유가 있다:
//   1. Ataero Retina OB 는 라이선스를 살 수 없다. 참조 문서도 프로덕션은 원본을 사야 한다고 적었다.
//   2. line-height .80 은 한글을 자른다. 한글은 디센더 여백이 없어 1.05 아래로 못 내려간다.
//   3. 11px 대문자 + 0.05em 자간 라벨은 한글에 쓰지 않는다. 한글엔 대소문자가 없고 자간은 가독성을 깎는다.
//      숫자와 라틴(날짜·조문 번호·상태)에만 준다.
//   4. 무지개 구체는 OFF+BRAND 의 브랜드 표식이라 가져오지 않는다. 대신 그 원칙
//      — 무채색 화면에 색 사건은 딱 하나 — 을 지킨다. 여기서 그 하나는 redline 이다.
//      지움과 넣음은 흑백으로 옮기면 뜻이 사라지는 유일한 정보다. 그래서 인장까지 무채색으로 내렸다.
const CSS = `
:root{
  color-scheme:light dark;
  --parchment:#E5E4E0;--paper:#FFF;--stone:#CDCDC9;--ink:#1D1D1D;--ink-2:#6B6B67;--ash:#BFBEBE;
  --grid:rgba(29,29,29,.055);
  --del:#F2CFC9;--del-ink:#7E1B12;--ins:#CBE3D2;--ins-ink:#0F4A28;
  --display:IBM Plex Sans KR,system-ui,sans-serif;
  --body:Pretendard,Apple SD Gothic Neo,Malgun Gothic,system-ui,sans-serif;
  --mono:IBM Plex Mono,ui-monospace,SFMono-Regular,Menlo,monospace;
  --s5:5px;--s8:8px;--s15:15px;--s19:19px;--s30:30px;--s46:46px;--s76:76px;--s119:119px;
  --gut:clamp(19px,4vw,46px);--rail:1180px;
}
@media(prefers-color-scheme:dark){:root{
  --parchment:#171716;--paper:#201F1E;--stone:#2B2A28;--ink:#E7E6E1;--ink-2:#9A9893;--ash:#3A3936;
  --grid:rgba(231,230,225,.06);
  --del:#3B1A16;--del-ink:#EFA79E;--ins:#16301F;--ins-ink:#95D4A7;
}}
*{box-sizing:border-box}
body{margin:0;background:var(--parchment);color:var(--ink);
  font:400 18px/1.75 var(--body);letter-spacing:.23px;
  word-break:keep-all;overflow-wrap:anywhere;-webkit-text-size-adjust:100%}
main{max-width:1400px;margin:0 auto;padding:var(--s8) var(--gut) var(--s119)}
p{margin:0 0 var(--s15);max-width:34em}
ul,ol{max-width:34em;padding-left:1.1em}
li{margin:0 0 var(--s8)}li::marker{color:var(--ink-2)}
strong{font-weight:600}
.muted{color:var(--ink-2)}
.small{font-size:15px;line-height:1.6;letter-spacing:.15px}
.num{font-family:var(--mono);font-variant-numeric:tabular-nums;font-size:.86em;letter-spacing:.02em}

h1,h2,h3,.brand,.cite,.art-title{font-family:var(--display);font-weight:600;letter-spacing:-.015em}
h1{font-size:clamp(34px,5.6vw,76px);line-height:1.05;letter-spacing:-.035em;margin:0 0 var(--s19)}
h2{font-size:34px;line-height:1.15;margin:var(--s119) 0 var(--s8)}
h3{font-size:18px;line-height:1.4;margin:0}

a{color:inherit;text-decoration-color:var(--ash);text-underline-offset:4px;text-decoration-thickness:1px}
a:hover{text-decoration-color:var(--ink)}
a:focus-visible,summary:focus-visible,button:focus-visible{outline:2px solid var(--ink);outline-offset:3px;border-radius:10px}

.top{border-bottom:1px solid var(--ash);background:var(--parchment);position:sticky;top:0;z-index:5}
.top>div{max-width:1400px;margin:0 auto;padding:var(--s19) var(--gut);
  display:flex;gap:var(--s15) var(--s30);align-items:baseline;justify-content:space-between}
.brand{font-size:18px;letter-spacing:.05em;text-decoration:none;white-space:nowrap}
.top nav{display:flex;gap:var(--s19);flex-wrap:wrap;justify-content:flex-end}
.top nav a{font-family:var(--mono);font-size:11px;text-transform:uppercase;
  color:var(--ink-2);text-decoration:none;padding:var(--s5) 0;border-radius:10px}
.top nav a:hover{color:var(--ink);text-decoration:underline}

.hero{padding:var(--s76) 0 0}
.hero-split{display:grid;grid-template-columns:minmax(0,1.35fr) minmax(0,1fr);
  gap:var(--s19) var(--s46);align-items:end;margin-bottom:var(--s46)}
.hero .lead{max-width:12em;margin:0}
.hero .sub{max-width:30em;margin:0;color:var(--ink-2)}
@media(max-width:820px){.hero-split{grid-template-columns:1fr;align-items:start}}

.tally{display:grid;grid-template-columns:repeat(4,1fr);margin:var(--s46) 0 0;padding:0;
  list-style:none;border-top:1px solid var(--ash);max-width:740px}
.tally li{padding:var(--s19) var(--s19) var(--s19) 0;margin:0;border-right:1px solid var(--ash)}
.tally li:last-child{border-right:0}
.tally b{display:block;font-family:var(--mono);font-size:34px;font-weight:400;line-height:1;
  font-variant-numeric:tabular-nums;letter-spacing:-.01em;margin-bottom:var(--s8)}
.tally span{font-size:11px;line-height:1.4;color:var(--ink-2)}
@media(max-width:640px){.tally{grid-template-columns:1fr 1fr}
  .tally li:nth-child(2n){border-right:0}
  .tally li:nth-child(-n+2){border-bottom:1px solid var(--ash)}}

.doc{background:var(--paper);border:1px solid var(--ash);border-radius:0;max-width:var(--rail)}
a.doc{display:block;text-decoration:none;color:inherit}
a.doc:hover{border-color:var(--ink)}
.doc.ruled{background-image:linear-gradient(var(--grid) 1px,transparent 1px),
  linear-gradient(90deg,var(--grid) 1px,transparent 1px);background-size:var(--s19) var(--s19)}
.doc-head{display:flex;gap:var(--s15) var(--s19);align-items:baseline;flex-wrap:wrap;
  padding:var(--s15) var(--s30);border-bottom:1px solid var(--ash);background:var(--stone)}
.doc-head .who{font-family:var(--display);font-weight:600;font-size:15px;letter-spacing:-.01em}
.doc-head .when{margin-left:auto}

.art{display:grid;grid-template-columns:7em minmax(0,1fr);gap:0 var(--s30);
  padding:var(--s30);border-top:1px solid var(--ash)}
.art:first-of-type{border-top:0}
.cite{font-family:var(--mono);font-size:11px;color:var(--ink-2);
  text-align:right;padding-top:5px;line-height:1.4}
.cite b{display:block;font-family:var(--display);font-size:15px;font-weight:600;
  letter-spacing:-.01em;color:var(--ink)}
.art-body{min-width:0}
.art-title{font-size:18px;margin:0 0 var(--s15);display:flex;gap:var(--s15);
  align-items:baseline;flex-wrap:wrap}
@media(max-width:640px){
  .art{grid-template-columns:1fr;gap:var(--s5);padding:var(--s19)}
  .cite{text-align:left;padding:0}
}

.text{white-space:pre-wrap;font:inherit;margin:0;max-width:36em}
ins{background:var(--ins);color:var(--ins-ink);text-decoration:none;padding:1px 0;
  -webkit-box-decoration-break:clone;box-decoration-break:clone}
del{background:var(--del);color:var(--del-ink);text-decoration-thickness:1px;padding:1px 0;
  -webkit-box-decoration-break:clone;box-decoration-break:clone}
.hero ins,.hero del{background-color:transparent;background-repeat:no-repeat;background-size:0 100%;
  animation:sweep .45s cubic-bezier(.2,.7,.3,1) forwards}
.hero del{background-image:linear-gradient(var(--del),var(--del));animation-delay:.2s}
.hero ins{background-image:linear-gradient(var(--ins),var(--ins));animation-delay:.6s}
@keyframes sweep{to{background-size:100% 100%}}
@media(prefers-reduced-motion:reduce){.hero ins,.hero del{animation:none;background-size:100% 100%}}

.seal{display:inline-flex;flex-direction:column;align-items:center;gap:1px;
  border:1px solid var(--ink);border-radius:0;padding:var(--s5) 10px 6px;color:var(--ink);
  font-family:var(--mono);font-size:12px;font-variant-numeric:tabular-nums;
  letter-spacing:.02em;line-height:1.15;white-space:nowrap}
.seal em{font-style:normal;font-size:9px;letter-spacing:.06em;color:var(--ink-2)}
.seal.void{border-color:var(--ash);color:var(--ink-2)}

.tag{display:inline-block;font-family:var(--mono);font-size:11px;line-height:1.5;
  padding:2px 10px;border-radius:10px;border:1px solid var(--ash);color:var(--ink-2);white-space:nowrap}
.tag.ok{border-color:var(--ink);color:var(--ink)}
.tag.warn{border-style:dashed;border-color:var(--ink);color:var(--ink)}
.tag.stop{border-color:var(--ash);color:var(--ink-2);background:var(--stone)}
.imp{font-family:var(--mono);font-size:11px;color:var(--ink-2)}
.imp.hi{color:var(--ink);border-bottom:2px solid var(--ink)}
.imp.mid{color:var(--ink);border-bottom:1px solid var(--ash)}

.ledger{list-style:none;margin:0;padding:0;border-top:1px solid var(--ash);max-width:var(--rail)}
.ledger li{border-bottom:1px solid var(--ash);margin:0}
.ledger a.row{display:grid;grid-template-columns:9em minmax(0,1fr) auto;gap:var(--s5) var(--s30);
  align-items:baseline;padding:var(--s19) 0;text-decoration:none;color:inherit}
.ledger a.row:hover{background:var(--paper)}
.ledger a.row:hover .t{text-decoration:underline}
.ledger .t{font-family:var(--display);font-weight:600;font-size:18px;letter-spacing:-.015em}
.ledger .k{grid-column:2;font-size:11px;color:var(--ink-2)}
@media(max-width:640px){
  .ledger a.row{grid-template-columns:minmax(0,1fr) auto}
  .ledger .d{grid-column:1/-1;order:-1;margin-bottom:var(--s5)}
  .ledger .k{grid-column:1/-1}
}

.wrap{overflow-x:auto;max-width:var(--rail)}
table{border-collapse:collapse;width:100%;font-size:15px;letter-spacing:.15px}
caption{text-align:left;color:var(--ink-2);font-size:11px;
  font-family:var(--mono);padding:0 0 var(--s15)}
th{text-align:left;white-space:nowrap;font-family:var(--mono);font-weight:400;font-size:11px;
  text-transform:uppercase;color:var(--ink-2);
  padding:0 var(--s19) var(--s8) 0;border-bottom:1px solid var(--ink)}
td{text-align:left;padding:var(--s15) var(--s19) var(--s15) 0;border-bottom:1px solid var(--ash);
  vertical-align:top}
tbody tr:hover{background:var(--paper)}

code{font-family:var(--mono);font-size:.82em;background:var(--paper);
  border:1px solid var(--ash);border-radius:0;padding:1px 5px;word-break:break-all}
.note{border-left:1px solid var(--ink);padding:0 0 0 var(--s19);color:var(--ink-2);
  font-size:15px;max-width:36em}
.back{display:inline-block;font-family:var(--mono);font-size:11px;
  text-transform:uppercase;color:var(--ink-2);text-decoration:none;
  padding:var(--s30) 0 var(--s19);border-radius:10px}
.back:hover{color:var(--ink);text-decoration:underline}
.meta{display:flex;flex-wrap:wrap;gap:var(--s15) var(--s19);align-items:center;
  padding:0;margin:0 0 var(--s30);list-style:none;font-size:15px;max-width:none}
.meta li{color:var(--ink-2);margin:0}
hr{border:0;border-top:1px solid var(--ash);margin:var(--s76) 0}
.stack{margin-top:var(--s30)}
.mark{margin-left:var(--s8)}
.cell-note{display:block;margin-top:var(--s5);max-width:32em}
form{display:inline}
button{font-family:var(--mono);font-size:11px;text-transform:uppercase;
  background:none;color:var(--ink);border:1px solid var(--ink);border-radius:10px;
  padding:var(--s5) var(--s15);cursor:pointer}
button:hover{background:var(--ink);color:var(--parchment)}
`

export const Layout: FC<PropsWithChildren<{ title: string; siteUrl: string; feed?: string }>> = ({ title, feed, children }) => (
  <html lang="ko">
    <head>
      <meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" />
      <title>{title} · POLICYLOG</title>
      {feed && <link rel="alternate" type="application/rss+xml" href={feed} />}
      {/* 인장. 시행일 도장과 같은 표시다. */}
      <link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3E%3Crect x='1.5' y='1.5' width='13' height='13' rx='1.5' fill='none' stroke='%23C0342A' stroke-width='2'/%3E%3Cpath d='M4.5 8h7' stroke='%23C0342A' stroke-width='2'/%3E%3C/svg%3E" />
      {/* 표제와 기록 서체만 받는다. 한글 본문은 시스템 서체로 둔다 — 한글 웹폰트는 무겁다. */}
      <link rel="preconnect" href="https://fonts.googleapis.com" />
      <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin="" />
      <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans+KR:wght@600&family=IBM+Plex+Mono:wght@400;500&display=swap" />
      {/* raw 없이 넣으면 Hono 가 따옴표를 이스케이프해 font-family 선언이 통째로 깨진다. */}
      <style>{raw(CSS)}</style>
    </head>
    <body>
      <header class="top">
        <div>
          <a class="brand" href="/">POLICYLOG</a>
          <nav>
            <a href="/">기록</a>
            <a href="/bot">수집 정책</a>
            <a href="/api/v1/services">API</a>
          </nav>
        </div>
      </header>
      <main>{children}</main>
    </body>
  </html>
)

const BLOCKER_LABEL: Record<string, string> = { ROBOTS: 'robots.txt', WAF: '봇 차단', DOCUMENT_ABSENT: '문서 못 찾음' }
const CHANGE_LABEL: Record<string, string> = { ADDED: '신설', REMOVED: '삭제', MODIFIED: '수정' }

export const Badge: FC<{ d: Pick<DocumentRow, 'status' | 'blocker_type' | 'robots_verdict'> }> = ({ d }) =>
  // robots 비허용인데 수집 중이면 그렇게 적는다. "수집 중" 으로 뭉뚱그리지 않는다 (§2.7).
  d.status === 'ACTIVE' && d.robots_verdict === 'DISALLOWED' ? <span class="tag warn">robots 비허용, 수집 중</span>
  : d.status === 'ACTIVE' ? <span class="tag ok">매일 확인</span>
  : d.status === 'PENDING_RENDER' ? <span class="tag warn">수집 준비 중</span>
  : <span class="tag stop">못 가져옴 · {BLOCKER_LABEL[d.blocker_type] ?? d.blocker_type}</span>

export const Provenance: FC<{ p: string }> = ({ p }) => (
  <span class="tag">{p === 'OFFICIAL_HISTORY' ? '서비스가 공개한 이력' : p === 'SELF_FETCH' ? 'POLICYLOG가 수집' : p}</span>
)

export const Importance: FC<{ n: number }> = ({ n }) => (
  <span class={`imp ${n >= 35 ? 'hi' : n >= 20 ? 'mid' : 'lo'}`}>{n >= 35 ? '높음' : n >= 20 ? '보통' : '낮음'}</span>
)

/**
 * 시행일 도장 (§76). 날짜는 이 아카이브에서 법적으로 작동하는 유일한 사실이라
 * 라벨이 아니라 인장으로 찍는다. 시행일이 없으면 감지일을 찍되 테두리를 죽인다.
 */
export const Seal: FC<{ effectiveAt: string | null; observedAt?: string }> = ({ effectiveAt, observedAt }) =>
  effectiveAt
    ? <span class="seal"><em>시행</em>{effectiveAt.replaceAll('-', '.')}</span>
    : <span class="seal void"><em>감지</em>{(observedAt ?? '').slice(0, 10).replaceAll('-', '.')}</span>

const CAT: Record<string, string> = {
  AI_DATA_USAGE: 'AI·데이터 활용', DATA_SHARING: '제3자 제공', OVERSEAS_TRANSFER: '국외 이전', PROCESSOR_DELEGATION: '처리 위탁', PRICE: '요금',
  REFUND: '환불', PAYMENT: '결제', DATA_RETENTION: '보유 기간', SUSPENSION: '이용 제한·해지', LIABILITY: '책임', DISPUTE_RESOLUTION: '분쟁 해결',
  DATA_COLLECTION: '수집 항목', SECURITY: '보안', ACCOUNT: '계정', OTHER: '기타',
}
export const cat = (c: string) => CAT[c] ?? c

/** 분류가 열 개씩 붙으면 읽히지 않는다. 앞의 넷만 보이고 나머지는 수만 알린다. */
export const catList = (cs: string[], max = 4) =>
  cs.slice(0, max).map(cat).join(', ') + (cs.length > max ? ` 외 ${cs.length - max}` : '')

/** 감지 시각의 정직한 표기 (§76). 시행일이 있으면 그것이 우선. */
export function windowLabel(start: string | null, end: string, effectiveAt: string | null): string {
  const e = end.slice(0, 10)
  if (!start) return `${e} 감지`
  const s = start.slice(0, 10)
  const days = (Date.parse(e) - Date.parse(s)) / 86_400_000
  if (days <= 1.1) return `${e} 변경 감지`
  if (days <= 7) return `${s} ~ ${e} 사이 변경 감지`
  return `${s} ~ ${e} 사이 변경 감지 (폴링 간격 기준)`
}

/**
 * 히어로. 이 제품에서 가장 특징적인 것은 설명 문구가 아니라 redline 자체라서,
 * 아카이브에 실제로 들어 있는 최근 변경 중 가장 무거운 조문 하나를 그대로 보여준다.
 * 목업이 아니다. 발췌 상한은 공개 표면 규칙을 따른다 (D-1, §67.2).
 */
const HeroRedline: FC<{ c: ChangeListRow }> = ({ c }) => {
  const sections: ChangeSection[] = JSON.parse(c.sections)
  const s = [...sections].sort((a, b) => b.importance - a.importance)[0]
  if (!s) return null
  const cut = focusOnChange(s.beforeText ?? '', s.afterText ?? '', 90, 300)
  return (
    <a class="doc ruled" href={`/changes/${c.id}`}>
      <div class="doc-head">
        <span class="who">{c.title}</span>
        <span class="when"><Seal effectiveAt={c.effective_at} observedAt={c.detection_window_end} /></span>
      </div>
      <div class="art">
        <div class="cite"><b>{s.identifier || '본문'}</b></div>
        <div class="art-body">
          {/* 히어로 안의 조문 제목은 문서 구조상 표제가 아니라 카드 내용이라 h 태그를 쓰지 않는다. */}
          <p class="art-title">{s.title || c.service_name}<Importance n={s.importance} /></p>
          {s.changeType === 'MODIFIED'
            ? <WordDiff before={cut.before} after={cut.after} />
            : <p class="text">{s.changeType === 'ADDED' ? <ins>{excerpt(s.afterText, 300)}</ins> : <del>{excerpt(s.beforeText, 300)}</del>}</p>}
        </div>
      </div>
    </a>
  )
}

export const Home: FC<{ docs: DocumentRow[]; counts: Map<string, { n: number; oldest: string }>; changes: ChangeListRow[] }> = ({ docs, counts, changes }) => {
  const watched = docs.filter((d) => d.status === 'ACTIVE').length
  const soon = docs.filter((d) => d.status === 'PENDING_RENDER').length
  const shut = docs.filter((d) => d.status === 'BLOCKED').length
  const kept = [...counts.values()].reduce((n, c) => n + c.n, 0)
  const hero = changes.find((c) => !c.suppressed_reason) ?? changes[0]
  return (
    <>
      <section class="hero">
        <div class="hero-split">
          <h1 class="lead">약관은 바뀌고, 알림은 오지 않습니다.</h1>
          <p class="sub">
          POLICYLOG 는 한국 서비스의 이용약관과 개인정보 처리방침을 매일 확인해,
          무엇이 어떻게 바뀌었는지 조문 단위로 남깁니다. 아래는 가장 최근에 잡힌 변경입니다.
          </p>
        </div>
        {hero
          ? <HeroRedline c={hero} />
          : <p class="note">아직 감지된 변경이 없습니다. 문서를 계속 지켜보고 있습니다.</p>}
        <ul class="tally">
          <li><b>{watched}</b><span>매일 확인하는 문서</span></li>
          <li><b>{kept}</b><span>보존한 버전</span></li>
          <li><b>{changes.length}</b><span>기록된 변경</span></li>
          <li><b>{shut}</b><span>못 가져오는 문서</span></li>
        </ul>
      </section>

      <h2>변경 기록</h2>
      <p class="small muted">중요도는 바뀐 조문의 주제로 매깁니다. 국외 이전, 제3자 제공, AI 학습 이용이 가장 높습니다.</p>
      {changes.length === 0
        ? <p class="note">아직 감지된 변경이 없습니다.</p>
        : <ul class="ledger">
            {changes.map((c) => (
              <li>
                <a class="row" href={`/changes/${c.id}`}>
                  <span class="d"><Seal effectiveAt={c.effective_at} observedAt={c.detection_window_end} /></span>
                  <span class="t">{c.title}</span>
                  <span><Importance n={c.importance} /></span>
                  <span class="k">
                    {catList(JSON.parse(c.categories) as string[])}
                    {c.suppressed_reason === 'BACKFILL' && <span class="tag mark">과거 이력</span>}
                  </span>
                </a>
              </li>
            ))}
          </ul>}

      <h2>지켜보는 문서</h2>
      <p class="small muted">
        문서 {docs.length}건 가운데 {watched}건을 매일 확인합니다. {soon}건은 준비 중이고,
        {' '}{shut}건은 가져오지 못합니다. 못 가져오는 문서도 사유를 적어 그대로 둡니다.
      </p>
      <div class="wrap">
        <table>
          <caption>상태는 마지막으로 확인한 날짜 기준입니다.</caption>
          <thead><tr><th>서비스</th><th>문서</th><th>상태</th><th>보존 버전</th></tr></thead>
          <tbody>
            {docs.map((d) => {
              const c = counts.get(d.id)
              return (
                <tr>
                  <td>{d.service_name}</td>
                  <td>
                    {d.status === 'ACTIVE' ? <a href={`/policies/${d.id}`}>{d.title}</a> : d.title}
                    <div class="small"><a class="muted" href={d.canonical_url} rel="noopener nofollow">공식 문서</a></div>
                  </td>
                  <td>
                    <Badge d={d} />
                    {d.public_note && <div class="cell-note small muted">{d.public_note}</div>}
                  </td>
                  <td class="small num">{c ? `${c.n}개, ${c.oldest}부터` : d.status === 'ACTIVE' ? '수집 대기' : '—'}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </>
  )
}

export const DocumentPage: FC<{ d: DocumentRow; versions: { id: string; effective_at: string | null; observed_at: string; provenance: string; source_url: string; text_length: number }[]; changes: ChangeListRow[] }> = ({ d, versions, changes }) => {
  const byTo = new Map(changes.map((c) => [c.to_version_id, c]))
  return (
    <>
      <a class="back" href="/">기록 전체</a>
      <h1>{d.title}</h1>
      <ul class="meta">
        <li><Badge d={d} /></li>
        <li><a href={d.canonical_url} rel="noopener nofollow">공식 문서</a></li>
        <li><a href={`/policies/${d.id}/feed.xml`}>RSS 구독</a></li>
        {d.official_history_url && <li><a href={d.official_history_url} rel="noopener nofollow">서비스가 공개한 이력</a></li>}
      </ul>
      {d.public_note && <p class="note">{d.public_note}</p>}
      <h2>보존한 버전 {versions.length}개</h2>
      <p class="small muted">시행일을 누르면 그 시점의 조문 발췌를 볼 수 있습니다.</p>
      <div class="wrap"><table><thead><tr><th>시행일</th><th>감지</th><th>출처</th><th>변경</th></tr></thead><tbody>
        {versions.map((v, i) => {
          const c = byTo.get(v.id)
          return (
            <tr>
              <td><a class="num" href={`/policies/${d.id}/versions/${v.id}`}>{v.effective_at ?? <span class="muted">시행일 미표기</span>}</a>{i === 0 && <> <span class="tag ok">현행</span></>}</td>
              <td class="small num">{v.observed_at.slice(0, 10)}</td>
              <td><Provenance p={v.provenance} /></td>
              <td class="small">{c ? <a href={`/changes/${c.id}`}><Importance n={c.importance} /> {(JSON.parse(c.categories) as string[]).slice(0, 3).map(cat).join(', ')}</a> : i === versions.length - 1 ? <span class="muted">최초 보존본</span> : ''}</td>
            </tr>
          )
        })}
      </tbody></table></div>
    </>
  )
}

export const VersionPage: FC<{ d: DocumentRow; v: ReturnType<typeof import('./public').shapeVersion> }> = ({ d, v }) => (
  <>
    <a class="back" href={`/policies/${d.id}`}>{d.title}</a>
    <h1>{d.title}</h1>
    <ul class="meta">
      <li><Seal effectiveAt={v.effective_at} observedAt={v.observed_at} /></li>
      <li><Provenance p={v.provenance} /></li>
      <li class="small num">본문 {v.textLength.toLocaleString()}자</li>
      <li class="small num">해시 {v.content_hash.slice(0, 12)}</li>
      <li class="small"><a href={v.source_url} rel="noopener nofollow">이 버전의 원본</a></li>
    </ul>
    <p class="note">전문은 게시하지 않습니다. 조문별 발췌만 보여주며, 전문은 서비스 공식 페이지에서 확인하세요.</p>
    {v.sections.length === 0 && <p class="note">조문 구조를 인식하지 못한 문서입니다. 변경은 문단 단위로 비교됩니다.</p>}
    <div class="doc stack">
      {v.sections.map((s: PublicSection) => (
        <div class="art">
          <div class="cite"><b>{s.identifier || '본문'}</b></div>
          <div class="art-body">
            <h3 class="art-title">{s.title}</h3>
            {s.excerpt
              ? <p class="text">{s.excerpt}{s.truncated && ' …'}</p>
              : <p class="small muted">발췌 한도를 넘어 원문에서 확인해야 합니다.</p>}
          </div>
        </div>
      ))}
    </div>
  </>
)

const WordDiff: FC<{ before: string; after: string }> = ({ before, after }) => (
  <p class="text">{diffWords(before, after).map((p) => p.added ? <ins>{p.value}</ins> : p.removed ? <del>{p.value}</del> : p.value)}</p>
)

export const ChangePage: FC<{ d: DocumentRow; c: ChangeRow; from: { id: string; effective_at: string | null; observed_at: string; source_url: string }; to: { id: string; effective_at: string | null; observed_at: string; source_url: string; provenance: string } }> = ({ d, c, from, to }) => {
  const sections: ChangeSection[] = JSON.parse(c.sections)
  const rows: TableRowChange[] = JSON.parse(c.table_rows)
  const cats: string[] = JSON.parse(c.categories)
  const order = (x: { importance: number }) => -x.importance
  return (
    <>
      <a class="back" href={`/policies/${d.id}`}>{d.title}</a>
      <h1>{d.title} 변경</h1>
      <ul class="meta">
        <li><Seal effectiveAt={to.effective_at} observedAt={to.observed_at} /></li>
        <li><Importance n={c.importance} /></li>
        <li>{cats.map(cat).join(', ') || '분류 없음'}</li>
        <li><Provenance p={to.provenance} /></li>
        <li class="small">{to.provenance === 'OFFICIAL_HISTORY'
          ? '서비스가 날짜를 표기해 공개한 버전'
          : windowLabel(c.detection_window_start, c.detection_window_end, to.effective_at)}</li>
      </ul>
      <p class="small muted">
        이전 <a class="num" href={`/policies/${d.id}/versions/${from.id}`}>{from.effective_at ?? from.observed_at.slice(0, 10)}</a>
        {' '}버전과 이후 <a class="num" href={`/policies/${d.id}/versions/${to.id}`}>{to.effective_at ?? to.observed_at.slice(0, 10)}</a>
        {' '}버전을 비교했습니다. <a href={to.source_url} rel="noopener nofollow">원문</a> 에서 전문을 볼 수 있습니다.
        {c.suppressed_reason === 'BACKFILL' && ' 과거 이력을 채우며 만든 비교라 알림은 보내지 않았습니다.'}
      </p>
      <p class="note">자동 생성된 비교입니다. 법률 자문이 아니며, 해석은 각 서비스의 공식 문서를 따릅니다.</p>

      {rows.length > 0 && <>
        <h2>바뀐 표 {rows.length}건</h2>
        <div class="wrap"><table><thead><tr><th>표</th><th>행</th><th>유형</th><th>이전</th><th>이후</th></tr></thead><tbody>
          {rows.sort((a, b) => order(a) - order(b)).map((r) => (
            <tr><td class="small">{r.tableIdentifier}</td><td>{r.rowKey}</td><td><span class="tag">{CHANGE_LABEL[r.changeType] ?? r.changeType}</span></td>
              <td class="small"><del>{r.beforeCells?.slice(1).join(' / ')}</del></td><td class="small"><ins>{r.afterCells?.slice(1).join(' / ')}</ins></td></tr>
          ))}
        </tbody></table></div>
      </>}

      <h2>바뀐 조문 {sections.length}건</h2>
      {sections.length === 0 && rows.length === 0
        ? <p class="note">본문 텍스트 차이가 없습니다. 구조나 표기만 바뀌었습니다.</p>
        : <p class="small muted">무거운 조문부터 놓습니다. 지운 곳은 붉게, 넣은 곳은 푸르게 표시합니다.</p>}
      <div class="doc stack">
        {sections.sort((a, b) => order(a) - order(b)).map((s) => (
          <div class="art">
            <div class="cite"><b>{s.identifier || '본문'}</b></div>
            <div class="art-body">
              <h3 class="art-title">
                {s.title}
                <span class="tag">{CHANGE_LABEL[s.changeType] ?? s.changeType}</span>
                <Importance n={s.importance} />
              </h3>
              {s.changeType === 'MODIFIED'
                ? <WordDiff {...focusOnChange(s.beforeText ?? '', s.afterText ?? '')} />
                : <p class="text">{s.changeType === 'ADDED' ? <ins>{excerpt(s.afterText)}</ins> : <del>{excerpt(s.beforeText)}</del>}</p>}
            </div>
          </div>
        ))}
      </div>
    </>
  )
}

export const BotPage: FC<{ ua: string; contact: string; robotsMode: string }> = ({ ua, contact, robotsMode }) => (
  <>
    <h1>수집 정책</h1>
    <p>POLICYLOG 는 공개된 문서의 변경 사실을 기록합니다. 법률 자문이 아니며, 원문의 해석은 각 서비스의 공식 문서를 따릅니다.</p>
    <h2>어떻게 수집하나</h2>
    <ul>
      <li>User-Agent 는 항상 <code>{ua}</code> 하나입니다. 브라우저를 흉내내지 않습니다.</li>
      <li>문서당 하루 1회, 같은 도메인에 10초 이상 간격, 이력 페이지는 5초 간격·하루 30건 이하로 접근합니다. 공개된 약관·처리방침 페이지만 가져옵니다.</li>
      <li>IP 우회·프록시·핑거프린트 조작·캡차 해결·로그인 뒤 콘텐츠 접근은 하지 않습니다.</li>
      <li>원문 전체는 게시하지 않습니다. 변경된 부분과 조문당 800자 이내의 발췌만 보여주고, 항상 공식 페이지로 링크합니다.</li>
    </ul>
    <h2>robots.txt 를 어떻게 다루나</h2>
    {robotsMode === 'ADVISORY' ? (
      <>
        <p>
          robots.txt 는 매주 다시 확인하고 판정을 카탈로그에 그대로 공개하지만, <strong>지금은 수집 여부를 가르는 기준으로 쓰지 않습니다.</strong>{' '}
          약관·개인정보 처리방침은 사업자가 공개하도록 정해진 문서이고, 이 아카이브는 그중 변경분만 하루 1회 이하로 확인합니다.
          대부분의 차단은 이 문서들을 겨냥한 것이 아니라 경로 전체나 <code>User-agent: *</code> 에 걸린 포괄 규칙입니다.
        </p>
            <p>사실대로 적자면: robots.txt 가 비허용인 문서도 수집 중이며, 카탈로그에서 <strong>robots 비허용, 수집 중</strong> 으로 표시됩니다. 숨기지 않습니다.</p>
      </>
    ) : (
      <p>robots.txt 를 매주 다시 확인합니다. 차단으로 바뀌면 즉시 중단하고, 보존한 이력은 유지합니다. robots.txt 자체가 403 이거나 응답이 없으면 차단으로 봅니다.</p>
    )}
    <h2>수집 거부 요청</h2>
    <p>
      <a href={`mailto:${contact}`}>{contact}</a> 로 문서나 도메인을 알려주시면 24시간 내에 수집을 중단하고 게시를 내립니다. 사유를 묻지 않습니다.
      robots.txt 에 <code>User-agent: POLICYLOG</code> 그룹을 두시면 그 그룹은 모드와 무관하게 그대로 따릅니다.
    </p>
  </>
)

export const AdminPage: FC<{ docs: DocumentRow[]; counts: Map<string, { n: number; oldest: string }> }> = ({ docs, counts }) => (
  <>
    <h1>수집 상태</h1>
    <p class="small muted">차단 문서의 미수집은 정상이다. 경고가 아니다 (§84.1).</p>
    <div class="wrap"><table><thead><tr><th>문서</th><th>티어</th><th>차단 유형</th><th>robots</th><th>버전</th><th>마지막 확인</th><th>오류</th><th></th></tr></thead><tbody>
      {docs.map((d) => (
        <tr>
          <td>{d.title}</td><td>{d.acquisition_tier}</td><td>{d.blocker_type}</td>
          <td class="small">{d.robots_verdict} {d.robots_checked_at?.slice(0, 10)}</td>
          <td>{counts.get(d.id)?.n ?? 0}</td><td class="small">{d.last_checked_at?.slice(0, 16)}</td>
          <td class="small">{d.status !== 'ACTIVE' ? <span class="muted">expected</span> : d.last_error}</td>
          <td>{d.status === 'ACTIVE' && <>
            <form method="post" action={`/admin/poll/${d.id}`}><button>폴링</button></form>{' '}
            {d.history_harvester && <form method="post" action={`/admin/backfill/${d.id}`}><button>백필</button></form>}
          </>}</td>
        </tr>
      ))}
    </tbody></table></div>
  </>
)
