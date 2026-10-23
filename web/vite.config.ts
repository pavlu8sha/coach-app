import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// Тесты экранов (npm test): jsdom, вместо Supabase подставляется заглушка в памяти (src/test/fakeSupabase.ts).
export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
    alias: [{ find: /^(\.|\.\.)\/(lib\/)?supabase$/, replacement: new URL('./src/test/fakeSupabase.ts', import.meta.url).pathname }],
  },
});
