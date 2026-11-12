-- pgTAP (REL-02, миграция 0184): очередь уведомлений не зависает.
-- Условия приёмки: docs/NOTIFICATIONS_QUEUE_ACCEPTANCE.md (Q1-Q9). Только синтетические данные, реальных отправок нет.
begin;
create extension if not exists pgtap;
select plan(47);

create function tx(n int) returns uuid language sql immutable as $$ select ('00000000-0000-0000-0000-' || lpad(to_hex(n), 12, '0'))::uuid $$;
insert into clubs (id, name) values (tx(1), 'Клуб');
insert into users (id, telegram_id, display_name, is_admin) values
  (tx(161), 8101, 'Админ', true),
  (tx(162), 8102, 'Родитель', false);

create or replace function as_user(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
end $$;
create or replace function as_service() returns void language plpgsql as $$
begin
  perform set_config('role', 'service_role', true);
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
end $$;
-- строка очереди (общая, без player_ids: проверка согласия её не касается), метка в тексте
create function q(lbl text, st text default 'pending', att int default 0, claimed interval default null, err text default null) returns uuid language sql as $$
  insert into notifications (user_id, kind, text, state, attempts, claimed_at, last_error, sent_at)
  values (tx(161), 'syn', lbl, st, att, case when claimed is null then null else now() - claimed end, err, case when st = 'sent' then now() end)
  returning id
$$;
-- claim под служебной ролью: отсортированные метки выданных строк
create function cl(n int default 50) returns text[] language plpgsql as $$
declare r text[];
begin
  perform as_service();
  select coalesce(array_agg(c.text order by c.text), '{}') into r from claim_notifications(n) c where c.text like 'Q%';
  reset role;
  return r;
end $$;
create function rel(ids uuid[]) returns int language plpgsql as $$
declare r int;
begin
  perform as_service();
  r := release_notifications(ids);
  reset role;
  return r;
end $$;
create function row_of(lbl text) returns notifications language sql as $$ select * from notifications where text = lbl $$;
-- «прошло 5 минут» для выданных строк: закрепление истекло
create function age_claims(lbl text) returns void language sql as $$
  update notifications set claimed_at = now() - interval '5 minutes' where text like lbl and claimed_at is not null
$$;

-- ===== Q1-Q3: зависшие строки закрываются при выдаче =====
select q('Q1a', 'pending', 3, interval '5 minutes', 'timeout');
select q('Q1b', 'pending', 3, null, null);
select q('Q2', 'pending', 3, interval '30 seconds', null);
select q('Q3a', 'pending', 2, interval '5 minutes', '500 oops');
select q('Q3s', 'sent', 3, interval '5 minutes', null);
select q('Q3f', 'failed', 3, interval '5 minutes', 'x');
select q('Q3k', 'skipped', 3, interval '5 minutes', 'consent');
insert into notifications (user_id, kind, text, state, attempts, sent_at) values (tx(161), 'syn', 'Q6old', 'sent', 1, now() - interval '31 days');

select is(cl(), array['Q3a'], 'Q1-Q3. выдана только строка с attempts < 3; зависшие и выданные недавно не выдаются');
select is((row_of('Q1a')).state, 'failed', 'Q1. выданная 3 раза без ответа (закрепление истекло) стала failed');
select is((row_of('Q1a')).last_error, 'stalled: timeout', 'Q1. причина stalled, прежняя ошибка сохранена');
select is((row_of('Q1a')).attempts, 3, 'Q1. число попыток не меняется');
select is((row_of('Q1b')).state, 'failed', 'Q1. attempts=3 без закрепления тоже закрывается');
select is((row_of('Q1b')).last_error, 'stalled', 'Q1. без прежней ошибки причина ровно stalled');
select is((row_of('Q2')).state, 'pending', 'Q2. выданная меньше 2 минут назад не трогается (finish ещё может прийти)');
select ok((row_of('Q2')).last_error is null, 'Q2. причина не записана');
select is((row_of('Q3a')).state, 'pending', 'Q3. attempts < 3: строка выдана, остаётся pending');
select is((row_of('Q3a')).attempts, 3, 'Q3. попытка учтена (3)');
select is((row_of('Q3s')).state || '/' || coalesce((row_of('Q3s')).last_error, ''), 'sent/', 'Q3. sent не меняется');
select is((row_of('Q3f')).state || '/' || (row_of('Q3f')).last_error, 'failed/x', 'Q3. failed не меняется');
select is((row_of('Q3k')).state || '/' || (row_of('Q3k')).last_error, 'skipped/consent', 'Q3. skipped не меняется');
select is((select count(*)::int from notifications where text = 'Q6old'), 0, 'Q6. отправленные старше 30 дней по-прежнему удаляются');

-- Q2: когда закрепление истекло, недавно выданная строка тоже закрывается
select age_claims('Q2');
select is(cl(), '{}'::text[], 'Q2. после истечения закрепления строка не выдаётся');
select is((row_of('Q2')).state || '/' || (row_of('Q2')).last_error, 'failed/stalled', 'Q2. и закрыта как stalled');

-- Q3a: последняя (третья) попытка: finish с ошибкой закрывает её, как раньше
select as_service();
select finish_notification((row_of('Q3a')).id, false, '500 again');
reset role;
select is((row_of('Q3a')).state || '/' || (row_of('Q3a')).last_error, 'failed/500 again', 'Q6. finish на третьей попытке закрывает строку, как раньше');

-- ===== Полный цикл: три выдачи без finish (падение функции), четвёртой нет =====
select q('QL');
select is(cl(), array['QL'], 'Цикл. выдача 1');
select age_claims('QL');
select is(cl(), array['QL'], 'Цикл. выдача 2 после истечения закрепления');
select age_claims('QL');
select is(cl(), array['QL'], 'Цикл. выдача 3');
select is((row_of('QL')).state || '/' || (row_of('QL')).attempts, 'pending/3', 'Цикл. после третьей выдачи строка ждёт finish');
select age_claims('QL');
select is(cl(), '{}'::text[], 'Цикл. четвёртой выдачи нет');
select is((row_of('QL')).state || '/' || (row_of('QL')).last_error, 'failed/stalled', 'Цикл. строка не висит в pending, а закрыта как stalled');

-- ===== Q4: release_notifications =====
select q('QR');
select q('QRother');
select is(cl(), array['QR', 'QRother'], 'Q4. обе строки выданы');
select is(rel(array[(row_of('QR')).id]), 1, 'Q4. возвращена одна строка');
select is((row_of('QR')).attempts, 0, 'Q4. попытка не засчитана');
select ok((row_of('QR')).claimed_at is null, 'Q4. закрепление снято');
select is((row_of('QRother')).attempts || '/' || ((row_of('QRother')).claimed_at is not null)::text, '1/true', 'Q4. строка вне списка не тронута');
select is(cl(), array['QR'], 'Q4. возвращённая строка выдаётся сразу, без ожидания 2 минут');
select is(rel(array[(row_of('QR')).id, (row_of('QR')).id]), 1, 'Q4. повтор id в списке не уменьшает дважды');
select is(rel(array[(row_of('QR')).id]), 0, 'Q4. повторный вызов ничего не меняет');
select is((row_of('QR')).attempts, 0, 'Q4. attempts после повторов = 0');
select as_service();
select finish_notification((row_of('QRother')).id, true, null);
reset role;
select is(rel(array[(row_of('QRother')).id, (row_of('Q1a')).id, (row_of('Q3k')).id]), 0, 'Q4. sent, failed, skipped не возвращаются');
select is((row_of('QRother')).state || '/' || (row_of('QRother')).attempts, 'sent/1', 'Q4. отправленная строка не изменилась');
update notifications set attempts = 0, claimed_at = now() where text = 'QR';
select is(rel(array[(row_of('QR')).id]), 1, 'Q4. attempts=0 при закреплении: строка возвращена');
select is((row_of('QR')).attempts, 0, 'Q4. attempts не уходит ниже 0');
select is(rel(null), 0, 'Q4. null: ничего');
select is(rel('{}'), 0, 'Q4. пустой список: ничего');

-- ===== Q5 на уровне базы: Telegram пять раз подряд отвечает 429 на первую строку пачки =====
select q('QA');
select q('QB');
do $$
declare i int; a uuid := (select id from notifications where text = 'QA'); b uuid := (select id from notifications where text = 'QB');
begin
  for i in 1..5 loop
    perform as_service();
    perform claim_notifications(50);
    perform finish_notification(a, false, '429 Too Many Requests');  -- строка с 429
    perform release_notifications(array[b]);                        -- остальные возвращаются
    reset role;
    update notifications set claimed_at = now() - interval '5 minutes' where id = a and state = 'pending';
  end loop;
end $$;
select is((row_of('QA')).state, 'failed', 'Q5. строка, на которой Telegram отвечает 429, после трёх попыток закрыта finish');
select is((row_of('QB')).state || '/' || (row_of('QB')).attempts, 'pending/0', 'Q5. остальные строки пачки не теряют попытки и не зависают');
select is(cl(), array['QB'], 'Q5. и уходят следующим запуском');

-- ===== Q7: права =====
select is(has_function_privilege('anon', 'release_notifications(uuid[])', 'execute'), false, 'Q7. anon не вызывает release_notifications');
select is(has_function_privilege('authenticated', 'release_notifications(uuid[])', 'execute'), false, 'Q7. authenticated не вызывает release_notifications');
select is(has_function_privilege('service_role', 'release_notifications(uuid[])', 'execute'), true, 'Q7. service_role вызывает release_notifications');
select as_user(tx(162));
select throws_ok($$select release_notifications(array[gen_random_uuid()])$$, '42501', null, 'Q7. родитель не может вернуть строки очереди');
select throws_ok($$select claim_notifications(10)$$, '42501', null, 'Q7. родитель не забирает уведомления');
reset role;
select is((select p.prosecdef and p.proconfig @> array['search_path=public'] from pg_proc p where p.oid = 'release_notifications(uuid[])'::regprocedure), true,
          'Q7. release_notifications: security definer с закреплённым search_path');

select * from finish();
rollback;
