import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    coverage: {
      // Use V8 coverage provider (via @vitest/coverage-v8)
      provider: 'v8',
      // Generate reports locally/CI but keep them out of git via .gitignore
      reporter: ['text', 'lcov', 'html'],
      reportsDirectory: 'coverage',
      // Include files even if they don't have direct tests
      all: true,
      // Proactively track prompt modules in coverage
      include: ['src/prompts/**/*.ts'],
    },
  },
});
