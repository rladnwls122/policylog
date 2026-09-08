// 서버 렌더링 페이지. 공개 표면은 D-1 을 지킨다: 본문 전체를 그리는 컴포넌트는 없다.
import type { FC, PropsWithChildren } from 'hono/jsx'
import { raw } from 'hono/html'
import { diffWords } from 'diff'
import type { DocumentRow, ChangeListRow, ChangeRow, UserRow } from './db'
import type { ChangeSection, TableRowChange } from './diff'
import type { PublicSection } from './public'
import { excerpt, focusOnChange } from './public'
import { type Signals, orderForGrid, searchKey, PREVIEW_CARDS } from './rank'
import { MIN_PASSWORD } from './auth'

// 디자인 체계 — 뉴모피즘(soft UI).
//
// 표면과 바탕이 같은 색이고, 깊이는 테두리가 아니라 두 방향의 그림자로만 낸다.
//   raise: 밝은 빛이 왼쪽 위에서 온다고 보고, 오른쪽 아래에 어두운 그림자·왼쪽 위에 밝은 그림자.
//   sink : 그 반대를 안쪽에 넣는다. 입력창·눌린 상태·인장·통계 타일에 쓴다.
// 그림자 거리는 4~14px, 흐림은 10~34px. 이보다 세면 2020년의 뉴모피즘처럼 무거워진다.
//
// 색 사건은 둘뿐이다.
//   1. redline — 지움(붉은)·넣음(푸른). 흑백으로 옮기면 뜻이 사라지는 유일한 정보.
//   2. accent — 검색 포커스·주요 버튼·순위 표식·높은 중요도. 무채색 화면에서 "여기를 누르라" 는 뜻만 진다.
// 상태 점(수집 중·준비 중·못 가져옴)은 작은 점 하나로만 색을 쓴다.
//
// 한글 규칙은 그대로다: line-height 1.05 아래로 내리지 않고, 대문자·자간 라벨은 라틴과 숫자에만 준다.
// 표제 서체만 웹폰트로 받고 본문은 시스템 서체다 — 한글 웹폰트는 무겁다.
//
// 움직임: 화면 이동은 문서 간 View Transition(지원 브라우저) 이고, 아니면 main 이 떠오른다.
// 카드는 들어올 때 순서대로 떠오르고, 올리면 살짝 뜨고, 누르면 가라앉는다. prefers-reduced-motion 이면 전부 끈다.
// 다크 토큰은 한 벌이다. 시스템이 어두운데 밝게 고정하지 않았을 때와, 어둡게 고정했을 때 두 선택자가 같은 문자열을 받는다.
const DARK = `
  color-scheme:dark;
  --bg:#20242A;--well:#1B1F24;--ink:#E9ECF1;--ink-2:#9AA3B2;--ink-3:#6B7482;--line:rgba(233,236,241,.08);
  --hi:rgba(255,255,255,.055);--lo:rgba(0,0,0,.55);
  --accent:#8193FF;--accent-ink:#0F1220;--accent-soft:rgba(129,147,255,.18);
  --ok:#5CC48C;--warn:#E5B35A;--stop:#6B7482;
  --del:#42201B;--del-ink:#F3AAA1;--ins:#183523;--ins-ink:#9BD8AD;
`
export const THEME_COLOR = { light: '#E8ECF2', dark: '#20242A' }

const CSS = `
:root{
  color-scheme:light;
  --bg:#E8ECF2;--well:#E0E5EC;--ink:#1E2430;--ink-2:#67707F;--ink-3:#9AA3B1;--line:rgba(30,36,48,.08);
  --hi:rgba(255,255,255,.92);--lo:rgba(134,148,170,.42);
  --accent:#4C63E8;--accent-ink:#FFFFFF;--accent-soft:rgba(76,99,232,.14);
  --ok:#2E9E63;--warn:#D9962B;--stop:#9AA3B1;
  --del:#F7D7D2;--del-ink:#8A1F14;--ins:#D0E9D7;--ins-ink:#0F4A28;
  --display:'IBM Plex Sans KR',Pretendard,'Apple SD Gothic Neo',system-ui,sans-serif;
  --body:Pretendard,'Apple SD Gothic Neo','Malgun Gothic',system-ui,sans-serif;
  --mono:'IBM Plex Mono',ui-monospace,SFMono-Regular,Menlo,monospace;
  --r:22px;--r-sm:14px;--pill:999px;
  --raise:8px 8px 20px var(--lo),-8px -8px 20px var(--hi);
  --raise-sm:4px 4px 10px var(--lo),-4px -4px 10px var(--hi);
  --raise-lg:14px 14px 34px var(--lo),-12px -12px 30px var(--hi);
  --sink:inset 5px 5px 12px var(--lo),inset -5px -5px 12px var(--hi);
  --sink-sm:inset 2px 2px 6px var(--lo),inset -2px -2px 6px var(--hi);
  --ease:cubic-bezier(.2,.7,.2,1);
  --gut:clamp(16px,4vw,40px);--rail:1240px;
}
@media(prefers-color-scheme:dark){:root:not([data-theme=light]){${DARK}}}
:root[data-theme=dark]{${DARK}}
/* 테마를 바꾸는 순간만 색이 부드럽게 넘어간다. JS 가 450ms 동안 theming 을 붙인다. */
html.theming,html.theming *,html.theming *::before,html.theming *::after{
  transition:background-color .4s var(--ease),color .4s var(--ease),box-shadow .4s var(--ease),border-color .4s var(--ease)!important}
*{box-sizing:border-box}
[hidden]{display:none!important}
html{scroll-behavior:smooth}
body{margin:0;background:var(--bg);color:var(--ink);font:400 16px/1.7 var(--body);letter-spacing:.1px;
  word-break:keep-all;overflow-wrap:anywhere;-webkit-text-size-adjust:100%;min-height:100vh}
main{max-width:var(--rail);margin:0 auto;padding:8px var(--gut) 0}
section{scroll-margin-top:96px}
p{margin:0 0 14px;max-width:38em}
ul,ol{max-width:38em;padding-left:1.1em}
li{margin:0 0 8px}li::marker{color:var(--ink-3)}
strong{font-weight:600}
.muted{color:var(--ink-2)}
.small{font-size:14px;line-height:1.6}
.num{font-family:var(--mono);font-variant-numeric:tabular-nums;font-size:.9em;letter-spacing:.01em}
h1,h2,h3,.brand,.cite,.art-title,.who{font-family:var(--display);font-weight:600;letter-spacing:-.02em}
h1{font-size:clamp(30px,4.6vw,52px);line-height:1.12;letter-spacing:-.03em;margin:0 0 16px}
h2{font-size:24px;line-height:1.25;margin:56px 0 12px}
h3{font-size:17px;line-height:1.4;margin:0}
a{color:inherit;text-decoration-color:var(--ink-3);text-underline-offset:4px;text-decoration-thickness:1px;transition:color .2s,text-decoration-color .2s}
a:hover{text-decoration-color:var(--ink)}
a:focus-visible,button:focus-visible,input:focus-visible,summary:focus-visible{outline:2px solid var(--accent);outline-offset:3px;border-radius:10px}
.lnk{font-size:13px;font-weight:500;color:var(--ink-2);text-decoration:none;position:relative;z-index:1}
.lnk:hover{color:var(--accent)}
.eyebrow{font-family:var(--mono);font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:var(--accent);margin:0 0 10px;max-width:none}

/* 움직임 */
@keyframes rise{from{opacity:0;transform:translateY(14px)}to{opacity:1;transform:none}}
@keyframes fade{from{opacity:0}to{opacity:1}}
.in{animation:rise .6s var(--ease) both;animation-delay:calc(min(var(--i,0),14)*55ms)}
@view-transition{navigation:auto}
::view-transition-old(root){animation:vt-out .2s ease-in both}
::view-transition-new(root){animation:vt-in .36s var(--ease) both}
@keyframes vt-out{to{opacity:0;transform:translateY(-8px)}}
@keyframes vt-in{from{opacity:0;transform:translateY(12px)}}
@supports not (view-transition-name:none){main{animation:rise .5s var(--ease) both}}
@media(prefers-reduced-motion:reduce){
  *,*::before,*::after{animation-duration:.001ms!important;animation-delay:0s!important;transition-duration:.001ms!important}
  ::view-transition-old(root),::view-transition-new(root){animation:none}
  html{scroll-behavior:auto}
}

/* 상단 */
.top{position:sticky;top:0;z-index:20;padding:12px var(--gut) 8px;background:linear-gradient(var(--bg) 78%,transparent)}
.top>div{max-width:var(--rail);margin:0 auto;display:flex;align-items:center;gap:8px 16px;
  padding:8px 8px 8px 18px;border-radius:var(--pill);background:var(--bg);box-shadow:var(--raise-sm)}
.brand{display:inline-flex;align-items:center;gap:10px;font-size:15px;font-weight:700;letter-spacing:.08em;text-decoration:none;white-space:nowrap}
.brand i{width:22px;height:22px;border-radius:7px;box-shadow:var(--sink-sm);display:grid;place-items:center}
.brand i::before{content:"";width:10px;height:2px;background:var(--del-ink);border-radius:2px}
.brand.big{font-size:18px;letter-spacing:.1em}
.brand.big i{width:30px;height:30px;border-radius:9px}
.brand.big i::before{width:14px;height:3px}
.top nav{margin-left:auto;display:flex;gap:2px;flex-wrap:wrap;justify-content:flex-end}
.top nav a{font-size:13px;font-weight:500;color:var(--ink-2);text-decoration:none;padding:8px 14px;border-radius:var(--pill);
  transition:box-shadow .25s var(--ease),color .25s,transform .25s var(--ease)}
.top nav a:hover{color:var(--ink);box-shadow:var(--raise-sm);transform:translateY(-1px)}
.top nav a[aria-current=page]{color:var(--accent);box-shadow:var(--sink-sm);transform:none}
@media(max-width:640px){.top nav a{padding:7px 10px;font-size:12px}}

/* 히어로 · 검색 · 통계 */
.hero{padding:clamp(36px,6vw,72px) 0 0;text-align:center}
.hero.compact{padding-top:clamp(24px,4vw,44px)}
.hero h1{margin:6px auto 14px;max-width:18em}
.hero .sub{color:var(--ink-2);max-width:36em;margin:0 auto 28px;font-size:17px}
.hero .lead{max-width:14em}
.search{display:flex;align-items:center;gap:8px;max-width:720px;margin:0 auto;padding:6px 6px 6px 20px;
  border-radius:var(--pill);background:var(--bg);box-shadow:var(--sink);transition:box-shadow .3s var(--ease)}
.search:focus-within{box-shadow:var(--sink),0 0 0 4px var(--accent-soft)}
.search svg{flex:none;width:20px;height:20px;color:var(--ink-3)}
.search input{flex:1;min-width:0;border:0;background:none;font:inherit;font-size:17px;color:var(--ink);padding:12px 4px;outline:none}
.search input::placeholder{color:var(--ink-3)}
.search input::-webkit-search-cancel-button{-webkit-appearance:none;appearance:none}
.search button{flex:none}
.hint{margin:12px auto 0;font-size:13px;color:var(--ink-3)}
.stats{display:grid;grid-template-columns:repeat(4,1fr);gap:14px;max-width:860px;margin:32px auto 0;padding:0;list-style:none}
.stats li{margin:0;padding:18px 12px 14px;border-radius:var(--r-sm);box-shadow:var(--sink-sm)}
.stats b{display:block;font-family:var(--mono);font-size:28px;font-weight:500;line-height:1;margin-bottom:8px;font-variant-numeric:tabular-nums;letter-spacing:-.02em}
.stats span{font-size:12.5px;color:var(--ink-2)}
@media(max-width:600px){.stats{grid-template-columns:1fr 1fr}}

/* 버튼 · 칩 · 태그 */
.btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;font:600 14px/1 var(--body);color:var(--ink);background:var(--bg);
  border:0;border-radius:var(--pill);padding:15px 24px;box-shadow:var(--raise-sm);text-decoration:none;cursor:pointer;white-space:nowrap;
  transition:transform .25s var(--ease),box-shadow .25s var(--ease),background .25s}
.btn:hover{transform:translateY(-2px);box-shadow:var(--raise)}
.btn:active{transform:none;box-shadow:var(--sink-sm)}
.btn.primary{color:var(--accent-ink);background:var(--accent);box-shadow:var(--raise-sm),0 10px 22px -10px var(--accent)}
.btn.primary:hover{box-shadow:var(--raise),0 14px 28px -10px var(--accent)}
.btn.sm{padding:11px 18px;font-size:13px}
.btn.round{width:46px;height:46px;padding:0;border-radius:50%}
.btn.round svg{width:18px;height:18px}
.chips{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
.chip{font:500 13px/1 var(--body);color:var(--ink-2);background:var(--bg);border:0;border-radius:var(--pill);padding:10px 14px;
  box-shadow:var(--raise-sm);cursor:pointer;transition:box-shadow .25s var(--ease),color .25s,transform .25s var(--ease)}
.chip:hover{color:var(--ink);transform:translateY(-1px)}
.chip.on{color:var(--accent);box-shadow:var(--sink-sm);transform:none}
.count{font-size:13px;color:var(--ink-2);margin-left:6px}
.count b{font-family:var(--mono);font-weight:500;color:var(--ink)}
.js-only{display:none}
html.js .js-only{display:flex}
.tag{display:inline-flex;align-items:center;gap:6px;font-family:var(--mono);font-size:11px;line-height:1;
  padding:6px 10px;border-radius:var(--pill);box-shadow:var(--sink-sm);color:var(--ink-2);white-space:nowrap}
.tag.ok::before,.tag.warn::before,.tag.stop::before{content:"";width:6px;height:6px;border-radius:50%;background:var(--stop)}
.tag.ok{color:var(--ink)}.tag.ok::before{background:var(--ok)}
.tag.warn{color:var(--ink)}.tag.warn::before{background:var(--warn)}
.imp{display:inline-flex;align-items:center;font-family:var(--mono);font-size:11px;line-height:1;padding:6px 10px;border-radius:var(--pill);
  color:var(--ink-2);box-shadow:var(--sink-sm);white-space:nowrap}
.imp.hi{color:var(--accent-ink);background:var(--accent);box-shadow:none}
.imp.mid{color:var(--ink);box-shadow:var(--raise-sm)}
.seal{display:inline-flex;align-items:baseline;gap:6px;padding:6px 10px;border-radius:10px;box-shadow:var(--sink-sm);color:var(--ink);
  font-family:var(--mono);font-size:12.5px;font-variant-numeric:tabular-nums;letter-spacing:.01em;line-height:1.1;white-space:nowrap}
.seal em{font-style:normal;font-size:10px;letter-spacing:.08em;color:var(--ink-2)}
.seal.void{color:var(--ink-2)}

/* 섹션 머리 */
.sec{margin:64px 0 22px;display:flex;align-items:end;justify-content:space-between;gap:12px 24px;flex-wrap:wrap}
.sec h2{margin:0}
.sec p{margin:6px 0 0;color:var(--ink-2);font-size:14px}
.sec .side{display:flex;align-items:center;gap:10px;flex-wrap:wrap}

/* 카드 */
.card{position:relative;display:flex;flex-direction:column;gap:12px;padding:24px;border-radius:var(--r);background:var(--bg);box-shadow:var(--raise);
  transition:transform .3s var(--ease),box-shadow .3s var(--ease)}
.card:hover{transform:translateY(-4px);box-shadow:var(--raise-lg)}
.card:active{transform:translateY(-1px)}
.card.static:hover{transform:none;box-shadow:var(--raise)}
.card .who{font-size:20px;margin:0;line-height:1.3}
.card .what{color:var(--ink-2);font-size:14px;margin:0}
.card a.cover{color:inherit;text-decoration:none}
.card a.cover::after{content:"";position:absolute;inset:0;border-radius:inherit}
.card .card-top{display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap;min-height:24px}
.card .kind{font-family:var(--mono);font-size:11px;color:var(--ink-3);letter-spacing:.04em}
.card .foot{margin-top:auto;display:flex;flex-wrap:wrap;justify-content:space-between;gap:8px 14px;align-items:center;font-size:13px;color:var(--ink-2);padding-top:4px}
.card .chg-line{display:flex;align-items:center;gap:8px;flex-wrap:wrap;font-size:13px;color:var(--ink-2)}
.card .views{font-family:var(--mono);font-size:11px;color:var(--accent)}
.card .clamp{display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;font-size:13px;color:var(--ink-2);margin:0}
.featured{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:26px 24px;padding-top:12px}
@media(max-width:940px){.featured{grid-template-columns:1fr}}
.card.feat{padding:30px 26px 24px}
.rank{position:absolute;top:-14px;left:22px;width:32px;height:32px;border-radius:50%;display:grid;place-items:center;
  font:600 13px var(--mono);color:var(--accent-ink);background:var(--accent);box-shadow:0 8px 16px -6px var(--accent)}
.mini{padding:14px 16px;border-radius:var(--r-sm);box-shadow:var(--sink-sm);font-size:14px;line-height:1.65;display:grid;gap:6px}
.mini .cite{display:flex;align-items:center;gap:8px;flex-wrap:wrap;font-size:12px;color:var(--ink-2)}
.mini .cite b{font-family:var(--display);font-size:13px;color:var(--ink)}
.mini .text{display:-webkit-box;-webkit-line-clamp:4;-webkit-box-orient:vertical;overflow:hidden;white-space:pre-wrap;margin:0}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:20px}
.card.doc-card{padding:22px;gap:10px}
.card.doc-card .who{font-size:18px}
.card.blocked{box-shadow:var(--raise-sm)}
.card.blocked .who,.card.blocked .what{color:var(--ink-2)}

/* 인트로 · 스플래시 */
.splash{position:fixed;inset:0;z-index:50;overflow:auto;background:var(--bg);animation:fade .4s ease both;-webkit-overflow-scrolling:touch}
.splash.bye{opacity:0;transform:scale(1.03);pointer-events:none;transition:opacity .45s var(--ease),transform .45s var(--ease)}
body:has(.splash:not(.bye)){overflow:hidden}
.splash-inner{max-width:var(--rail);margin:0 auto;padding:clamp(28px,5vw,64px) var(--gut) 72px}
.splash .skip{position:absolute;top:18px;right:var(--gut);z-index:1}
.intro-hero{text-align:center;padding:clamp(16px,4vw,40px) 0 clamp(28px,4vw,48px)}
.intro-hero .brand{margin-bottom:26px}
.intro-hero h1{font-size:clamp(34px,5.4vw,64px);margin:8px auto 18px;max-width:14em}
.intro-hero .sub{color:var(--ink-2);font-size:17px;max-width:34em;margin:0 auto}
.cta{display:flex;gap:12px;justify-content:center;flex-wrap:wrap;margin-top:32px}
.intro-sec{margin-top:clamp(40px,6vw,72px)}
.intro-sec h2{margin:0 0 20px;text-align:center}
.trio{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:20px;padding:0;margin:0;list-style:none;max-width:none}
@media(max-width:820px){.trio{grid-template-columns:1fr}}
.trio li{margin:0}
.trio .card{gap:10px;padding:26px 24px}
.trio .card p{font-size:14px;color:var(--ink-2);margin:0}
.trio h3{font-size:18px}
.icon{width:46px;height:46px;border-radius:14px;box-shadow:var(--sink-sm);display:grid;place-items:center;color:var(--accent)}
.icon svg{width:22px;height:22px}
.n{width:36px;height:36px;border-radius:50%;box-shadow:var(--sink-sm);display:grid;place-items:center;font:600 14px var(--mono);color:var(--accent)}
.rules{list-style:none;padding:0;margin:0 auto;max-width:44em;display:grid;gap:12px}
.rules li{margin:0;padding:16px 20px;border-radius:var(--r-sm);box-shadow:var(--sink-sm);font-size:15px;color:var(--ink-2)}
.rules b{color:var(--ink);display:block;margin-bottom:2px}
.center{text-align:center;max-width:none}

/* 기록물 (조문 카드 · 표) */
.panel{border-radius:var(--r);background:var(--bg);box-shadow:var(--raise);padding:6px 26px;margin-top:18px}
.doc{border-radius:var(--r);background:var(--bg);box-shadow:var(--raise);overflow:hidden}
a.doc{display:block;text-decoration:none;color:inherit}
.doc-head{display:flex;gap:12px 18px;align-items:center;flex-wrap:wrap;padding:14px 26px;box-shadow:var(--sink-sm)}
.doc-head .who{font-size:15px}
.doc-head .when{margin-left:auto}
.art{display:grid;grid-template-columns:7em minmax(0,1fr);gap:0 26px;padding:26px;border-top:1px solid var(--line)}
.art:first-of-type{border-top:0}
.cite{font-family:var(--mono);font-size:11px;color:var(--ink-2);text-align:right;padding-top:5px;line-height:1.4}
.cite b{display:block;font-family:var(--display);font-size:15px;font-weight:600;letter-spacing:-.01em;color:var(--ink)}
.art-body{min-width:0}
.art-title{font-size:17px;margin:0 0 12px;display:flex;gap:10px;align-items:center;flex-wrap:wrap}
@media(max-width:640px){.art{grid-template-columns:1fr;gap:6px;padding:18px}.cite{text-align:left;padding:0}}
.text{white-space:pre-wrap;font:inherit;margin:0;max-width:40em}
ins{background:var(--ins);color:var(--ins-ink);text-decoration:none;padding:1px 2px;border-radius:3px;-webkit-box-decoration-break:clone;box-decoration-break:clone}
del{background:var(--del);color:var(--del-ink);text-decoration-thickness:1px;padding:1px 2px;border-radius:3px;-webkit-box-decoration-break:clone;box-decoration-break:clone}
.mini ins,.mini del{background-color:transparent;background-repeat:no-repeat;background-size:0 100%;animation:sweep .5s var(--ease) forwards}
.mini del{background-image:linear-gradient(var(--del),var(--del));animation-delay:.5s}
.mini ins{background-image:linear-gradient(var(--ins),var(--ins));animation-delay:.9s}
@keyframes sweep{to{background-size:100% 100%}}
.wrap{overflow-x:auto}
table{border-collapse:collapse;width:100%;font-size:14.5px}
caption{text-align:left;color:var(--ink-2);font-size:12px;font-family:var(--mono);padding:14px 0 10px}
th{text-align:left;white-space:nowrap;font-family:var(--mono);font-weight:400;font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:var(--ink-2);
  padding:12px 18px 10px 0;border-bottom:1px solid var(--ink)}
td{text-align:left;padding:14px 18px 14px 0;border-bottom:1px solid var(--line);vertical-align:top}
tbody tr:last-child td{border-bottom:0}
tbody tr{transition:background .2s}
tbody tr:hover{background:var(--well)}
code{font-family:var(--mono);font-size:.84em;background:var(--well);border-radius:6px;padding:2px 6px;word-break:break-all}
.note{border-radius:var(--r-sm);box-shadow:var(--sink-sm);padding:14px 18px;color:var(--ink-2);font-size:14.5px;max-width:40em}
.back{display:inline-flex;align-items:center;gap:6px;font-size:13px;font-weight:500;color:var(--ink-2);text-decoration:none;padding:26px 0 18px;border-radius:10px}
.back::before{content:"";width:7px;height:7px;border-left:1.5px solid currentColor;border-bottom:1.5px solid currentColor;transform:rotate(45deg);transition:transform .2s}
.back:hover{color:var(--ink)}.back:hover::before{transform:rotate(45deg) translate(-2px,2px)}
.meta{display:flex;flex-wrap:wrap;gap:10px 12px;align-items:center;padding:0;margin:0 0 24px;list-style:none;font-size:14.5px;max-width:none}
.meta li{color:var(--ink-2);margin:0}
hr{border:0;border-top:1px solid var(--line);margin:56px 0}
.stack{margin-top:24px}
.mark{margin-left:8px}
.cell-note{display:block;margin-top:4px;max-width:32em}
form{display:inline}
button.plain{font-family:var(--mono);font-size:11px;text-transform:uppercase;background:var(--bg);color:var(--ink);border:0;border-radius:var(--pill);
  padding:8px 14px;cursor:pointer;box-shadow:var(--raise-sm);transition:box-shadow .2s,transform .2s}
button.plain:hover{transform:translateY(-1px)}button.plain:active{box-shadow:var(--sink-sm);transform:none}

/* 변경 기록 목록 */
.ledger{list-style:none;margin:0;padding:6px 0 0;display:grid;gap:14px;max-width:none}
.ledger li{margin:0}
.ledger a.row{display:grid;grid-template-columns:auto minmax(0,1fr) auto;gap:6px 20px;align-items:center;padding:18px 22px;border-radius:var(--r-sm);
  background:var(--bg);box-shadow:var(--raise-sm);text-decoration:none;color:inherit;transition:transform .25s var(--ease),box-shadow .25s var(--ease)}
.ledger a.row:hover{transform:translateY(-2px);box-shadow:var(--raise)}
.ledger a.row:active{transform:none;box-shadow:var(--sink-sm)}
.ledger .t{font-family:var(--display);font-weight:600;font-size:17px;letter-spacing:-.015em}
.ledger .k{grid-column:2;font-size:12.5px;color:var(--ink-2)}
@media(max-width:640px){.ledger a.row{grid-template-columns:minmax(0,1fr) auto}.ledger .d{grid-column:1/-1;order:-1}.ledger .k{grid-column:1/-1}}

footer{max-width:var(--rail);margin:88px auto 0;padding:22px var(--gut) 44px;display:flex;flex-wrap:wrap;gap:8px 22px;align-items:center;
  font-size:13px;color:var(--ink-2);border-top:1px solid var(--line)}
footer a{text-decoration:none}footer a:hover{color:var(--ink)}
footer .brand{font-size:13px}

/* 회원 */
.me{display:flex;align-items:center;gap:6px;margin-left:6px}
.me img,.me .avatar{width:26px;height:26px;border-radius:50%;box-shadow:var(--sink-sm);object-fit:cover;flex:none}
.me .avatar{display:grid;place-items:center;font:600 12px var(--mono);font-style:normal;color:var(--accent)}
.me .name{font-size:13px;color:var(--ink-2);max-width:9em;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.me a,.me .navbtn{font:500 13px/1 var(--body);color:var(--ink-2);text-decoration:none;padding:9px 12px;border-radius:var(--pill);background:none;border:0;cursor:pointer;
  transition:box-shadow .25s var(--ease),color .25s,transform .25s var(--ease)}
.me a:hover,.me .navbtn:hover{color:var(--ink);box-shadow:var(--raise-sm);transform:translateY(-1px)}
.me a.join{color:var(--accent-ink);background:var(--accent);font-weight:600;box-shadow:var(--raise-sm),0 8px 18px -10px var(--accent)}
.me a.join:hover{color:var(--accent-ink)}
.me form{display:contents}
@media(max-width:640px){.me .name{display:none}}
.card.gate{grid-column:1/-1;box-shadow:var(--sink);align-items:flex-start;padding:28px 30px;gap:8px}
.card.gate:hover{transform:none;box-shadow:var(--sink)}
.card.gate .who{font-size:22px}
.card.gate .what{max-width:44em}
.cta.left{justify-content:flex-start;margin-top:10px}
.auth{max-width:520px;margin:clamp(24px,5vw,56px) auto 0;text-align:center}
.auth h1{font-size:clamp(28px,4vw,40px);margin:6px 0 12px}
.auth .sub{color:var(--ink-2);margin:0 auto 26px}
.auth-card{text-align:left;padding:28px 26px;gap:16px}
.btn.google{width:100%;background:var(--bg);color:var(--ink);gap:10px}
.btn.google svg{width:18px;height:18px;flex:none}
.or{display:flex;align-items:center;gap:12px;color:var(--ink-3);font-size:12px}
.or::before,.or::after{content:"";flex:1;border-top:1px solid var(--line)}
.auth-form{display:grid;gap:14px}
.auth-form label{display:grid;gap:6px;font-size:13px;font-weight:600;color:var(--ink-2)}
.auth-form input{width:100%;border:0;background:var(--bg);box-shadow:var(--sink-sm);border-radius:14px;padding:13px 16px;font:inherit;font-size:15px;color:var(--ink);outline:none;transition:box-shadow .25s var(--ease)}
.auth-form input:focus{box-shadow:var(--sink-sm),0 0 0 3px var(--accent-soft)}
.auth-form .help{font-weight:400;color:var(--ink-3);font-size:12px}
.auth-form .btn{margin-top:4px}
.err{border-radius:var(--r-sm);padding:12px 16px;color:var(--del-ink);background:var(--del);font-size:14px;margin:0}

/* 테마 토글. 밝을 때는 달(어둡게), 어두울 때는 해(밝게) 폼만 보인다 — JS 없이도 맞는 쪽이 눌린다. */
.theme{display:inline-flex;margin-left:4px}
.theme form{display:none;margin:0}
.theme form.to-dark{display:inline-flex}
@media(prefers-color-scheme:dark){
  :root:not([data-theme=light]) .theme form.to-dark{display:none}
  :root:not([data-theme=light]) .theme form.to-light{display:inline-flex}
}
:root[data-theme=dark] .theme form.to-dark{display:none}
:root[data-theme=dark] .theme form.to-light{display:inline-flex}
.iconbtn{width:36px;height:36px;border-radius:50%;border:0;background:var(--bg);box-shadow:var(--raise-sm);color:var(--ink-2);
  display:grid;place-items:center;cursor:pointer;padding:0;transition:box-shadow .25s var(--ease),color .25s,transform .25s var(--ease)}
.iconbtn svg{width:17px;height:17px}
.iconbtn:hover{color:var(--accent);transform:translateY(-1px);box-shadow:var(--raise)}
.iconbtn:active{transform:none;box-shadow:var(--sink-sm)}

/* 스플래시·소개 움직임 */
.intro-hero{position:relative}
.intro-hero>*{position:relative;z-index:1}
.orb{position:absolute;z-index:0;border-radius:50%;background:var(--bg);box-shadow:var(--raise);animation:float 9s ease-in-out infinite alternate}
.orb.a{width:170px;height:170px;left:4%;top:4%}
.orb.b{width:96px;height:96px;right:8%;top:16%;animation-duration:11s;animation-delay:-4s}
.orb.c{width:58px;height:58px;left:15%;bottom:6%;box-shadow:var(--sink);animation-duration:13s;animation-delay:-7s}
@keyframes float{from{transform:translate(0,0)}to{transform:translate(22px,-30px)}}
@media(max-width:820px){.orb{display:none}}
.intro-hero .brand.big{animation:rise .6s var(--ease) both}
.intro-hero .eyebrow{animation:rise .6s var(--ease) .1s both}
.intro-hero h1{animation:rise .7s var(--ease) .2s both}
.intro-hero .sub{animation:rise .7s var(--ease) .32s both}
.intro-hero .cta{animation:rise .7s var(--ease) .45s both}
.demo{max-width:560px;margin:36px auto 0;text-align:left;padding:20px 22px;gap:10px;animation:rise .8s var(--ease) .6s both}
.demo .cite{display:flex;gap:8px;align-items:center;flex-wrap:wrap;font-size:12px;color:var(--ink-2)}
.demo .cite b{font-family:var(--display);font-size:14px;color:var(--ink)}
.demo .seal{margin-left:auto;animation:stamp .5s var(--ease) 1.4s both}
.demo .text{font-size:15px;max-width:none}
.demo del,.demo ins{background-color:transparent;background-repeat:no-repeat;background-size:0 100%;animation:demo-sweep 8s var(--ease) infinite}
.demo del{background-image:linear-gradient(var(--del),var(--del));animation-delay:1.1s}
.demo ins{background-image:linear-gradient(var(--ins),var(--ins));animation-delay:1.7s}
@keyframes demo-sweep{0%{background-size:0 100%}12%,84%{background-size:100% 100%}94%,100%{background-size:0 100%}}
@keyframes stamp{from{opacity:0;transform:scale(1.6) rotate(-8deg)}to{opacity:1;transform:none}}
.demo-cap{margin:0;font-size:12.5px;color:var(--ink-3)}
.cue{display:block;width:12px;height:12px;margin:26px auto 0;border-right:2px solid var(--ink-3);border-bottom:2px solid var(--ink-3);animation:bob 1.8s ease-in-out infinite}
@keyframes bob{0%,100%{transform:translateY(0) rotate(45deg);opacity:.45}50%{transform:translateY(8px) rotate(45deg);opacity:1}}
.trio .n,.trio .icon{animation:pop .5s var(--ease) both;animation-delay:calc(var(--i,0)*120ms + .25s)}
@keyframes pop{from{transform:scale(.6);opacity:0}to{transform:none;opacity:1}}
@media(prefers-reduced-motion:reduce){
  .demo del,.demo ins{animation:none;background-size:100% 100%}
  .orb,.cue{animation:none}
}
`

// 점진적 향상. 없어도 모든 화면이 동작한다 — 검색은 /search 로 가고, 스플래시의 시작 버튼은 /start 로 간다.
// 있으면: 스플래시를 부드럽게 걷고 쿠키를 남기며, 홈 검색창이 카드를 즉시 거른다.
const JS = `
(function(){
var d=document;d.documentElement.classList.add('js');
var s=d.getElementById('splash');
if(s){
  var go=function(){d.cookie='pl_intro=1;max-age=31536000;path=/;samesite=lax';s.classList.add('bye');setTimeout(function(){s.remove()},480)};
  s.addEventListener('click',function(e){var a=e.target.closest('[data-start]');if(!a)return;e.preventDefault();go()});
  d.addEventListener('keydown',function(e){if(e.key==='Escape'&&s.isConnected)go()});
}
d.addEventListener('click',function(e){
  var b=e.target.closest('[data-theme-set]');if(!b)return;e.preventDefault();
  var t=b.getAttribute('data-theme-set'),h=d.documentElement;
  h.classList.add('theming');h.setAttribute('data-theme',t);
  d.cookie='pl_theme='+t+';max-age=31536000;path=/;samesite=lax';
  [].slice.call(d.querySelectorAll('meta[name=theme-color]')).forEach(function(m){m.remove()});
  var m=d.createElement('meta');m.name='theme-color';m.content=t==='dark'?'${THEME_COLOR.dark}':'${THEME_COLOR.light}';d.head.appendChild(m);
  setTimeout(function(){h.classList.remove('theming')},450);
});
var q=d.getElementById('q'),grid=d.getElementById('grid');
if(q&&grid){
  var cards=[].slice.call(d.querySelectorAll('[data-q]')),count=d.getElementById('count'),empty=d.getElementById('empty'),
      feat=d.getElementById('featured'),chips=[].slice.call(d.querySelectorAll('[data-f]')),f='all';
  var apply=function(){
    var terms=q.value.trim().toLowerCase().split(/\\s+/).filter(Boolean),n=0,fn=0;
    cards.forEach(function(c){
      var k=c.getAttribute('data-q')||'',ok=(f==='all'||c.getAttribute('data-s')===f)&&terms.every(function(t){return k.indexOf(t)>-1});
      c.hidden=!ok;if(ok){n++;if(feat&&feat.contains(c))fn++}
    });
    if(feat)feat.hidden=fn===0;
    if(count)count.textContent=n;
    if(empty)empty.hidden=n>0;
  };
  q.addEventListener('input',apply);
  if(q.form)q.form.addEventListener('submit',function(e){e.preventDefault();apply();(feat&&!feat.hidden?feat:grid).scrollIntoView({behavior:'smooth',block:'start'})});
  chips.forEach(function(b){b.addEventListener('click',function(){f=b.getAttribute('data-f');chips.forEach(function(x){var on=x===b;x.classList.toggle('on',on);x.setAttribute('aria-pressed',on?'true':'false')});apply()})});
  if(q.value)apply();
}
})();
`

const NAV: [string, string][] = [['/', '기록'], ['/changes', '변경 기록'], ['/intro', '소개'], ['/bot', '수집 정책'], ['/api/v1/services', 'API']]

/** 상단의 회원 자리. 비회원은 로그인·회원가입, 회원은 이름과 로그아웃. */
const Account: FC<{ user?: UserRow | null }> = ({ user }) => user
  ? <span class="me">
      {user.picture ? <img src={user.picture} alt="" referrerpolicy="no-referrer" /> : <i class="avatar">{(user.name ?? user.email).slice(0, 1).toUpperCase()}</i>}
      <span class="name">{user.name ?? user.email}</span>
      <form method="post" action="/logout"><button class="navbtn" type="submit">로그아웃</button></form>
    </span>
  : <span class="me"><a href="/login">로그인</a><a class="join" href="/join">회원가입</a></span>

export type Theme = 'light' | 'dark'

const ThemeToggle: FC<{ next: string }> = ({ next }) => (
  <span class="theme">
    <form method="post" action="/theme" class="to-dark">
      <input type="hidden" name="theme" value="dark" /><input type="hidden" name="next" value={next} />
      <button class="iconbtn" type="submit" aria-label="다크 모드로 바꾸기" title="다크 모드" data-theme-set="dark">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" /></svg>
      </button>
    </form>
    <form method="post" action="/theme" class="to-light">
      <input type="hidden" name="theme" value="light" /><input type="hidden" name="next" value={next} />
      <button class="iconbtn" type="submit" aria-label="라이트 모드로 바꾸기" title="라이트 모드" data-theme-set="light">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></svg>
      </button>
    </form>
  </span>
)

/** theme 이 없으면 시스템 설정을 따른다. here 는 테마를 바꾼 뒤 돌아올 곳. */
export const Layout: FC<PropsWithChildren<{ title: string; siteUrl: string; feed?: string; path?: string; description?: string; user?: UserRow | null; theme?: Theme; here?: string }>> = ({ title, feed, path, description, user, theme, here, children }) => (
  <html lang="ko" data-theme={theme}>
    <head>
      <meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" />
      <title>{title} · POLICYLOG</title>
      <meta name="description" content={description ?? '한국 서비스의 이용약관과 개인정보 처리방침을 매일 확인해 조문 단위로 변경을 기록하는 공개 아카이브'} />
      {theme
        ? <meta name="theme-color" content={THEME_COLOR[theme]} />
        : <><meta name="theme-color" media="(prefers-color-scheme: light)" content={THEME_COLOR.light} /><meta name="theme-color" media="(prefers-color-scheme: dark)" content={THEME_COLOR.dark} /></>}
      {feed && <link rel="alternate" type="application/rss+xml" href={feed} />}
      {/* 인장. 시행일 도장과 같은 표시다. */}
      <link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3E%3Crect x='1.5' y='1.5' width='13' height='13' rx='3' fill='none' stroke='%23C0342A' stroke-width='2'/%3E%3Cpath d='M4.5 8h7' stroke='%23C0342A' stroke-width='2'/%3E%3C/svg%3E" />
      {/* 표제와 기록 서체만 받는다. 한글 본문은 시스템 서체로 둔다 — 한글 웹폰트는 무겁다. */}
      <link rel="preconnect" href="https://fonts.googleapis.com" />
      <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin="" />
      <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans+KR:wght@500;600;700&family=IBM+Plex+Mono:wght@400;500&display=swap" />
      {/* raw 없이 넣으면 Hono 가 따옴표를 이스케이프해 font-family 선언이 통째로 깨진다. */}
      <style>{raw(CSS)}</style>
    </head>
    <body>
      <header class="top">
        <div>
          <a class="brand" href="/"><i></i>POLICYLOG</a>
          <nav aria-label="주요">
            {NAV.map(([href, label]) => <a href={href} aria-current={path === href ? 'page' : undefined}>{label}</a>)}
            <Account user={user} />
            <ThemeToggle next={here ?? path ?? '/'} />
          </nav>
        </div>
      </header>
      <main>{children}</main>
      <footer>
        <a class="brand" href="/"><i></i>POLICYLOG</a>
        <span>자동 생성된 비교입니다. 법률 자문이 아니며, 해석은 각 서비스의 공식 문서를 따릅니다.</span>
        <a href="/intro">소개</a><a href="/bot">수집 정책</a><a href="/api/v1/services">API</a>
      </footer>
      <script>{raw(JS)}</script>
    </body>
  </html>
)

const BLOCKER_LABEL: Record<string, string> = { ROBOTS: 'robots.txt', WAF: '봇 차단', DOCUMENT_ABSENT: '문서 못 찾음' }
const CHANGE_LABEL: Record<string, string> = { ADDED: '신설', REMOVED: '삭제', MODIFIED: '수정' }
const TYPE_LABEL: Record<string, string> = { TERMS: '이용약관', PRIVACY: '개인정보 처리방침' }

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
 * 라벨이 아니라 인장으로 찍는다. 시행일이 없으면 감지일을 찍되 톤을 죽인다.
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

const statusKey = (d: Pick<DocumentRow, 'status'>) => (d.status === 'ACTIVE' ? 'active' : d.status === 'PENDING_RENDER' ? 'pending' : 'blocked')
const cats = (c: ChangeListRow) => JSON.parse(c.categories) as string[]

const WordDiff: FC<{ before: string; after: string }> = ({ before, after }) => (
  <p class="text">{diffWords(before, after).map((p) => p.added ? <ins>{p.value}</ins> : p.removed ? <del>{p.value}</del> : p.value)}</p>
)

const SearchIcon: FC = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" />
  </svg>
)

/** 홈과 검색 화면이 같은 검색창을 쓴다. JS 없이도 GET /search 로 간다. */
const SearchBox: FC<{ q?: string; autofocus?: boolean }> = ({ q, autofocus }) => (
  <form class="search" role="search" method="get" action="/search">
    <SearchIcon />
    <input id="q" name="q" type="search" value={q} placeholder="서비스나 약관 이름으로 찾기 (예: 카카오, 개인정보)"
      aria-label="약관 검색" autocomplete="off" autofocus={autofocus} maxlength={80} />
    <button class="btn primary round" type="submit" aria-label="검색"><SearchIcon /></button>
  </form>
)

/**
 * 카드 안의 작은 redline. 이 제품에서 가장 특징적인 것은 설명 문구가 아니라 redline 자체라서,
 * 상위 카드에는 그 문서의 가장 최근 변경 중 가장 무거운 조문을 그대로 보여준다.
 * 목업이 아니다. 발췌 상한은 공개 표면 규칙을 따른다 (D-1, §67.2).
 */
const MiniRedline: FC<{ c: ChangeListRow }> = ({ c }) => {
  const sections: ChangeSection[] = JSON.parse(c.sections)
  const s = [...sections].sort((a, b) => b.importance - a.importance)[0]
  if (!s) return <p class="mini muted">표나 구조만 바뀐 변경입니다.</p>
  const cut = focusOnChange(s.beforeText ?? '', s.afterText ?? '', 60, 180)
  return (
    <div class="mini">
      <div class="cite"><b>{s.identifier || '본문'}</b><span>{s.title}</span><Importance n={s.importance} /></div>
      {s.changeType === 'MODIFIED'
        ? <WordDiff before={cut.before} after={cut.after} />
        : <p class="text">{s.changeType === 'ADDED' ? <ins>{excerpt(s.afterText, 180)}</ins> : <del>{excerpt(s.beforeText, 180)}</del>}</p>}
    </div>
  )
}

/** 상단 세 장. 기업 하나에 한 장, 최근 변경의 redline 을 함께 보인다. */
const FeaturedCard: FC<{ d: DocumentRow; s: Signals; rank: number }> = ({ d, s, rank }) => {
  const c = s.latest.get(d.id)
  const n = s.counts.get(d.id)
  const v = s.views.get(d.id) ?? 0
  return (
    <article class="card feat in" style={`--i:${rank}`} data-q={searchKey(d)} data-s={statusKey(d)}>
      <span class="rank" aria-label={`${rank}위`}>{rank}</span>
      <div class="card-top"><Badge d={d} />{v > 0 && <span class="views">이번 주 {v}회 조회</span>}</div>
      <h3 class="who"><a class="cover" href={`/policies/${d.id}`}>{d.service_name}</a></h3>
      <p class="what">{d.title}</p>
      {c
        ? <>
            <div class="chg-line"><Seal effectiveAt={c.effective_at} observedAt={c.observed_at} /><span>{catList(cats(c), 3) || '분류 없음'}</span></div>
            <MiniRedline c={c} />
          </>
        : <p class="mini muted">아직 기록된 변경이 없습니다. 첫 버전을 보존하고 지켜보는 중입니다.</p>}
      <div class="foot">
        <span class="num">{n ? `버전 ${n.n}개 · ${n.oldest.slice(0, 4)}년부터` : '첫 수집 대기'}</span>
        {c && <a class="lnk" href={`/changes/${c.id}`}>변경 보기</a>}
      </div>
    </article>
  )
}

/** 하단 그리드의 카드 한 장. 수집 중이면 기록으로, 아니면 공식 문서로 간다. */
const DocCard: FC<{ d: DocumentRow; s: Signals; i: number }> = ({ d, s, i }) => {
  const c = s.latest.get(d.id)
  const n = s.counts.get(d.id)
  const active = d.status === 'ACTIVE'
  return (
    <article class={`card doc-card in ${statusKey(d)}`} style={`--i:${i}`} data-q={searchKey(d)} data-s={statusKey(d)}>
      <div class="card-top"><span class="kind">{TYPE_LABEL[d.type] ?? d.type}</span><Badge d={d} /></div>
      <h3 class="who">{active
        ? <a class="cover" href={`/policies/${d.id}`}>{d.service_name}</a>
        : <a class="cover" href={d.canonical_url} rel="noopener nofollow">{d.service_name}</a>}</h3>
      <p class="what">{d.title}</p>
      {c
        ? <div class="chg-line"><Seal effectiveAt={c.effective_at} observedAt={c.observed_at} /><Importance n={c.importance} /><span>{catList(cats(c), 2)}</span></div>
        : active ? <p class="clamp">기록된 변경 없음 · 매일 지켜보는 중</p>
        : d.public_note ? <p class="clamp">{d.public_note}</p> : null}
      <div class="foot">
        <span class="num">{n ? `버전 ${n.n}개 · ${n.oldest.slice(0, 4)}년부터` : active ? '첫 수집 대기' : '보존 버전 없음'}</span>
        {active
          ? <a class="lnk" href={d.canonical_url} rel="noopener nofollow">공식 문서</a>
          : <a class="lnk" href={d.canonical_url} rel="noopener nofollow">공식 문서로</a>}
      </div>
    </article>
  )
}

const FEATURES: { title: string; body: string; icon: string }[] = [
  { title: '매일 확인', icon: 'M12 3a9 9 0 1 0 9 9M12 7v5l3 2M17 3h4v4', body: '카탈로그의 문서를 하루 한 번 가져와 해시로 비교합니다. 바뀐 날짜와 시행일을 함께 남깁니다.' },
  { title: '조문 단위 비교', icon: 'M4 7h10M4 12h7M4 17h10M18 5v4M16 7h4M16 17h4', body: '어느 조문의 어떤 문장이 지워지고 들어왔는지 붉은 줄과 푸른 줄로 보여줍니다. 국외 이전·제3자 제공·AI 학습처럼 무거운 주제는 중요도로 표시합니다.' },
  { title: '이력 보존', icon: 'M3 5h18v4H3zM5 9v10h14V9M10 13h4', body: '서비스가 공개한 과거 버전까지 거슬러 올라가 보존합니다. 문서마다 RSS 로 구독할 수 있습니다.' },
]
const STEPS: { title: string; body: string }[] = [
  { title: '검색한다', body: '메인 화면의 검색창에 서비스 이름이나 "개인정보" 같은 낱말을 넣으면 카드가 바로 걸러집니다.' },
  { title: '카드를 연다', body: '카드를 누르면 보존한 버전 목록과 변경 이력이 나옵니다. 시행일을 누르면 그 시점의 조문 발췌를 볼 수 있습니다.' },
  { title: '변경을 읽고 구독한다', body: '변경 화면은 무거운 조문부터 놓습니다. RSS 를 등록해 두면 다음 변경을 놓치지 않습니다.' },
]

/** 소개 본문. 스플래시(홈 위에 덮임)와 /intro(독립 페이지)가 같은 내용을 쓴다. */
const IntroContent: FC = () => (
  <div class="intro">
    <div class="intro-hero">
      <span class="orb a" aria-hidden="true"></span><span class="orb b" aria-hidden="true"></span><span class="orb c" aria-hidden="true"></span>
      <a class="brand big" href="/"><i></i>POLICYLOG</a>
      <p class="eyebrow">이용약관 · 개인정보 처리방침 변경 아카이브</p>
      <h1 id="intro-title">약관은 바뀌고,<br />알림은 오지 않습니다.</h1>
      <p class="sub">
        POLICYLOG 는 한국 서비스의 이용약관과 개인정보 처리방침을 매일 확인해,
        무엇이 어떻게 바뀌었는지 조문 단위로 남기는 공개 아카이브입니다. 계정도, 설치도 필요 없습니다.
      </p>
      <div class="cta">
        <a class="btn primary" href="/start" data-start>시작하기</a>
        <a class="btn" href="#how">사용 방법 보기</a>
      </div>
      {/* 제품이 하는 일을 말 대신 보여준다. 실제 기록이 아니라 예시라 aria-hidden 이다. */}
      <div class="demo card static" aria-hidden="true">
        <div class="cite"><b>제3조</b><span>국외 이전</span><span class="imp hi">높음</span><span class="seal"><em>시행</em>2026.07.07</span></div>
        <p class="text">개인정보를 <del>국외로 이전하지 않습니다</del><ins>미국의 서버로 이전하며 AI 학습에 활용할 수 있습니다</ins>.</p>
        <p class="demo-cap">바뀐 문장을 조문 단위로 잡아, 지운 곳은 붉게 넣은 곳은 푸르게 남깁니다.</p>
      </div>
      <span class="cue" aria-hidden="true"></span>
    </div>
    <section class="intro-sec" aria-labelledby="what">
      <h2 id="what">무엇을 하나요</h2>
      <ul class="trio">
        {FEATURES.map((f, i) => (
          <li class="card static in" style={`--i:${i + 1}`}>
            <span class="icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d={f.icon} /></svg></span>
            <h3>{f.title}</h3><p>{f.body}</p>
          </li>
        ))}
      </ul>
    </section>
    <section class="intro-sec" id="how" aria-labelledby="how-title">
      <h2 id="how-title">어떻게 쓰나요</h2>
      <ol class="trio">
        {STEPS.map((s, i) => (
          <li class="card static in" style={`--i:${i + 2}`}><span class="n">{i + 1}</span><h3>{s.title}</h3><p>{s.body}</p></li>
        ))}
      </ol>
    </section>
    <section class="intro-sec" aria-labelledby="rules-title">
      <h2 id="rules-title">지키는 원칙</h2>
      <ul class="rules">
        <li><b>전문은 게시하지 않습니다.</b> 변경된 부분과 조문당 800자 이내 발췌만 보여주고, 항상 공식 문서로 안내합니다.</li>
        <li><b>회피하지 않습니다.</b> User-Agent 하나로 하루 한 번 이하 접근하고, 프록시나 캡차 우회를 쓰지 않습니다.</li>
        <li><b>못 가져오는 문서도 숨기지 않습니다.</b> 사유와 확인한 날짜를 카탈로그에 그대로 적어 둡니다.</li>
      </ul>
      <p class="center" style="margin-top:18px"><a href="/bot">수집 정책 전문 보기</a></p>
    </section>
    <div class="cta"><a class="btn primary" href="/start" data-start>기록 보러 가기</a></div>
  </div>
)

/** 첫 방문에 홈 위를 덮는 스플래시. 서버가 쿠키를 보고 그리므로 깜빡임이 없다. */
const Splash: FC = () => (
  <div class="splash" id="splash" role="dialog" aria-modal="true" aria-labelledby="intro-title">
    <a class="btn sm skip" href="/start" data-start>건너뛰기</a>
    <div class="splash-inner"><IntroContent /></div>
  </div>
)

export const IntroPage: FC = () => <IntroContent />

/** 비회원에게 감춘 카드 대신 서는 한 장. 못 가져오는 문서가 몇 건인지도 숨기지 않는다 (§2.7). */
const GateCard: FC<{ hidden: DocumentRow[]; i: number }> = ({ hidden, i }) => {
  const n = (k: string) => hidden.filter((d) => statusKey(d) === k).length
  return (
    <article class="card gate in" style={`--i:${i}`}>
      <p class="eyebrow">회원 전용</p>
      <h3 class="who">{hidden.length}건이 더 있습니다</h3>
      <p class="what">수집 중 {n('active')}건, 준비 중 {n('pending')}건, 못 가져옴 {n('blocked')}건. 가입하면 전체 약관 변경 내역 카드가 열립니다. 무료이고, Google 계정으로도 됩니다.</p>
      <div class="cta left"><a class="btn primary sm" href="/join">무료로 가입</a><a class="btn sm" href="/login">로그인</a></div>
    </article>
  )
}

export const Home: FC<{ docs: DocumentRow[]; signals: Signals; featured: DocumentRow[]; total: number; showIntro: boolean; member: boolean }> = ({ docs, signals: s, featured, total, showIntro, member }) => {
  const watched = docs.filter((d) => d.status === 'ACTIVE').length
  const soon = docs.filter((d) => d.status === 'PENDING_RENDER').length
  const shut = docs.filter((d) => d.status === 'BLOCKED').length
  const kept = [...s.counts.values()].reduce((n, c) => n + c.n, 0)
  const picked = new Set(featured.map((d) => d.id))
  const rest = orderForGrid(docs.filter((d) => !picked.has(d.id)), s)
  const shown = member ? rest : rest.slice(0, PREVIEW_CARDS)
  const hidden = rest.slice(shown.length)
  return (
    <>
      {showIntro && <Splash />}
      <section class="hero" aria-labelledby="home-title">
        <p class="eyebrow">이용약관 · 개인정보 처리방침 변경 아카이브</p>
        <h1 id="home-title">약관은 바뀌고, 알림은 오지 않습니다.</h1>
        <p class="sub">한국 서비스의 약관과 처리방침을 매일 확인해 무엇이 어떻게 바뀌었는지 조문 단위로 남깁니다. 서비스 이름으로 바로 찾아보세요.</p>
        <SearchBox />
        <p class="hint">Enter 를 누르지 않아도 카드가 바로 걸러집니다.</p>
        <ul class="stats" aria-label="아카이브 현황">
          <li class="in" style="--i:1"><b>{watched}</b><span>매일 확인하는 문서</span></li>
          <li class="in" style="--i:2"><b>{kept}</b><span>보존한 버전</span></li>
          <li class="in" style="--i:3"><b>{total}</b><span>기록된 변경</span></li>
          <li class="in" style="--i:4"><b>{shut}</b><span>못 가져오는 문서</span></li>
        </ul>
      </section>

      {featured.length > 0 && (
        <section id="featured" aria-labelledby="featured-title">
          <div class="sec">
            <div><h2 id="featured-title">이번 주 조회 상위 기업</h2><p>최근 7일 동안 가장 많이 열어 본 기업의 약관입니다. 가장 최근 변경의 조문을 함께 보입니다.</p></div>
          </div>
          <div class="featured">{featured.map((d, i) => <FeaturedCard d={d} s={s} rank={i + 1} />)}</div>
        </section>
      )}

      <section id="all" aria-labelledby="all-title">
        <div class="sec">
          <div><h2 id="all-title">전체 약관 변경 내역</h2>
            <p>문서 {docs.length}건 가운데 {watched}건을 매일 확인합니다. {soon}건은 준비 중이고, {shut}건은 가져오지 못합니다. 못 가져오는 문서도 사유를 적어 그대로 둡니다.</p></div>
          <div class="side">
            <div class="chips js-only" role="group" aria-label="상태로 거르기">
              <button type="button" class="chip on" data-f="all" aria-pressed="true">전체</button>
              <button type="button" class="chip" data-f="active" aria-pressed="false">수집 중</button>
              <button type="button" class="chip" data-f="pending" aria-pressed="false">준비 중</button>
              <button type="button" class="chip" data-f="blocked" aria-pressed="false">못 가져옴</button>
              <span class="count"><b id="count">{featured.length + shown.length}</b>건</span>
            </div>
            <a class="lnk" href="/changes">변경 기록 전체</a>
          </div>
        </div>
        <div id="grid" class="grid">
          {shown.map((d, i) => <DocCard d={d} s={s} i={i} />)}
          {hidden.length > 0 && <GateCard hidden={hidden} i={shown.length} />}
        </div>
        <p id="empty" class="note" hidden>걸리는 문서가 없습니다. 다른 낱말로 찾아보거나, 거르기를 "전체" 로 되돌리세요.</p>
      </section>
    </>
  )
}

export const SearchPage: FC<{ q: string; docs: DocumentRow[]; signals: Signals; member: boolean }> = ({ q, docs, signals: s, member }) => {
  const ordered = orderForGrid(docs, s)
  const shown = member ? ordered : ordered.slice(0, PREVIEW_CARDS)
  const hidden = ordered.slice(shown.length)
  return (
  <>
    <section class="hero compact" aria-labelledby="search-title">
      <p class="eyebrow">검색</p>
      <h1 id="search-title">"{q}"</h1>
      <SearchBox q={q} autofocus />
      <p class="hint">{docs.length > 0 ? `문서 ${docs.length}건이 걸렸습니다.` : '걸리는 문서가 없습니다. 서비스 이름이나 "약관", "개인정보" 로 찾아보세요.'}</p>
    </section>
    {docs.length > 0 && <div id="grid" class="grid" style="margin-top:40px">
      {shown.map((d, i) => <DocCard d={d} s={s} i={i} />)}
      {hidden.length > 0 && <GateCard hidden={hidden} i={shown.length} />}
    </div>}
    <p class="center" style="margin-top:40px"><a class="btn" href="/">전체 기록으로</a></p>
  </>
  )
}

export const ChangesPage: FC<{ changes: ChangeListRow[] }> = ({ changes }) => (
  <>
    <section class="hero compact" aria-labelledby="changes-title">
      <p class="eyebrow">변경 기록</p>
      <h1 id="changes-title">기록된 변경 {changes.length}건</h1>
      <p class="sub">중요도는 바뀐 조문의 주제로 매깁니다. 국외 이전, 제3자 제공, AI 학습 이용이 가장 높습니다.</p>
    </section>
    {changes.length === 0
      ? <p class="note" style="margin:32px auto">아직 감지된 변경이 없습니다. 문서를 계속 지켜보고 있습니다.</p>
      : <ul class="ledger" style="margin-top:32px">
          {changes.map((c, i) => (
            <li class="in" style={`--i:${i}`}>
              <a class="row" href={`/changes/${c.id}`}>
                <span class="d"><Seal effectiveAt={c.effective_at} observedAt={c.detection_window_end} /></span>
                <span class="t">{c.title}</span>
                <span><Importance n={c.importance} /></span>
                <span class="k">
                  {catList(cats(c))}
                  {c.suppressed_reason === 'BACKFILL' && <span class="tag mark">과거 이력</span>}
                </span>
              </a>
            </li>
          ))}
        </ul>}
  </>
)

export const DocumentPage: FC<{ d: DocumentRow; versions: { id: string; effective_at: string | null; observed_at: string; provenance: string; source_url: string; text_length: number }[]; changes: ChangeListRow[] }> = ({ d, versions, changes }) => {
  const byTo = new Map(changes.map((c) => [c.to_version_id, c]))
  return (
    <>
      <a class="back" href="/">기록 전체</a>
      <p class="eyebrow">{d.service_name} · {TYPE_LABEL[d.type] ?? d.type}</p>
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
      {versions.length === 0
        ? <p class="note">아직 보존한 버전이 없습니다. {d.status === 'ACTIVE' ? '다음 확인 때 첫 버전을 보존합니다.' : '지금은 이 문서를 가져오지 못합니다.'}</p>
        : <div class="panel in"><div class="wrap"><table><thead><tr><th>시행일</th><th>감지</th><th>출처</th><th>변경</th></tr></thead><tbody>
            {versions.map((v, i) => {
              const c = byTo.get(v.id)
              return (
                <tr>
                  <td><a class="num" href={`/policies/${d.id}/versions/${v.id}`}>{v.effective_at ?? <span class="muted">시행일 미표기</span>}</a>{i === 0 && <> <span class="tag ok">현행</span></>}</td>
                  <td class="small num">{v.observed_at.slice(0, 10)}</td>
                  <td><Provenance p={v.provenance} /></td>
                  <td class="small">{c ? <a href={`/changes/${c.id}`}><Importance n={c.importance} /> {cats(c).slice(0, 3).map(cat).join(', ')}</a> : i === versions.length - 1 ? <span class="muted">최초 보존본</span> : ''}</td>
                </tr>
              )
            })}
          </tbody></table></div></div>}
    </>
  )
}

export const VersionPage: FC<{ d: DocumentRow; v: ReturnType<typeof import('./public').shapeVersion> }> = ({ d, v }) => (
  <>
    <a class="back" href={`/policies/${d.id}`}>{d.title}</a>
    <p class="eyebrow">{d.service_name} · 보존한 버전</p>
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
    <div class="doc stack in">
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

export const ChangePage: FC<{ d: DocumentRow; c: ChangeRow; from: { id: string; effective_at: string | null; observed_at: string; source_url: string }; to: { id: string; effective_at: string | null; observed_at: string; source_url: string; provenance: string } }> = ({ d, c, from, to }) => {
  const sections: ChangeSection[] = JSON.parse(c.sections)
  const rows: TableRowChange[] = JSON.parse(c.table_rows)
  const cs: string[] = JSON.parse(c.categories)
  const order = (x: { importance: number }) => -x.importance
  return (
    <>
      <a class="back" href={`/policies/${d.id}`}>{d.title}</a>
      <p class="eyebrow">{d.service_name} · 변경</p>
      <h1>{d.title} 변경</h1>
      <ul class="meta">
        <li><Seal effectiveAt={to.effective_at} observedAt={to.observed_at} /></li>
        <li><Importance n={c.importance} /></li>
        <li>{cs.map(cat).join(', ') || '분류 없음'}</li>
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
        <div class="panel in"><div class="wrap"><table><thead><tr><th>표</th><th>행</th><th>유형</th><th>이전</th><th>이후</th></tr></thead><tbody>
          {rows.sort((a, b) => order(a) - order(b)).map((r) => (
            <tr><td class="small">{r.tableIdentifier}</td><td>{r.rowKey}</td><td><span class="tag">{CHANGE_LABEL[r.changeType] ?? r.changeType}</span></td>
              <td class="small"><del>{r.beforeCells?.slice(1).join(' / ')}</del></td><td class="small"><ins>{r.afterCells?.slice(1).join(' / ')}</ins></td></tr>
          ))}
        </tbody></table></div></div>
      </>}

      <h2>바뀐 조문 {sections.length}건</h2>
      {sections.length === 0 && rows.length === 0
        ? <p class="note">본문 텍스트 차이가 없습니다. 구조나 표기만 바뀌었습니다.</p>
        : <p class="small muted">무거운 조문부터 놓습니다. 지운 곳은 붉게, 넣은 곳은 푸르게 표시합니다.</p>}
      <div class="doc stack in">
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
    <a class="back" href="/">기록 전체</a>
    <p class="eyebrow">POLICYLOG</p>
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

export const NotFoundPage: FC = () => (
  <section class="hero compact">
    <p class="eyebrow">404</p>
    <h1>페이지를 찾을 수 없습니다</h1>
    <p class="sub">주소가 바뀌었거나 게시가 중단된 문서일 수 있습니다.</p>
    <div class="cta"><a class="btn primary" href="/">기록 전체로</a><a class="btn" href="/intro">소개 보기</a></div>
  </section>
)

const GoogleG: FC = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
    <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
    <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
    <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
  </svg>
)

const GoogleButton: FC<{ next: string }> = ({ next }) => (
  <>
    <a class="btn google" href={`/auth/google?next=${encodeURIComponent(next)}`}><GoogleG />Google 계정으로 계속하기</a>
    <div class="or"><span>또는 이메일로</span></div>
  </>
)

export const JoinPage: FC<{ next: string; google: boolean; error?: string; values?: { email?: string; name?: string } }> = ({ next, google, error, values }) => (
  <section class="auth in">
    <p class="eyebrow">회원가입</p>
    <h1>전체 기록을 보려면<br />가입하세요.</h1>
    <p class="sub">무료입니다. 가입하면 모든 약관 변경 내역 카드가 열립니다.</p>
    <div class="card static auth-card">
      {google && <GoogleButton next={next} />}
      {error && <p class="err" role="alert">{error}</p>}
      <form class="auth-form" method="post" action="/join">
        <input type="hidden" name="next" value={next} />
        <label><span>이름 <span class="help">(선택)</span></span><input name="name" value={values?.name} maxlength={60} autocomplete="name" /></label>
        <label>이메일<input name="email" type="email" value={values?.email} required autocomplete="email" /></label>
        <label>비밀번호<input name="password" type="password" required minlength={MIN_PASSWORD} autocomplete="new-password" /><span class="help">{MIN_PASSWORD}자 이상</span></label>
        <button class="btn primary" type="submit">가입하기</button>
      </form>
      <p class="small muted" style="margin:0">이미 계정이 있나요? <a href={`/login?next=${encodeURIComponent(next)}`}>로그인</a></p>
    </div>
  </section>
)

export const LoginPage: FC<{ next: string; google: boolean; error?: string; values?: { email?: string } }> = ({ next, google, error, values }) => (
  <section class="auth in">
    <p class="eyebrow">로그인</p>
    <h1>다시 오셨군요.</h1>
    <p class="sub">로그인하면 전체 약관 변경 내역을 볼 수 있습니다.</p>
    <div class="card static auth-card">
      {google && <GoogleButton next={next} />}
      {error && <p class="err" role="alert">{error}</p>}
      <form class="auth-form" method="post" action="/login">
        <input type="hidden" name="next" value={next} />
        <label>이메일<input name="email" type="email" value={values?.email} required autocomplete="email" /></label>
        <label>비밀번호<input name="password" type="password" required autocomplete="current-password" /></label>
        <button class="btn primary" type="submit">로그인</button>
      </form>
      <p class="small muted" style="margin:0">계정이 없나요? <a href={`/join?next=${encodeURIComponent(next)}`}>회원가입</a></p>
    </div>
  </section>
)

export const AdminPage: FC<{ docs: DocumentRow[]; counts: Map<string, { n: number; oldest: string }>; users: number }> = ({ docs, counts, users }) => (
  <>
    <p class="eyebrow">관리</p>
    <h1>수집 상태</h1>
    <p class="small muted">차단 문서의 미수집은 정상이다. 경고가 아니다 (§84.1). 회원 {users}명.</p>
    <div class="panel"><div class="wrap"><table><thead><tr><th>문서</th><th>티어</th><th>차단 유형</th><th>robots</th><th>버전</th><th>마지막 확인</th><th>오류</th><th></th></tr></thead><tbody>
      {docs.map((d) => (
        <tr>
          <td>{d.title}</td><td>{d.acquisition_tier}</td><td>{d.blocker_type}</td>
          <td class="small">{d.robots_verdict} {d.robots_checked_at?.slice(0, 10)}</td>
          <td>{counts.get(d.id)?.n ?? 0}</td><td class="small">{d.last_checked_at?.slice(0, 16)}</td>
          <td class="small">{d.status !== 'ACTIVE' ? <span class="muted">expected</span> : d.last_error}</td>
          <td>{d.status === 'ACTIVE' && <>
            <form method="post" action={`/admin/poll/${d.id}`}><button class="plain">폴링</button></form>{' '}
            {d.history_harvester && <form method="post" action={`/admin/backfill/${d.id}`}><button class="plain">백필</button></form>}
          </>}</td>
        </tr>
      ))}
    </tbody></table></div></div>
  </>
)
