import { defineConfig } from 'vitest/config'
import path from 'node:path'
import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-pool-workers'

const migrations = await readD1Migrations(path.join(import.meta.dirname, 'migrations'))

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
