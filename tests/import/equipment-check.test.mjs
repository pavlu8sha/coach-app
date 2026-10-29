import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkEquipment } from '../../scripts/import/equipment-check.mjs';

const reg = [{ external_id: 'KS-1', full_name: 'Makhashvili Demetre' }, { external_id: 'KS-2', full_name: 'Gongadze Sergey' }];
const o = (ext_id, player_ext, name, extra = {}) => ({ ext_id, player_ext, name, src_row: 5, inscription: 'X', number: '2', total: 470, paid: 200, kit_text: 'Форма', ...extra });

test('заказ с ФИ одного игрока и ID другого — предупреждение; порядок слов в ФИ не важен', () => {
  const r = checkEquipment({ season: [o('ORD-1', 'KS-2', 'Makhashvili Demetre'), o('ORD-2', 'KS-2', 'Sergey Gongadze')], registry: reg });
  assert.deepEqual(r.warnings.map(w => w.ord), ['ORD-1']);
  assert.equal(r.errors.length, 0);
});

test('дубль ID заказа, пустой ID и неизвестный игрок — ошибки, блокирующие запись', () => {
  const r = checkEquipment({ season: [o('ORD-1', 'KS-1', 'Makhashvili Demetre'), o('ORD-1', 'KS-1', 'Makhashvili Demetre'), o('', 'KS-1', ''), o('ORD-3', 'KS-9', '')], registry: reg });
  assert.equal(r.errors.length, 3);
});

test('сверка с эталоном: смена игрока и суммы видна по ID заказа, а не по номеру строки', () => {
  const base = [o('ORD-1', 'KS-1', 'Makhashvili Demetre'), o('ORD-2', 'KS-2', 'Gongadze Sergey')];
  const cur = [o('ORD-1', 'KS-2', 'Gongadze Sergey', { paid: 300 }), o('ORD-2', 'KS-2', 'Gongadze Sergey')];
  const r = checkEquipment({ season: cur, registry: reg, baseline: base });
  assert.deepEqual(r.diffs.map(d => [d.ord, d.field]), [['ORD-1', 'player_ext'], ['ORD-1', 'paid']]);
});
