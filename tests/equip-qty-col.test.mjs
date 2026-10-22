// Количество и локация — разные колонки: локация (M) перезаписывает свой столбец при каждом сохранении
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

test('количество пишется в O (15), а не в M, где локация', () => {
  const equip = read('Equip.js'), loc = read('EquipLocation.js');
  assert.match(equip, /var EQ_QTY_COL = 15;/);
  assert.match(loc, /var EQ_LOC_COL = 13;/);
  assert.notEqual(15, 13);
  // в коде количества не осталось записи в колонку 13
  for (const f of ['EquipView.js', 'EquipLinks.js']) {
    assert.doesNotMatch(read(f), /getRange\([^)]*,\s*13\)/, f + ': запись в колонку M (локация)');
  }
});
