import { defineConfig } from 'vitest/config'
import path from 'node:path'
import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-pool-workers'

const migrations = await readD1Migrations(path.join(import.meta.dirname, 'migrations'))

// wrangler.jsonc 의 Hyperdrive 바인딩은 로컬에서 연결 문자열을 요구한다. 테스트는 D1 로 돌므로(src/sql.ts 의 우선순위) 더미로 채운다.
process.env.CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE ??= 'postgresql://test:test@127.0.0.1:1/test'

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: './wrangler.jsonc' },
      miniflare: {
        // DATABASE_URL 은 비운다. .dev.vars 에 운영 Postgres 를 넣어 둔 개발자에게도 테스트는 D1 로 돈다
        // (src/sql.ts 의 우선순위에서 DATABASE_URL 이 D1 을 이기므로, 비우지 않으면 테스트가 진짜 DB 에 붙는다).
        bindings: { ADMIN_PASSWORD: 'test', DATABASE_URL: '', SITE_URL: 'https://policylog.example', TEST_MIGRATIONS: migrations, GOOGLE_CLIENT_ID: 'test-client', GOOGLE_CLIENT_SECRET: 'test-secret', PASSWORD_ITERATIONS: '1000' },
        d1Databases: ['DB'],
        r2Buckets: ['RAW'],
      },
    }),
  ],
  test: { setupFiles: ['./test/setup.ts'] },
})
