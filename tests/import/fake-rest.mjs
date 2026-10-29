// Подставной PostgREST для проверки скриптов импорта без настоящего Supabase: пишет все запросы, отвечает по таблицам.
// Как у настоящего сервера, отдаёт не больше 1000 строк за запрос (max_rows), поэтому выборки без страниц здесь тоже обрезаются.
import http from 'node:http';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const MAX_ROWS = 1000;

// tables: { имя: строки }. Поддержаны GET с limit/offset; запись (POST/PATCH/DELETE) только записывается.
export async function startFake(tables = {}) {
  const calls = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      const url = new URL(req.url, 'http://x');
      const table = url.pathname.replace('/rest/v1/', '');
      calls.push({ method: req.method, table, query: url.search, body: body ? JSON.parse(body) : null });
      res.setHeader('content-type', 'application/json');
      if (req.method !== 'GET') { res.statusCode = 201; res.end(); return; }
      const rows = tables[table] ?? [];
      const off = Number(url.searchParams.get('offset') || 0);
      const lim = Math.min(Number(url.searchParams.get('limit') || MAX_ROWS), MAX_ROWS);
      res.end(JSON.stringify(rows.slice(off, off + lim)));
    });
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${server.address().port}`;
  return { url, calls, close: () => new Promise(r => server.close(r)), writes: () => calls.filter(c => c.method !== 'GET') };
}

// Запуск скрипта импорта дочерним процессом против подставного сервера.
export function runScript(script, args, url, extraEnv = {}) {
  const env = { PATH: process.env.PATH, SUPABASE_URL: url, SUPABASE_SERVICE_KEY: 'test-key', CLUB_ID: 'club-1', ...extraEnv };
  return new Promise(resolve => {
    const p = spawn(process.execPath, [path.join(ROOT, 'scripts/import', script), ...args], { env, cwd: ROOT });
    let stdout = '', stderr = '';
    p.stdout.on('data', d => stdout += d); p.stderr.on('data', d => stderr += d);
    p.on('close', code => resolve({ code, stdout, stderr }));
  });
}
