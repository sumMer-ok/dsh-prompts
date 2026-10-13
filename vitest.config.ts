import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'

const here = fileURLToPath(new URL('.', import.meta.url))

/** Workspace packages resolve to their sources so tests run without a prior build. */
const alias = {
  '@deepseek-ai/dsh-prompts/web-api': `${here}packages/prompts/src/web-api.ts`,
  '@deepseek-ai/dsh-prompts': `${here}packages/prompts/src/index.ts`,
}

export default defineConfig({
  resolve: { alias },
  test: {
    environment: 'node',
    include: ['packages/*/tests/**/*.spec.ts'],
  },
})
