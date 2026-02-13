import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    testTimeout: 120_000, // 2 minutes for on-chain txns
    hookTimeout: 60_000,
    setupFiles: ['./tests/setup.ts'],
    sequence: {
      sequential: true, // Run tests sequentially (on-chain tests depend on order)
    },
  },
});
