// HTML → 블록 텍스트 + 표. Workers 내장 HTMLRewriter 만 쓴다 (cheerio 불필요).
// 출력은 블록 요소 경계마다 줄바꿈이 들어간 원시 텍스트이고, 정규화는 normalize.ts 가 한다.

export interface TableBlock { identifier: string; headers: string[]; rows: string[][] }
export interface Extracted { text: string; tables: TableBlock[]; title: string }

// void 요소는 종료 태그가 없다 — onEndTag 를 걸면 HTMLRewriter 가 "No end tag" 로 죽는다.
const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr'])

const BLOCK = new Set(['p', 'div', 'li', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'tr', 'br', 'section', 'article', 'table', 'dt', 'dd', 'blockquote', 'pre'])

// 망가진 페이지의 rowspan="9999" 하나로 메모리를 다 쓰지 않게 막는다. 실제 약관 표는 두 자리를 넘지 않는다.
const MAX_SPAN = 50
const MAX_COLS = 200

/** 병합 셀이 아래 행으로 흘려보내는 값. 칸 하나에 하나이고, colspan 은 이미 칸 수만큼 펼쳐 놓는다. */
interface Carry { value: string; left: number }

/** 표 하나의 조립 상태. 표 안의 표가 있으므로 스택으로 쌓는다. */
interface TableState {
  block: TableBlock
  carry: Map<number, Carry>
  row: string[] | null
  /** 이 행의 실제 셀이 전부 th 인가. 한 칸이라도 td 면 본문 행이다. */
  rowAllHeader: boolean
  inThead: boolean
}

export async function extract(html: string, selector: string, ignore: string[] = []): Promise<Extracted> {
  const out: string[] = []
  const tables: TableBlock[] = []
  let title = ''
  let inScope = 0
  let ignoring = 0
  const stack: TableState[] = []
  let cell: string[] | null = null
  let heading: string[] | null = null
  let lastHeading = ''

  const push = (s: string) => { if (!ignoring && inScope > 0) out.push(s) }
  const top = () => stack[stack.length - 1]

  const rewriter = new HTMLRewriter()
    .on('title', { text(t) { title += t.text } })
    .on(selector, {
      element(el) {
        if (VOID.has(el.tagName)) return
        inScope++
        el.onEndTag(() => { inScope-- })
      },
    })
  for (const sel of ignore) {
    rewriter.on(`${selector} ${sel}`, {
      element(el) { if (VOID.has(el.tagName)) return; ignoring++; el.onEndTag(() => { ignoring-- }) },
    })
  }
  rewriter.on(`${selector} *`, {
    element(el) {
      if (ignoring) return
      const tag = el.tagName
      if (BLOCK.has(tag)) { push('\n'); if (cell && cell.length) cell.push(' ') } // 셀 안의 <br>·<p> 는 붙지 않게 띄운다
      if (tag === 'table') {
        // 표 안의 표. 바깥 표의 조립 상태와 열려 있던 셀을 그대로 두고 새 표를 위에 쌓는다.
        const outerCell = cell
        cell = null
        const t: TableState = { block: { identifier: lastHeading, headers: [], rows: [] }, carry: new Map(), row: null, rowAllHeader: false, inThead: false }
        stack.push(t)
        el.onEndTag(() => {
          stack.pop()
          if (t.block.rows.length) tables.push(fixTable(t.block))
          cell = outerCell
        })
      } else if (tag === 'thead' && top()) {
        const t = top()
        t.inThead = true
        el.onEndTag(() => { t.inThead = false })
      } else if (tag === 'tr' && top()) {
        const t = top()
        t.row = []
        t.rowAllHeader = true
        fillCarry(t)
        el.onEndTag(() => { endRow(t) })
      } else if ((tag === 'td' || tag === 'th') && top()?.row) {
        const t = top()
        if (tag === 'td') t.rowAllHeader = false
        const colspan = span(el.getAttribute('colspan'))
        const rowspan = span(el.getAttribute('rowspan'))
        cell = []
        const buf = cell
        el.onEndTag(() => {
          placeCell(t, clean(buf.join('')), colspan, rowspan)
          cell = null
        })
      } else if (/^h[1-6]$/.test(tag)) {
        heading = []
        const buf = heading
        el.onEndTag(() => { lastHeading = clean(buf.join('')); heading = null })
      }
    },
    text(t) {
      if (ignoring || inScope <= 0) return
      out.push(t.text)
      if (cell) cell.push(t.text)
      if (heading) heading.push(t.text)
    },
  })

  await rewriter.transform(new Response(html)).text()
  return { text: decodeEntities(out.join('')), tables, title: clean(title) }
}

const span = (v: string | null) => Math.min(MAX_SPAN, Math.max(1, Number(v) || 1))

/** 위 행에서 흘러내려온 값으로 지금 칸부터 채운다. 다 쓴 칸은 지운다. */
function fillCarry(t: TableState) {
  while (t.row && t.row.length < MAX_COLS) {
    const at = t.row.length
    const c = t.carry.get(at)
    if (!c) break
    t.row.push(c.value)
    if (--c.left <= 0) t.carry.delete(at)
  }
}

/** 셀 하나를 놓는다. colspan 은 칸 수만큼 같은 값으로 펼치고, rowspan 은 아래 행으로 흘려보낸다. */
function placeCell(t: TableState, value: string, colspan: number, rowspan: number) {
  if (!t.row) return
  fillCarry(t)
  const col = t.row.length
  for (let i = 0; i < colspan && t.row.length < MAX_COLS; i++) {
    t.row.push(value)
    if (rowspan > 1) t.carry.set(col + i, { value, left: rowspan - 1 })
  }
  fillCarry(t)
}

function endRow(t: TableState) {
  if (!t.row) return
  fillCarry(t)                       // 행 끝에 걸린 병합 칸까지 채운다
  const row = t.row
  t.row = null
  if (!row.length) return
  // 머리 행은 thead 안이거나 칸이 전부 th 인 행뿐이다. 첫 칸만 th 인 행(항목명이 th 인 한국 표)은 본문이다.
  if ((t.inThead || t.rowAllHeader) && !t.block.headers.length && !t.block.rows.length) t.block.headers = row
  else t.block.rows.push(row)
}

const clean = (s: string) => decodeEntities(s).replace(/\s+/g, ' ').trim()

// 헤더 행이 없으면 첫 행을 헤더로 본다. 식별자는 직전 제목, 없으면 헤더.
function fixTable(t: TableBlock): TableBlock {
  if (!t.headers.length && t.rows.length > 1) t.headers = t.rows.shift()!
  // 병합 때문에 짧은 행이 남을 수 있다. 열 수를 머리에 맞춰 채워야 열끼리 비교된다.
  const width = Math.max(t.headers.length, ...t.rows.map((r) => r.length))
  for (const r of t.rows) while (r.length < width) r.push('')
  if (!t.identifier) t.identifier = t.headers.join(' / ')
  return t
}

export function decodeEntities(s: string): string {
  return s
    .replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&amp;/g, '&')
}
