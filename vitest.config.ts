import { defineConfig, mergeConfig } from 'vitest/config';
import viteConfig from './vite.config.ts';

// Default environment is node; component tests opt into jsdom with a `// @vitest-environment jsdom` docblock.
export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'],
      environment: 'node',
    },
  }),
);
