// Экран «Экипировка» (Kit.html): блок выдачи по вещам, подтверждение с предупреждением о долге, отмена выдачи.
// Настоящие функции из скрипта Kit.html; google.script.run, ksConfirm, localStorage — имитация.
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

function env(ISS, orders, stored = {}) {
  const calls = [], confirms = [], ls = Object.assign({}, stored);
  const ctx = {
    pin: '9', P: [{ id: 'KS-1', name: 'Alpha A' }], O: orders, UNL: [], ISS, flash: '', loads: 0,
    localStorage: { getItem: k => (k in ls ? ls[k] : null), setItem: (k, v) => { ls[k] = String(v); } },
    ksConfirm: o => confirms.push(o), ksMoney: n => n + ' ₾', ksDateIfNotToday: d => d,
    run: (fn, args, ok, fail) => calls.push({ fn, args, ok, fail }),
    load: () => { ctx.loads++; },
  };
  vm.createContext(ctx);
  vm.runInContext(['esc', 'money', 'today', 'kitsOf', 'orderByRow', 'playerName', 'issOf', 'issState', 'lastWho', 'issueHtml', 'issueOrder', 'unissue'].map(pick).join('\n'), ctx);
  return { ctx, calls, confirms, ls };
}
const J = x => JSON.parse(JSON.stringify(x));
const ORD = { row: 7, id: 'KS-1', oname: 'Alpha A', ord: 'ORD-0001', kit: 'Тренировочная форма + Игровая форма', sum: 300, paid: 100, debt: 200 };

// Поля формы выдачи внутри заказа (вместо DOM)
function form(checked, dt, who) {
  const im = { textContent: '' };
  return { im, ord: { querySelector: s => ({ '.im': im, '.idt': { value: dt }, '.iwho': { value: who } })[s],
    querySelectorAll: () => checked.map(v => ({ value: v })) } };
}

test('состояние выдачи заказа: не выдано / частично / выдано; без ID заказа — не трогаем', () => {
  const e = env({ 'ORD-0001': { 'Игровая форма': { date: '23.10.2026', who: 'Павел' } } }, [ORD]);
  assert.equal(e.ctx.issState(ORD), 'part');
  assert.equal(e.ctx.issState(Object.assign({}, ORD, { ord: 'ORD-0002' })), 'none');
  assert.equal(e.ctx.issState(Object.assign({}, ORD, { kit: 'Игровая форма' })), 'all');
  const h = e.ctx.issueHtml(ORD);
  assert.match(h, /выдано частично/);
  assert.match(h, /Игровая форма<span class="sub"> — выдано 23\.10\.2026, Павел/);
  assert.match(h, /Тренировочная форма<span class="sub"> — не выдано/);
  assert.match(h, /class="lnk iun" data-row="7" data-k="Игровая форма"/);
  assert.match(h, /value="Тренировочная форма" checked/);                     // в форме — только невыданное
  assert.doesNotMatch(h, /class="ich" value="Игровая форма"/);
  assert.match(e.ctx.issueHtml(Object.assign({}, ORD, { ord: '' })), /нет ID заказа/);
});

test('всё выдано — кнопки «Выдать» нет; «Кто выдал» подставляется с этого устройства', () => {
  const all = { 'ORD-0001': { 'Игровая форма': { date: '1', who: '' }, 'Тренировочная форма': { date: '2', who: '' } } };
  assert.doesNotMatch(env(all, [ORD]).ctx.issueHtml(ORD), /iop/);
  assert.match(env({}, [ORD], { kitWho: 'Гио' }).ctx.issueHtml(ORD), /class="iwho" value="Гио"/);
});

test('выдача с долгом: подтверждение предупреждает о долге, отправляется одна команда, имя запоминается', () => {
  const e = env({}, [ORD]);
  const f = form(['Тренировочная форма', 'Игровая форма'], '2026-10-23', 'Павел');
  e.ctx.issueOrder({ dataset: { row: '7' } }, f.ord);
  assert.equal(e.confirms.length, 1);
  assert.match(e.confirms[0].warn, /не оплачено 200 ₾/);
  assert.equal(e.ls.kitWho, 'Павел');
  e.confirms[0].run(() => {}, () => {});
  assert.deepEqual(J(e.calls.map(c => [c.fn, ...c.args.slice(1)])), [['appEquipIssue', 7, ['Тренировочная форма', 'Игровая форма'], true, '2026-10-23', 'Павел']]);
  e.calls[0].ok({ ok: true, status: 'Да' });
  assert.deepEqual([e.ctx.flash, e.ctx.loads], ['Заказ выдан полностью. ', 1]);
});

test('оплаченный заказ — без предупреждения; ничего не отмечено или нет даты — запрос не отправляется', () => {
  const paid = Object.assign({}, ORD, { paid: 300, debt: 0 });
  const e = env({}, [paid]);
  e.ctx.issueOrder({ dataset: { row: '7' } }, form(['Игровая форма'], '2026-10-23', '').ord);
  assert.equal(e.confirms[0].warn, '');
  const a = form([], '2026-10-23', ''); e.ctx.issueOrder({ dataset: { row: '7' } }, a.ord);
  const b = form(['Игровая форма'], '', ''); e.ctx.issueOrder({ dataset: { row: '7' } }, b.ord);
  assert.deepEqual([a.im.textContent, b.im.textContent, e.confirms.length], ['Отметьте, что выдаёте', 'Укажите дату выдачи', 1]);
});

test('отмена выдачи: подтверждение показывает, что было отмечено, отправляет снятие одной вещи', () => {
  const e = env({ 'ORD-0001': { 'Игровая форма': { date: '23.10.2026', who: 'Павел' } } }, [ORD]);
  e.ctx.unissue({ dataset: { row: '7', k: 'Игровая форма' } });
  assert.deepEqual(J(e.confirms[0].rows[2]), ['Было отмечено', '23.10.2026, Павел']);
  e.confirms[0].run(() => {}, () => {});
  assert.deepEqual(J([e.calls[0].fn, ...e.calls[0].args.slice(1)]), ['appEquipIssue', 7, ['Игровая форма'], false]);
});

test('фильтр «Выдано не всё» и подпись игрока подключены', () => {
  assert.match(SRC, /<option value="noiss">Выдано не всё<\/option>/);
  assert.match(JS, /noiss:function\(r\)\{return r\.os\.some\(function\(o\)\{return issState\(o\)!=='all'\}\)\}/);
  assert.match(JS, /' · выдано частично'/);
});
