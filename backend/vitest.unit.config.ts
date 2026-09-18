import { defineConfig } from 'vitest/config';

// Unit tests mock their dependencies and do not need PostgreSQL/Redis containers.
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/unit/**/*.test.ts'],
  },
});
