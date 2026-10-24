import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// `@shared` is the browser's view of the single shared core that the edge function also imports.
// Only src/ui, src/data, src/services and src/lib use the alias; src/core and scripts import the shared
// core by relative path so Node's native type stripping (which ignores aliases) can run them.
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@shared': fileURLToPath(new URL('./supabase/functions/_shared/core', import.meta.url)),
    },
  },
});
