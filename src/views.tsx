// 서버 렌더링 페이지. 공개 표면은 D-1 을 지킨다: 본문 전체를 그리는 컴포넌트는 없다.
import type { FC, PropsWithChildren } from 'hono/jsx'
import { diffWords } from 'diff'
import type { DocumentRow, ChangeListRow, ChangeRow } from './db'
import type { ChangeSection, TableRowChange } from './diff'
import type { PublicSection } from './public'
import { excerpt, focusOnChange } from './public'

const CSS = `
:root{--fg:#1a1a1a;--muted:#666;--line:#e5e5e5;--bg:#fff;--ins:#e6ffec;--del:#ffebe9;--hi:#c62828;--mid:#ef6c00}
@media(prefers-color-scheme:dark){:root{--fg:#eee;--muted:#999;--line:#333;--bg:#141414;--ins:#1b3a24;--del:#4a1c1c}}
body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.6 system-ui,-apple-system,"Apple SD Gothic Neo","Malgun Gothic",sans-serif}
main{max-width:920px;margin:0 auto;padding:24px 16px 64px}
header.top{border-bottom:1px solid var(--line)}header.top div{max-width:920px;margin:0 auto;padding:12px 16px;display:flex;gap:16px;align-items:baseline}
header.top a{color:inherit;text-decoration:none}header.top .brand{font-weight:800;letter-spacing:-.02em}
a{color:#0b57d0}.muted{color:var(--muted)}small,.small{font-size:13px}
table{border-collapse:collapse;width:100%}th{white-space:nowrap}th,td{text-align:left;padding:8px 6px;border-bottom:1px solid var(--line);vertical-align:top}
.badge{display:inline-block;font-size:12px;padding:1px 8px;border-radius:10px;border:1px solid var(--line);color:var(--muted);white-space:nowrap}
.badge.ok{border-color:#2e7d32;color:#2e7d32}.badge.blocked{border-color:var(--hi);color:var(--hi)}.badge.pending{border-color:var(--mid);color:var(--mid)}
.imp{font-weight:700}.imp.hi{color:var(--hi)}.imp.mid{color:var(--mid)}
ins{background:var(--ins);text-decoration:none}del{background:var(--del)}
pre.x{white-space:pre-wrap;word-break:keep-all;overflow-wrap:anywhere;background:none;border:1px solid var(--line);border-radius:6px;padding:12px;font:inherit;margin:8px 0}
.cols{display:grid;grid-template-columns:1fr 1fr;gap:12px}@media(max-width:700px){.cols{grid-template-columns:1fr}}
.note{border-left:3px solid var(--line);padding:4px 12px;color:var(--muted)}
h1{font-size:24px;letter-spacing:-.02em}h2{font-size:18px;margin-top:32px}h3{font-size:16px}
.wrap{overflow-x:auto}
`

export const Layout: FC<PropsWithChildren<{ title: string; siteUrl: string; feed?: string }>> = ({ title, feed, children }) => (
  <html lang="ko">
    <head>
      <meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" />
      <title>{title} · POLICYLOG</title>
      {feed && <link rel="alternate" type="application/rss+xml" href={feed} />}
      <style>{CSS}</style>
    </head>
    <body>
      <header class="top"><div><a class="brand" href="/">POLICYLOG</a><a class="small" href="/bot">수집 정책</a><a class="small" href="/api/v1/services">API</a></div></header>
      <main>{children}</main>
    </body>
  </html>
)

const BLOCKER_LABEL: Record<string, string> = { ROBOTS: 'robots.txt', WAF: '봇 차단', DOCUMENT_ABSENT: '문서 못 찾음' }

export const Badge: FC<{ d: Pick<DocumentRow, 'status' | 'blocker_type'> }> = ({ d }) =>
  d.status === 'ACTIVE' ? <span class="badge ok">수집 중</span>
  : d.status === 'PENDING_RENDER' ? <span class="badge pending">수집 준비 중</span>
  : <span class="badge blocked">수집 불가 · {BLOCKER_LABEL[d.blocker_type] ?? d.blocker_type}</span>

export const Provenance: FC<{ p: string }> = ({ p }) => (
  <span class="badge">{p === 'OFFICIAL_HISTORY' ? '서비스가 공식 공개한 이력' : p === 'SELF_FETCH' ? 'POLICYLOG가 직접 수집' : p}</span>
)

export const Importance: FC<{ n: number }> = ({ n }) => (
  <span class={`imp ${n >= 35 ? 'hi' : n >= 20 ? 'mid' : ''}`}>{n >= 35 ? '높음' : n >= 20 ? '보통' : '낮음'}</span>
)

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

export const Home: FC<{ docs: DocumentRow[]; counts: Map<string, { n: number; oldest: string }>; changes: ChangeListRow[] }> = ({ docs, counts, changes }) => (
  <>
    <h1>어떤 서비스의 약관이, 언제, 어떻게 바뀌었는지</h1>
    <p class="muted">공개된 이용약관·개인정보 처리방침의 변경 이력을 보존하고 diff 를 보여줍니다. 수집을 거부한 서비스는 수집하지 않고 그 사실을 표시합니다.</p>
    <h2>최근 변경</h2>
    {changes.length === 0 && <p class="muted">아직 감지된 변경이 없습니다.</p>}
    <div class="wrap"><table><thead><tr><th>문서</th><th>중요도</th><th>분류</th><th>시점</th></tr></thead><tbody>
      {changes.map((c) => (
        <tr>
          <td><a href={`/changes/${c.id}`}>{c.title}</a>{c.suppressed_reason === 'BACKFILL' && <span class="badge">이력 백필</span>}</td>
          <td><Importance n={c.importance} /></td>
          <td class="small">{catList(JSON.parse(c.categories) as string[])}</td>
          <td class="small">{c.effective_at ? `시행 ${c.effective_at}` : windowLabel(c.detection_window_start, c.detection_window_end, null)}</td>
        </tr>
      ))}
    </tbody></table></div>
    <h2>문서 카탈로그 · {docs.length}건</h2>
    <p class="small muted">
      수집 중 {docs.filter((d) => d.status === 'ACTIVE').length} ·
      수집 준비 중 {docs.filter((d) => d.status === 'PENDING_RENDER').length} ·
      수집 불가 {docs.filter((d) => d.status === 'BLOCKED').length}
      {' '}— 보존 버전 {[...counts.values()].reduce((n, c) => n + c.n, 0)}개.
      수집 불가는 서비스가 거부한 것이고, 우회하지 않습니다.
    </p>
    <div class="wrap"><table><thead><tr><th>서비스</th><th>문서</th><th>상태</th><th>보존 버전</th></tr></thead><tbody>
      {docs.map((d) => {
        const c = counts.get(d.id)
        return (
          <tr>
            <td>{d.service_name}</td>
            <td>{d.status === 'ACTIVE' ? <a href={`/policies/${d.id}`}>{d.title}</a> : d.title}<br /><a class="small muted" href={d.canonical_url} rel="noopener nofollow">공식 문서 보기 →</a></td>
            <td><Badge d={d} />{d.public_note && <div class="small muted">{d.public_note} ({(d.robots_checked_at ?? '2026-09-07').slice(0, 10)} 확인)</div>}</td>
            <td class="small">{c ? `${c.n}개 · ${c.oldest}부터` : d.status === 'ACTIVE' ? '수집 대기' : '—'}</td>
          </tr>
        )
      })}
    </tbody></table></div>
  </>
)

export const DocumentPage: FC<{ d: DocumentRow; versions: { id: string; effective_at: string | null; observed_at: string; provenance: string; source_url: string; text_length: number }[]; changes: ChangeListRow[] }> = ({ d, versions, changes }) => {
  const byTo = new Map(changes.map((c) => [c.to_version_id, c]))
  return (
    <>
      <p class="small"><a href="/">← 카탈로그</a></p>
      <h1>{d.title}</h1>
      <p><Badge d={d} /> <a href={d.canonical_url} rel="noopener nofollow">공식 문서 보기 →</a> · <a href={`/policies/${d.id}/feed.xml`}>RSS</a>
        {d.official_history_url && <> · <a href={d.official_history_url} rel="noopener nofollow">공식 이력 페이지</a></>}</p>
      {d.public_note && <p class="note">{d.public_note}</p>}
      <h2>타임라인 · {versions.length}개 버전</h2>
      <div class="wrap"><table><thead><tr><th>시행일</th><th>감지</th><th>출처</th><th>변경</th></tr></thead><tbody>
        {versions.map((v, i) => {
          const c = byTo.get(v.id)
          return (
            <tr>
              <td><a href={`/policies/${d.id}/versions/${v.id}`}>{v.effective_at ?? <span class="muted">시행일 미표기</span>}</a>{i === 0 && <> <span class="badge ok">현행</span></>}</td>
              <td class="small">{v.observed_at.slice(0, 10)}</td>
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
    <p class="small"><a href={`/policies/${d.id}`}>← {d.title}</a></p>
    <h1>{d.title} <span class="muted">{v.effective_at ?? '시행일 미표기'}</span></h1>
    <p><Provenance p={v.provenance} /> <span class="small muted">감지 {v.observed_at.slice(0, 10)} · 원본 <a href={v.source_url} rel="noopener nofollow">{v.source_url}</a> · 본문 {v.textLength.toLocaleString()}자 · 해시 {v.content_hash.slice(0, 12)}</span></p>
    <p class="note">POLICYLOG 는 전체 본문을 게시하지 않습니다. 조문별 발췌만 보여주며, 전문은 서비스 공식 페이지에서 확인하세요.</p>
    {v.sections.length === 0 && <p class="muted">조문 구조를 인식하지 못한 문서입니다. 변경은 문단 단위로 비교됩니다.</p>}
    {v.sections.map((s: PublicSection) => (
      <section>
        <h3>{s.identifier} {s.title}</h3>
        {s.excerpt ? <pre class="x">{s.excerpt}{s.truncated && ' …'}</pre> : <p class="small muted">발췌 한도 초과 — 원문에서 확인</p>}
      </section>
    ))}
  </>
)

const WordDiff: FC<{ before: string; after: string }> = ({ before, after }) => (
  <pre class="x">{diffWords(before, after).map((p) => p.added ? <ins>{p.value}</ins> : p.removed ? <del>{p.value}</del> : p.value)}</pre>
)

export const ChangePage: FC<{ d: DocumentRow; c: ChangeRow; from: { id: string; effective_at: string | null; observed_at: string; source_url: string }; to: { id: string; effective_at: string | null; observed_at: string; source_url: string; provenance: string } }> = ({ d, c, from, to }) => {
  const sections: ChangeSection[] = JSON.parse(c.sections)
  const rows: TableRowChange[] = JSON.parse(c.table_rows)
  const cats: string[] = JSON.parse(c.categories)
  const order = (x: { importance: number }) => -x.importance
  return (
    <>
      <p class="small"><a href={`/policies/${d.id}`}>← {d.title}</a></p>
      <h1>{d.title} 변경</h1>
      <p>
        <Importance n={c.importance} /> · {cats.map(cat).join(', ') || '분류 없음'}<br />
        <span class="small muted">
          출처 <Provenance p={to.provenance} /> ·
          {to.effective_at ? ` 시행 ${to.effective_at}` : ' 시행일 미표기'} ·
          {' '}{to.provenance === 'OFFICIAL_HISTORY' ? '서비스가 날짜를 표기한 버전' : windowLabel(c.detection_window_start, c.detection_window_end, to.effective_at)}
          {c.suppressed_reason === 'BACKFILL' && ' · 이력 백필로 생성된 비교 (알림 대상 아님)'}
        </span>
      </p>
      <p class="small">이전 <a href={`/policies/${d.id}/versions/${from.id}`}>{from.effective_at ?? from.observed_at.slice(0, 10)}</a> → 이후 <a href={`/policies/${d.id}/versions/${to.id}`}>{to.effective_at ?? to.observed_at.slice(0, 10)}</a> · <a href={to.source_url} rel="noopener nofollow">원문 보기 →</a></p>
      <p class="note">자동 생성된 비교입니다. 법률 자문이 아니며, 해석은 각 서비스의 공식 문서를 따릅니다.</p>

      {rows.length > 0 && <>
        <h2>표 변경 · {rows.length}건</h2>
        <div class="wrap"><table><thead><tr><th>표</th><th>행</th><th>유형</th><th>이전</th><th>이후</th></tr></thead><tbody>
          {rows.sort((a, b) => order(a) - order(b)).map((r) => (
            <tr><td class="small">{r.tableIdentifier}</td><td>{r.rowKey}</td><td><span class="badge">{r.changeType}</span></td>
              <td class="small">{r.beforeCells?.slice(1).join(' / ')}</td><td class="small">{r.afterCells?.slice(1).join(' / ')}</td></tr>
          ))}
        </tbody></table></div>
      </>}

      <h2>조문 변경 · {sections.length}건</h2>
      {sections.length === 0 && rows.length === 0 && <p class="muted">본문 텍스트 차이가 없습니다 (구조·표기만 변경).</p>}
      {sections.sort((a, b) => order(a) - order(b)).map((s) => (
        <section>
          <h3>{s.identifier} {s.title} <span class="badge">{s.changeType}</span> <span class="small"><Importance n={s.importance} /></span></h3>
          {s.changeType === 'MODIFIED'
            ? <WordDiff {...focusOnChange(s.beforeText ?? '', s.afterText ?? '')} />
            : <pre class="x">{s.changeType === 'ADDED' ? <ins>{excerpt(s.afterText)}</ins> : <del>{excerpt(s.beforeText)}</del>}</pre>}
        </section>
      ))}
    </>
  )
}

export const BotPage: FC<{ ua: string; contact: string }> = ({ ua, contact }) => (
  <>
    <h1>수집 정책</h1>
    <p>POLICYLOG 는 공개된 문서의 변경 사실을 기록합니다. 법률 자문이 아니며, 원문의 해석은 각 서비스의 공식 문서를 따릅니다. <strong>수집을 거부한 서비스의 문서는 수집하지 않으며, 그 사실을 표시합니다.</strong></p>
    <h2>어떻게 수집하나</h2>
    <ul>
      <li>User-Agent 는 항상 <code>{ua}</code> 하나입니다. 브라우저를 흉내내지 않습니다.</li>
      <li>robots.txt 를 매주 다시 확인합니다. 차단으로 바뀌면 즉시 중단하고, 보존한 이력은 유지합니다. robots.txt 자체가 403 이거나 응답이 없으면 차단으로 봅니다.</li>
      <li>문서당 하루 1회, 같은 도메인에 10초 이상 간격, 이력 페이지는 5초 간격·하루 30건 이하로 접근합니다.</li>
      <li>IP 우회·프록시·핑거프린트 조작·캡차 해결·로그인 뒤 콘텐츠 접근은 하지 않습니다.</li>
      <li>원문 전체는 게시하지 않습니다. 변경된 부분과 조문당 800자 이내의 발췌만 보여주고, 항상 공식 페이지로 링크합니다.</li>
    </ul>
    <h2>게시 중단 요청</h2>
    <p><a href={`mailto:${contact}`}>{contact}</a> 로 요청하시면 24시간 내 게시를 중단한 뒤 검토합니다. 중단은 되돌릴 수 있습니다.</p>
    <h2>접근 허용 요청</h2>
    <p>robots.txt 로 차단된 문서는 수집하지 않습니다. 허용을 원하시면 위 User-Agent 에 한해 해당 경로 하나를 Allow 해 주시면 됩니다.</p>
  </>
)

export const AdminPage: FC<{ docs: DocumentRow[]; counts: Map<string, { n: number; oldest: string }> }> = ({ docs, counts }) => (
  <>
    <h1>수집 상태</h1>
    <p class="small muted">차단 문서의 미수집은 정상이다 — 경고가 아니다 (§84.1).</p>
    <div class="wrap"><table><thead><tr><th>문서</th><th>티어</th><th>차단 유형</th><th>robots</th><th>버전</th><th>마지막 확인</th><th>오류</th><th></th></tr></thead><tbody>
      {docs.map((d) => (
        <tr>
          <td>{d.title}</td><td>{d.acquisition_tier}</td><td>{d.blocker_type}</td>
          <td class="small">{d.robots_verdict} {d.robots_checked_at?.slice(0, 10)}</td>
          <td>{counts.get(d.id)?.n ?? 0}</td><td class="small">{d.last_checked_at?.slice(0, 16)}</td>
          <td class="small">{d.status !== 'ACTIVE' ? <span class="muted">expected</span> : d.last_error}</td>
          <td>{d.status === 'ACTIVE' && <>
            <form method="post" action={`/admin/poll/${d.id}`} style="display:inline"><button>폴링</button></form>{' '}
            {d.history_harvester && <form method="post" action={`/admin/backfill/${d.id}`} style="display:inline"><button>백필</button></form>}
          </>}</td>
        </tr>
      ))}
    </tbody></table></div>
  </>
)
