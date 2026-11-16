import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { settingDef } from './clubSettings';

// #652 этап 2a (А5): значения по умолчанию серверного расчёта скидки (миграция 0205, eq_bundle_setting) совпадают с clubSettings.ts.
const sql = readFileSync(resolve(process.cwd(), '../db/migrations/0205_eq_bundle_model.sql'), 'utf-8');
const sqlDefault = (key: string) => {
  const m = sql.match(new RegExp(`when '${key.replace('.', '\\.')}' then '([^']*)'`));
  return m ? m[1] : null;
};

describe('настройки скидки за комплект: SQL и клиент', () => {
  for (const key of ['equip.fullPrice', 'equip.discNeedOwn', 'equip.discNeedAll', 'equip.discPct', 'equip.discRound']) {
    it(`значение по умолчанию ${key} совпадает`, () => {
      expect(settingDef(key)?.def).toBeTruthy();
      expect(sqlDefault(key)).toBe(settingDef(key)?.def);
    });
  }
});
