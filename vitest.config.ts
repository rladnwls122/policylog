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
        bindings: { ADMIN_PASSWORD: 'test', TEST_MIGRATIONS: migrations },
        d1Databases: ['DB'],
        r2Buckets: ['RAW'],
      },
    }),
  ],
  test: { setupFiles: ['./test/setup.ts'] },
})
