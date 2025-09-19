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
      // Track coverage for core domains exercised by tests
      include: [
        'src/openai/**/*.ts',
        'src/langchain/**/*.ts',
        'src/analysis/**/*.ts',
        'src/prompts/**/*.ts',
      ],
      exclude: [
        '**/__tests__/**',
        '**/*.test.ts',
        '**/*.spec.ts',
        '**/*.mock.ts',
      ],
    },
  },
});
