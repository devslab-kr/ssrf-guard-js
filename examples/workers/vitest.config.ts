import { defineConfig } from 'vitest/config';

// Explicit, because this example lives inside the library repo now: vitest
// walks up looking for a config and would otherwise inherit the parent's
// `include: ['test/**/*.test.ts']`, which does not match this suite's
// `.spec.ts` naming — the tests would silently not run.
export default defineConfig({
  test: {
    root: __dirname,
    include: ['test/**/*.spec.ts'],
  },
});
