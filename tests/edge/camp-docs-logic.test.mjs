import test from 'node:test';
import assert from 'node:assert/strict';
import { checkPdf, isUuid, MAX_BYTES, parseUpload, rpcFailure, safePath } from '../../supabase/functions/camp-docs/docs-logic.js';

const enc = (s) => new TextEncoder().encode(s);
const CAMP = '00000000-0000-0000-0000-0000000000ca';
const DOC = '11111111-1111-1111-1111-111111111111';

test('PDF принимается по содержимому', () => {
  assert.deepEqual(checkPdf(enc('%PDF-1.7\n1 0 obj\nendobj\n%%EOF\n')), { ok: true, reason: null });
});

test('пустой файл, не PDF и PDF без конца отклоняются', () => {
  assert.equal(checkPdf(new Uint8Array()).reason, 'empty');
  assert.equal(checkPdf('строка').reason, 'empty');
  assert.equal(checkPdf(enc('<html><script>alert(1)</script>%%EOF')).reason, 'not_pdf');
  assert.equal(checkPdf(enc('MZ\u0090%PDF-1.7 %%EOF')).reason, 'not_pdf');
  assert.equal(checkPdf(enc('%PDF-1.7 обрезан')).reason, 'not_pdf');
});

test('файл больше 10 МБ отклоняется, ровно 10 МБ проходит', () => {
  const big = new Uint8Array(MAX_BYTES + 1);
  big.set(enc('%PDF-'));
  assert.equal(checkPdf(big).reason, 'too_large');
  const edge = new Uint8Array(MAX_BYTES);
  edge.set(enc('%PDF-'));
  edge.set(enc('%%EOF'), MAX_BYTES - 5);
  assert.equal(checkPdf(edge).ok, true);
});

test('параметры загрузки', () => {
  const q = (s) => new URLSearchParams(s);
  assert.deepEqual(parseUpload(q(`camp=${CAMP}&title=%20Программа%20`)), { ok: true, camp: CAMP, title: 'Программа', replaces: null });
  assert.equal(parseUpload(q(`camp=${CAMP}&title=П&replaces=${DOC}`)).replaces, DOC);
  assert.equal(parseUpload(q('camp=../x&title=П')).reason, 'bad_request');
  assert.equal(parseUpload(q(`camp=${CAMP}&title=П&replaces=1`)).reason, 'bad_request');
  assert.equal(parseUpload(q(`camp=${CAMP}&title=%20`)).reason, 'bad_title');
  assert.equal(parseUpload(q(`camp=${CAMP}&title=${'я'.repeat(121)}`)).reason, 'bad_title');
});

test('путь в хранилище только вида <сбор>/<документ>.pdf', () => {
  assert.equal(safePath(`${CAMP}/${DOC}.pdf`), true);
  for (const p of [null, '', `${CAMP}/../${DOC}.pdf`, `${CAMP}/${DOC}.exe`, `/${CAMP}/${DOC}.pdf`, `${CAMP}/x/${DOC}.pdf`, `other/${DOC}.pdf`]) {
    assert.equal(safePath(p), false, String(p));
  }
  assert.equal(isUuid(DOC), true);
  assert.equal(isUuid(`${DOC}'`), false);
});

test('ошибки базы: наружу только известные тексты', () => {
  assert.deepEqual(rpcFailure({ code: '42501', message: 'forbidden' }), { status: 403, error: 'forbidden' });
  assert.deepEqual(rpcFailure({ code: '42501', message: 'permission denied for function camp_document_path' }), { status: 403, error: 'forbidden' });
  assert.deepEqual(rpcFailure({ code: '22023', message: 'too many documents' }), { status: 400, error: 'too many documents' });
  assert.deepEqual(rpcFailure({ code: '22023', message: 'секрет из базы' }), { status: 400, error: 'bad_request' });
  assert.deepEqual(rpcFailure({ code: 'P0002', message: 'camp not found' }), { status: 404, error: 'camp not found' });
  assert.deepEqual(rpcFailure({ code: 'XX000', message: 'relation "x" does not exist' }), { status: 500, error: 'internal' });
});
