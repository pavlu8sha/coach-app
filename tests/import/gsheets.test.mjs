import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { buildJwt } from '../../scripts/import/gsheets.mjs';
import { reconcile, sumMoney } from '../../scripts/import/reconcile.mjs';

test('JWT: три части, подпись проверяется ключом сервисного аккаунта', () => {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const sa = { client_email: 'import@test.iam.gserviceaccount.com', private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }) };
  const jwt = buildJwt(sa, 1000);
  const [h, c, s] = jwt.split('.');
  assert.equal(JSON.parse(Buffer.from(c, 'base64url').toString()).scope, 'https://www.googleapis.com/auth/spreadsheets.readonly');
  assert.ok(crypto.createVerify('RSA-SHA256').update(`${h}.${c}`).verify(publicKey, Buffer.from(s, 'base64url')));
});

test('сверка: расхождения возвращаются, совпадения — нет', () => {
  const d = reconcile([{ name: 'игроки', sheet: 226, db: 226 }, { name: 'платежи, сумма', sheet: 1000, db: 990 }]);
  assert.equal(d.length, 1);
  assert.equal(d[0].diff, -10);
});

test('сумма из таблицы: «165,00 ₾» и пустые значения', () => {
  assert.equal(sumMoney(['165,00 ₾', '', '130,00 ₾']), 295);
});
