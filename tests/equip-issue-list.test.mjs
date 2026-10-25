// «Экипировка»: выдача по вещам списком — счёт в штуках, фильтр «не выдано / выдано», выбор товара.
// Настоящие функции из скрипта Kit.html; данные — имитация.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = fs.readFileSync(path.join(ROOT, 'Kit.html'), 'utf8');
const JS = SRC.slice(SRC.lastIndexOf('<script>') + 8, SRC.lastIndexOf('</script>'));
function pick(name) {
  const s = JS.indexOf('function ' + name + '(');
  assert.ok(s >= 0, name);
  const eol = JS.indexOf('\n', s), line = JS.slice(s, eol);
  return line.trim().endsWith('}') && !line.trim().endsWith('{') ? line : JS.slice(s, JS.indexOf('\n}', s) + 2);
}
const T = 'Тренировочная форма', G = 'Игровая форма';
const ISS = { 'ORD-1': { [T]: { date: '23.10.2026', who: 'Павел' } }, 'ORD-2': { [T]: { date: '24.10.2026', who: '' }, [G]: { date: '24.10.2026', who: '' } } };
const mkRow = (id, name, ord, kit, qtys, debt = 0) => ({ p: { id, name, group: 'U9-A' }, os: [{ id, ord, kit, qtys, debt }], debt });
const rows = [mkRow('KS-1', 'Alpha A', 'ORD-1', `${T} + ${G}`, [2, 1], 100), mkRow('KS-2', 'Beta B', 'ORD-2', `${T} + ${G}`, [1, 1]), mkRow('KS-3', 'Gamma C', 'ORD-3', T, [1]), mkRow('KS-4', 'Delta D', '', T, [1])];
const ctx = { ISS };
vm.createContext(ctx);
vm.runInContext(['esc', 'money', 'kitsOf', 'qtyOfKit', 'issOf', 'entries', 'issueMatch', 'issueListHtml'].map(pick).join('\n'), ctx);
const text = h => h.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

test('по вещам: у Alpha тренировочная (2 шт.) выдана, игровая нет; штуки считаются с количеством', () => {
  const es = ctx.entries(rows[0], []);
  assert.deepEqual(JSON.parse(JSON.stringify(es.map(e => [e.k, e.q, !!e.x]))), [[T, 2, true], [G, 1, false]]);
});

test('выбор товара: считаются только выбранные вещи', () => {
  assert.equal(ctx.entries(rows[0], [G]).length, 1);
  assert.equal(ctx.entries(rows[2], [G]).length, 0);
});

test('список: итоги по товарам и разделы «Не выдано» / «Выдано»', () => {
  const t = text(ctx.issueListHtml(rows, [], ''));
  assert.match(t, /Тренировочная форма выдано 3 из 5, осталось 2/);      // выдано Alpha 2 + Beta 1; не выдано Gamma 1 и Delta 1
  assert.match(t, /Игровая форма выдано 1 из 2, осталось 1/);
  assert.match(t, /Не выдано \(3 шт\., 3 поз\.\)/);                        // Игровая Alpha; Тренировочная Gamma и Delta
  assert.match(t, /Выдано \(4 шт\., 3 поз\.\)/);
  assert.match(t, /Alpha A.*не выдано, долг 100,0? ₾|Alpha A[^]*долг 100 ₾/);
  assert.match(t, /Delta D[^]*нет ID заказа/);
});

test('фильтр «не выдано» по выбранному товару: тренировочную должны Gamma и Delta', () => {
  const t = text(ctx.issueListHtml(rows.filter(r => ctx.entries(r, [T]).some(e => ctx.issueMatch(e, 'no'))), [T], 'no'));
  assert.match(t, /Gamma C/); assert.match(t, /Delta D/);
  assert.doesNotMatch(t, /Alpha A/); assert.doesNotMatch(t, /Beta B/);
  assert.doesNotMatch(t, /Выдано \(/);
});
