declare module '*.html?raw' {
  const content: string
  export default content
}

// cloudflare:test 의 env 와 워커 바인딩이 같은 타입을 보게 한다 (wrangler types 대신 손으로 둔다).
declare namespace Cloudflare {
  interface Env {
    DB: D1Database
    RAW: R2Bucket
    SITE_URL: string
    CONTACT_EMAIL: string
    USER_AGENT: string
    ADMIN_PASSWORD?: string
    TEST_MIGRATIONS: import('@cloudflare/vitest-pool-workers').D1Migration[]
  }
}
