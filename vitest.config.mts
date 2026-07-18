import { defineConfig } from 'vitest/config';

// Separate from vite.config.mts, whose root points at src/client — seam tests live in test/.
export default defineConfig({ test: { include: ['test/**/*.test.ts'] } });
