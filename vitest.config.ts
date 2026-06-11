import { defineConfig } from 'vitest/config';

// Single-config aggregation for the whole monorepo. Picks up:
//   - tests/**                                          — relocated skill tests (out-of-plugin so they
//                                                         do not ship via the marketplace bundle)
//   - grasp-it-plugin/src/**                 — skill TS source tests
//   - grasp-it-plugin/packages/dashboard/**  — dashboard utils tests
//
// The `@grasp-it/core` package owns its own vitest.config.ts and is
// invoked separately via `pnpm --filter @grasp-it/core test`; its
// files are excluded here to avoid double-counting.
export default defineConfig({
  test: {
    include: [
      'tests/**/*.test.{js,mjs,ts}',
      'grasp-it-plugin/src/**/*.test.{js,mjs,ts}',
      'grasp-it-plugin/packages/dashboard/**/*.test.{js,mjs,ts,tsx}',
    ],
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      'grasp-it-plugin/packages/core/**',
    ],
    testTimeout: 30_000,
  },
});
