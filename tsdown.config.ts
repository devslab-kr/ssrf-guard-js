import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: ['src/index.ts', 'src/vite.ts', 'src/hono.ts'],
  format: ['esm', 'cjs'],
  dts: true,
  clean: true,
  sourcemap: true,
});
