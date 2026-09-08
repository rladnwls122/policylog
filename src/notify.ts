// 변경 알림 메일. 관심 약관에 변경이 발행되면 알림을 켠 회원에게 한 통씩 보낸다.
// 발송은 Resend 의 REST API 하나로 끝낸다 — RESEND_API_KEY 가 없으면 아무것도 하지 않는다 (로컬·테스트).
// 본문에는 발췌를 넣지 않는다. 공개 표면 규칙(D-1)은 메일에도 같다 — 무엇이 바뀌었는지는 링크 너머에서 본다.
import { type Env, notifyRecipients, getDocument, type ChangeRow } from './db'
import { CAT } from './views'

const RESEND_URL = 'https://api.resend.com/emails'

export async function notifyChange(env: Env, change: Pick<ChangeRow, 'id' | 'document_id' | 'importance' | 'categories'>, effectiveAt: string | null, observedAt: string) {
  if (!env.RESEND_API_KEY) return 0
  const [doc, to] = await Promise.all([getDocument(env, change.document_id), notifyRecipients(env, change.document_id)])
  if (!doc || to.length === 0) return 0
  const cats = (JSON.parse(change.categories) as string[]).map((c) => CAT[c] ?? c).join(', ') || '분류 없음'
  const when = effectiveAt ? `시행 ${effectiveAt}` : `감지 ${observedAt.slice(0, 10)}`
  const level = change.importance >= 35 ? '높음' : change.importance >= 20 ? '보통' : '낮음'
  const url = `${env.SITE_URL}/changes/${change.id}`
  const res = await fetch(RESEND_URL, {
    method: 'POST',
    headers: { authorization: `Bearer ${env.RESEND_API_KEY}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      from: env.MAIL_FROM ?? `POLICYLOG <${env.CONTACT_EMAIL}>`,
      to, // ponytail: 수신자를 한 요청에 다 넣는다. Resend 상한 50명 — 넘기면 50명씩 끊어 보낸다.
      subject: `[POLICYLOG] ${doc.title} 변경 · ${when}`,
      text: `${doc.service_name}의 ${doc.title}이(가) 바뀌었습니다.\n\n${when}\n중요도 ${level}\n분류 ${cats}\n\n조문 단위 비교: ${url}\n\n알림은 설정에서 끌 수 있습니다: ${env.SITE_URL}/me`,
    }),
  })
  if (!res.ok) throw new Error(`RESEND_${res.status}`)
  return to.length
}
