// #652 этап 2a (А5): значения по умолчанию серверного расчёта скидки (0205, eq_bundle_setting) совпадают с web/src/lib/clubSettings.ts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const sql = fs.readFileSync(path.join(ROOT, 'db/migrations/0205_eq_bundle_model.sql'), 'utf8');
const ts = fs.readFileSync(path.join(ROOT, 'web/src/lib/clubSettings.ts'), 'utf8');
for (const key of ['equip.fullPrice', 'equip.discNeedOwn', 'equip.discNeedAll', 'equip.discPct', 'equip.discRound']) {
  test(`значение по умолчанию ${key} совпадает`, () => {
    const t = ts.match(new RegExp(`key: '${key.replace('.', '\\.')}'.*?def: '([^']*)'`));
    const s = sql.match(new RegExp(`when '${key.replace('.', '\\.')}' then '([^']*)'`));
    assert.ok(t && t[1], 'в clubSettings.ts есть значение');
    assert.equal(s && s[1], t[1]);
  });
}
