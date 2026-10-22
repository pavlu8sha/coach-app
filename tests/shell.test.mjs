// UI-017 (проба): сборка страниц вынесена в pageHtml_, каркас открывается только по ?shell=1.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

function env() {
  const read = name => fs.readFileSync(path.join(ROOT, name + '.html'), 'utf8');
  const out = html => {
    const o = { html, title: '', setTitle(t) { o.title = t; return o; }, addMetaTag() { return o; }, getContent() { return html; } };
    return o;
  };
  const ctx = {
    HtmlService: { createHtmlOutputFromFile: name => out(read(name)), createHtmlOutput: html => out(html) },
    ScriptApp: { getService: () => ({ getUrl: () => 'https://example/exec' }) },
    PropertiesService: { getScriptProperties: () => ({ getProperties: () => ({}) }) },
    CacheService: { getScriptCache: () => ({ get: () => null, put() {} }) },
    Utilities: { sleep() {} },
    Logger: { log() {} },
    JSON, Date,
  };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'NavCode.js'), 'utf8'), ctx, { filename: 'NavCode.js' });
  return ctx;
}

test('обычная страница собирается как раньше: меню, общий слой, без пометки каркаса', () => {
  const ctx = env();
  const r = ctx.doGet({ parameter: { page: 'stats' } });
  assert.equal(r.title, 'Статистика');
  assert.match(r.html, /id="ksnav"/);
  assert.match(r.html, /window\.ksEmpty/);
  assert.doesNotMatch(r.html, /<html[^>]*data-embed/);
  assert.doesNotMatch(r.html, /__URL__|__PAGE__/);
});

test('без параметра открываются «Отметки», как раньше', () => {
  const ctx = env();
  const r = ctx.doGet({ parameter: {} });
  assert.equal(r.title, 'Посещаемость');
});

test('?shell=1 открывает каркас: все разделы, стартовый раздел и подсветка меню', () => {
  const ctx = env();
  const r = ctx.doGet({ parameter: { shell: '1', page: 'funnel' } });
  assert.match(r.html, /window\.KS_SHELL=1/);
  assert.match(r.html, /id="kshost"/);
  assert.match(r.html, /START='funnel',URL='https:\/\/example\/exec'/);
  const pages = JSON.parse(/var PAGES=(\[[^\]]*\])/.exec(r.html)[1]);
  for (const p of ['att', 'admin', 'cash', 'pay', 'debt', 'ind', 'extra', 'equip', 'games', 'camp', 'stats', 'funnel', 'accounting', 'settings']) {
    assert.ok(pages.includes(p), 'в каркасе есть ' + p);
  }
  const navof = JSON.parse(/NAVOF=(\{[^}]*\})/.exec(r.html)[1]);
  assert.equal(navof.debt, 'pay', '«Должники» подсвечивают пункт «Оплаты»');
  assert.equal(navof.extra, 'ind', '«Дополнительные» подсвечивают «Индивидуальные»');
  assert.match(ctx.doGet({ parameter: { shell: '1' } }).html, /START='att'/, 'без раздела — «Отметки»');
  assert.match(ctx.doGet({ parameter: { shell: '1', page: 'nope' } }).html, /START='att'/);
});

test('appPageHtml отдаёт разделы каркаса с пометкой data-embed и отказывает в неизвестных', () => {
  const ctx = env();
  const html = ctx.appPageHtml('stats');
  assert.match(html, /<html[^>]*data-embed="1"/);
  assert.match(html, /id="ksnav"/, 'меню остаётся в разметке (скрыто стилями) — для тостов и проверки роли');
  assert.match(ctx.appPageHtml('att'), /<html[^>]*data-embed="1"/, '«Отметки» тоже открываются в каркасе');
  assert.match(ctx.appPageHtml('debt'), /class="ks-sub"/, 'подразделы «Оплат» на месте');
  assert.throws(() => ctx.appPageHtml('nope'), /не перенесён в каркас/);
  assert.throws(() => ctx.appPageHtml(''), /не перенесён в каркас/);
});
