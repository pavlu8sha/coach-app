import test from 'node:test';
import assert from 'node:assert/strict';
import { matchDbSessions } from '../../scripts/import/individual-plan.mjs';

test('занятие с временем в идентификаторе из приложения находится по дате и виду', () => {
  const m = matchDbSessions(
    ['IND-2026-10-24', 'IND-2026-10-25', 'IND-2026-10-25-GK', 'IND-2026-11-02'],
    ['IND-2026-10-24-1900', 'IND-2026-10-25-1800', 'IND-2026-10-25-1900-GK', 'IND-2026-09-01']);
  assert.equal(m.get('IND-2026-10-24'), 'IND-2026-10-24-1900');
  assert.equal(m.get('IND-2026-10-25'), 'IND-2026-10-25-1800');
  assert.equal(m.get('IND-2026-10-25-GK'), 'IND-2026-10-25-1900-GK');
  assert.equal(m.get('IND-2026-11-02'), 'IND-2026-11-02'); // в базе нет: будет создано
});

test('точное совпадение важнее, неоднозначность не угадывается', () => {
  const m = matchDbSessions(['IND-2026-10-24', 'IND-2026-10-31'], ['IND-2026-10-24', 'IND-2026-10-24-1900', 'IND-2026-10-31-1800', 'IND-2026-10-31-1900']);
  assert.equal(m.get('IND-2026-10-24'), 'IND-2026-10-24');
  assert.equal(m.get('IND-2026-10-31'), 'IND-2026-10-31'); // два кандидата: не выбираем
});

test('вратарское занятие не путается с обычным той же даты', () => {
  const m = matchDbSessions(['IND-2026-10-25'], ['IND-2026-10-25-1900-GK']);
  assert.equal(m.get('IND-2026-10-25'), 'IND-2026-10-25');
});
