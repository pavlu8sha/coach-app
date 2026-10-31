import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveName } from '../../scripts/import/events-plan.mjs';

test('имя из реестра берётся как есть, даже если для него есть алиас (Orudzhov)', () => {
  const reg = ['Orudzhov Ali', 'Orudzhov Kinan', 'Ivanov Ivan'];
  assert.deepEqual(resolveName('Orudzhov Ali', reg), { name: 'Orudzhov Ali', how: 'exact' });
  assert.deepEqual(resolveName('Orudzhov Kinan', reg), { name: 'Orudzhov Kinan', how: 'exact' });
});

test('алиас работает, когда в реестре записано другое написание', () => {
  const reg = ['Orujov Ali', 'Kurbanov Emin'];
  assert.deepEqual(resolveName('Orudzhov Ali', reg), { name: 'Orujov Ali', how: 'alias' });
  assert.deepEqual(resolveName('Kurbanoiv Emin', reg), { name: 'Kurbanov Emin', how: 'alias' });
});

test('неизвестное имя остаётся ненайденным', () => {
  assert.equal(resolveName('Nobody Here', ['Orudzhov Ali', 'Ivanov Ivan']), null);
});
