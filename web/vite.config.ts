import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// Тесты экранов (npm test): jsdom, вместо Supabase подставляется заглушка в памяти (src/test/fakeSupabase.ts).
export default defineConfig({
  plugins: [react()],
  // Две страницы: приложение (index.html) и публичная страница сбора /camp/<имя> (camp.html, Issue #470)
  build: { rollupOptions: { input: { main: fileURLToPath(new URL('./index.html', import.meta.url)), camp: fileURLToPath(new URL('./camp.html', import.meta.url)) } } },
  // Только в тестах: сверка начальных значений миграции с lib/clubInfo читает файл из db/migrations (за пределами web).
  server: process.env.VITEST ? { fs: { allow: ['..'] } } : undefined,
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
    alias: [{ find: /^(\.|\.\.)\/(lib\/)?supabase$/, replacement: new URL('./src/test/fakeSupabase.ts', import.meta.url).pathname }],
  },
});
