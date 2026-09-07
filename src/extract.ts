// HTML → 블록 텍스트 + 표. Workers 내장 HTMLRewriter 만 쓴다 (cheerio 불필요).
// 출력은 블록 요소 경계마다 줄바꿈이 들어간 원시 텍스트이고, 정규화는 normalize.ts 가 한다.

export interface TableBlock { identifier: string; headers: string[]; rows: string[][] }
export interface Extracted { text: string; tables: TableBlock[]; title: string }

// void 요소는 종료 태그가 없다 — onEndTag 를 걸면 HTMLRewriter 가 "No end tag" 로 죽는다.
const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr'])

const BLOCK = new Set(['p', 'div', 'li', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'tr', 'br', 'section', 'article', 'table', 'dt', 'dd', 'blockquote', 'pre'])

export async function extract(html: string, selector: string, ignore: string[] = []): Promise<Extracted> {
  const out: string[] = []
  const tables: TableBlock[] = []
  let title = ''
  let inScope = 0
  let ignoring = 0
  let table: TableBlock | null = null
  let row: string[] | null = null
  let cell: string[] | null = null
  let rowIsHeader = false
  let heading: string[] | null = null
  let lastHeading = ''

  const push = (s: string) => { if (!ignoring && inScope > 0) out.push(s) }

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
      if (BLOCK.has(tag)) push('\n')
      if (tag === 'table') {
        table = { identifier: lastHeading, headers: [], rows: [] }
        el.onEndTag(() => { if (table && table.rows.length) tables.push(fixTable(table)); table = null })
      } else if (tag === 'tr' && table) {
        row = []; rowIsHeader = false
        el.onEndTag(() => {
          if (row && table) { if (rowIsHeader && !table.headers.length) table.headers = row; else table.rows.push(row) }
          row = null
        })
      } else if ((tag === 'td' || tag === 'th') && row) {
        cell = []; if (tag === 'th') rowIsHeader = true
        el.onEndTag(() => { if (cell && row) row.push(clean(cell.join(''))); cell = null })
      } else if (/^h[1-6]$/.test(tag)) {
        heading = []
        el.onEndTag(() => { if (heading) lastHeading = clean(heading.join('')); heading = null })
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

const clean = (s: string) => decodeEntities(s).replace(/\s+/g, ' ').trim()

// 헤더 행이 없으면 첫 행을 헤더로 본다. 식별자는 직전 제목, 없으면 헤더.
function fixTable(t: TableBlock): TableBlock {
  if (!t.headers.length && t.rows.length > 1) t.headers = t.rows.shift()!
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
