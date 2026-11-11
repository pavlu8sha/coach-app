// #238 PR 2b: старое поле player_guardians.consent_revoked_at больше не условие доступа (условия приёмки С2, С3).
// С2: миграции после 0173 не возвращают его в функции (иначе правка любой функции вернёт старое правило доступа).
// С3: в клиенте оно встречается только в 8 известных выборках «моих детей»; их заменит шлюз согласия (PR 3).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

test('миграции после 0173 не содержат consent_revoked_at', () => {
  const dir = path.join(ROOT, 'db/migrations');
  const bad = fs.readdirSync(dir)
    .filter(f => /^\d{4}_.*\.sql$/.test(f) && Number(f.slice(0, 4)) > 173)
    .filter(f => fs.readFileSync(path.join(dir, f), 'utf8').includes('consent_revoked_at'));
  assert.deepEqual(bad, [], `используйте parent_access_ok(user_id, player_id) вместо consent_revoked_at: ${bad.join(', ')}`);
});

// Известные места (файл: число вхождений). Список только сокращается.
const CLIENT_ALLOWED = {
  'web/src/App.tsx': 1,
  'web/src/screens/ParentCalendar.tsx': 1,
  'web/src/screens/Home.tsx': 1,
  'web/src/screens/Schedule.tsx': 1,
  'web/src/screens/Matches.tsx': 1,
  'web/src/screens/Payments.tsx': 1,
  'web/src/screens/Booking.tsx': 1,
  'web/src/screens/MyKids.tsx': 1,
};

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(e.name) && !/\.test\.(ts|tsx)$/.test(e.name)) out.push(p);
  }
  return out;
}

test('клиент: consent_revoked_at только в известных местах', () => {
  const found = {};
  for (const f of walk(path.join(ROOT, 'web/src'))) {
    const n = (fs.readFileSync(f, 'utf8').match(/consent_revoked_at/g) ?? []).length;
    if (n) found[path.relative(ROOT, f).split(path.sep).join('/')] = n;
  }
  const extra = Object.entries(found).filter(([f, n]) => n > (CLIENT_ALLOWED[f] ?? 0)).map(([f, n]) => `${f}: ${n}`);
  assert.deepEqual(extra, [], 'новое условие доступа по consent_revoked_at в клиенте');
});
