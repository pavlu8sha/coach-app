-- pgTAP: очередь уведомлений, триггеры, отключение, служебные функции.
begin;
create extension if not exists pgtap;
select plan(22);

insert into clubs (id, name) values ('00000000-0000-0000-0000-00000000c001', 'Клуб');
insert into users (id, telegram_id, display_name, is_admin) values
  ('00000000-0000-0000-0000-0000000000a1', 5101, 'Админ', true),
  ('00000000-0000-0000-0000-0000000000b1', 5102, 'Родитель А', false),
  ('00000000-0000-0000-0000-0000000000b2', 5103, 'Родитель Б (без уведомлений)', false);
insert into groups (id, club_id, name) values ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-00000000c001', 'U9');
insert into players (id, club_id, group_id, full_name) values
  ('00000000-0000-0000-0000-00000000d001', '00000000-0000-0000-0000-00000000c001', '00000000-0000-0000-0000-0000000000e1', 'Иванов Пётр'),
  ('00000000-0000-0000-0000-00000000d002', '00000000-0000-0000-0000-00000000c001', '00000000-0000-0000-0000-0000000000e1', 'Сидоров Ян');
insert into consent_versions (version) values ('draft-2026-10') on conflict do nothing;

create or replace function as_user(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
end $$;

-- Родитель подаёт запрос: уведомление администратору
select as_user('00000000-0000-0000-0000-0000000000b1');
select request_link('00000000-0000-0000-0000-00000000d001', 'draft-2026-10');
reset role;
select is((select count(*)::int from notifications where kind = 'link_request'), 1, 'новый запрос: одно уведомление');
select is((select user_id from notifications where kind = 'link_request'), '00000000-0000-0000-0000-0000000000a1'::uuid, 'уведомление уходит администратору');
select ok((select text from notifications where kind = 'link_request') like '%Иванов Пётр (U9)%', 'в тексте имя ребёнка и группа');

-- Администратор подтверждает: уведомление родителю
select as_user('00000000-0000-0000-0000-0000000000a1');
select decide_link((select id from link_requests limit 1), true);
reset role;
select is((select count(*)::int from notifications where kind = 'link_decided' and user_id = '00000000-0000-0000-0000-0000000000b1'), 1, 'решение: уведомление родителю');
select ok((select text from notifications where kind = 'link_decided') like 'Запрос подтверждён%', 'текст подтверждения');

-- Родитель с отключёнными уведомлениями
select as_user('00000000-0000-0000-0000-0000000000b2');
select set_notifications(false);
select request_link('00000000-0000-0000-0000-00000000d002', 'draft-2026-10');
reset role;
select is((select count(*)::int from notifications where kind = 'link_request'), 2, 'администратору уведомление приходит независимо от настроек родителя');
select is((select notifications_enabled from users where id = '00000000-0000-0000-0000-0000000000b2'), false, 'настройка сохранена');
select as_user('00000000-0000-0000-0000-0000000000a1');
select decide_link((select id from link_requests where user_id = '00000000-0000-0000-0000-0000000000b2'), false);
reset role;
select is((select count(*)::int from notifications where user_id = '00000000-0000-0000-0000-0000000000b2'), 0, 'отключившему уведомления ничего не ставится в очередь');

-- Прямой доступ закрыт
select as_user('00000000-0000-0000-0000-0000000000b1');
select throws_ok($$select * from notifications$$, '42501', null, 'родитель не читает очередь уведомлений');
select throws_ok($$select claim_notifications(10)$$, '42501', null, 'родитель не забирает уведомления');
select throws_ok($$select finish_notification(gen_random_uuid(), true, null)$$, '42501', null, 'родитель не отмечает отправку');
select throws_ok($$select enqueue_notification('00000000-0000-0000-0000-0000000000a1', 'x', 'спам')$$, '42501', null, 'родитель не ставит сообщения в очередь');
select lives_ok($$select set_notifications(true)$$, 'родитель включает уведомления обратно');

-- Служебные функции (service_role)
reset role;
select set_config('role', 'service_role', true);
select is((select count(*)::int from claim_notifications(10)), 3, 'отправитель забирает ожидающие сообщения (два администратору и одно родителю)');
select is((select count(*)::int from claim_notifications(10)), 0, 'забранные сообщения повторно не выдаются (закреплены на 2 минуты)');
select is((select min(attempts)::int from notifications where state = 'pending'), 1, 'попытка учтена');
select finish_notification((select id from notifications where kind = 'link_decided'), true, null);
select is((select state from notifications where kind = 'link_decided'), 'sent', 'успешная отправка отмечена');
select finish_notification((select id from notifications where kind = 'link_request' and text like '%Иванов%'), false, 'chat not found', true);
select is((select state from notifications where kind = 'link_request' and text like '%Иванов%'), 'failed', 'отказ без повторов (бот заблокирован) закрывает сообщение');
select finish_notification((select id from notifications where kind = 'link_request' and text like '%Сидоров%'), false, 'timeout');
select is((select state from notifications where kind = 'link_request' and text like '%Сидоров%'), 'pending', 'временная ошибка оставляет сообщение для повтора');
reset role;
update notifications set claimed_at = now() - interval '5 minutes' where state = 'pending';
select set_config('role', 'service_role', true);
select is((select count(*)::int from claim_notifications(10)), 1, 'по истечении закрепления сообщение берётся снова');
reset role;
update notifications set attempts = 3, claimed_at = null where state = 'pending';
select set_config('role', 'service_role', true);
select is((select count(*)::int from claim_notifications(10)), 0, 'после трёх попыток сообщение больше не выдаётся');
select is((select count(*)::int from notifications where state = 'pending' and attempts >= 3), 1, 'оно остаётся в очереди для разбора администратором базы');

select * from finish();
rollback;
