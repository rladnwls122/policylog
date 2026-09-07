declare module '*.html?raw' {
  const content: string
  export default content
}

// cloudflare:test 의 env 와 워커 바인딩이 같은 타입을 보게 한다 (wrangler types 대신 손으로 둔다).
declare namespace Cloudflare {
  interface Env {
    /** Postgres. 운영은 Hyperdrive 를 거치고, 로컬은 DATABASE_URL 로 직접 붙는다. 어느 쪽이든 있으면 그것이 저장소다 (src/sql.ts). */
    HYPERDRIVE?: Hyperdrive
    DATABASE_URL?: string
    /** 서버 인증서를 검증할 CA(PEM). 없으면 sslmode=require 는 암호화만 하고 검증하지 않는다. */
    DATABASE_CA?: string
    /** D1. 테스트(miniflare)와 Postgres 설정이 없는 로컬에서만 쓴다. 운영 wrangler.jsonc 에는 없다. */
    DB?: D1Database
    RAW: R2Bucket
    /** Browser Rendering (§85). RENDER_REQUIRED 문서에만 쓴다. 바인딩이 없으면 정적 수집만 돈다. */
    BROWSER?: Fetcher
    SITE_URL: string
    CONTACT_EMAIL: string
    USER_AGENT: string
    /** ENFORCE(기본) = robots 차단이면 수집하지 않는다. ADVISORY = 판정은 기록하되 게이트로 쓰지 않는다 (§24.4). */
    ROBOTS_MODE?: 'ENFORCE' | 'ADVISORY'
    ADMIN_PASSWORD?: string
    TEST_MIGRATIONS: import('@cloudflare/vitest-pool-workers').D1Migration[]
  }
}
