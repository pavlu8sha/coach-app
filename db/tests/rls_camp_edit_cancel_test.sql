-- pgTAP: самозапись на сборы, этап 3 (0166, Issue #470, docs/CAMP_SELF_SIGNUP_ACCEPTANCE.md, условия 28-33):
-- правка тарифа и комментария родителем, отмена с условиями, возврат администратором, замена участника, журнал смены суммы и тарифа.
begin;
create extension if not exists pgtap;
select plan(65);

insert into clubs (id, name) values ('00000000-0000-0000-0000-00000000c001', 'Клуб');
insert into users (id, telegram_id, display_name, is_admin) values
  ('00000000-0000-0000-0000-0000000000a1', 9901, 'Админ', true),
  ('00000000-0000-0000-0000-0000000000b1', 9902, 'Родитель 1', false),
  ('00000000-0000-0000-0000-0000000000b2', 9903, 'Родитель 2', false),
  ('00000000-0000-0000-0000-0000000000b3', 9904, 'Гость', false),
  ('00000000-0000-0000-0000-0000000000d1', 9905, 'Локальный админ', false);
insert into location_admins (user_id, location) values ('00000000-0000-0000-0000-0000000000d1', 'Исани');
insert into players (id, club_id, full_name, status) values
  ('00000000-0000-0000-0000-00000000d001', '00000000-0000-0000-0000-00000000c001', 'Аня', 'active'),
  ('00000000-0000-0000-0000-00000000d002', '00000000-0000-0000-0000-00000000c001', 'Боря', 'active'),
  ('00000000-0000-0000-0000-00000000d003', '00000000-0000-0000-0000-00000000c001', 'Вася', 'active');
insert into player_guardians (player_id, user_id, consent_version, consent_given_at) values
  ('00000000-0000-0000-0000-00000000d001', '00000000-0000-0000-0000-0000000000b1', 'test', now()),
  ('00000000-0000-0000-0000-00000000d002', '00000000-0000-0000-0000-0000000000b1', 'test', now()),
  ('00000000-0000-0000-0000-00000000d003', '00000000-0000-0000-0000-0000000000b2', 'test', now());
-- ca: срок полной оплаты в будущем; cb: срок не задан; cc: срок вчера; cd: срок сегодня; ce: сбор закончился
insert into camps (id, club_id, name, location, starts_on, ends_on, full_payment_deadline) values
  ('00000000-0000-0000-0000-0000000000ca', '00000000-0000-0000-0000-00000000c001', 'Зимний сбор', 'Исани', '2099-01-03', '2099-01-10', '2098-12-20'),
  ('00000000-0000-0000-0000-0000000000cb', '00000000-0000-0000-0000-00000000c001', 'Без срока', 'Исани', '2099-02-03', '2099-02-10', null),
  ('00000000-0000-0000-0000-0000000000cc', '00000000-0000-0000-0000-00000000c001', 'Срок вчера', 'Исани', '2099-03-03', '2099-03-10', (now() at time zone 'Asia/Tbilisi')::date - 1),
  ('00000000-0000-0000-0000-0000000000cd', '00000000-0000-0000-0000-00000000c001', 'Срок сегодня', 'Исани', '2099-04-03', '2099-04-10', (now() at time zone 'Asia/Tbilisi')::date),
  ('00000000-0000-0000-0000-0000000000ce', '00000000-0000-0000-0000-00000000c001', 'Закончился', 'Исани', '2020-01-03', '2020-01-10', null);
insert into camp_tariffs (id, camp_id, name, price, active) values
  ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000ca', 'Футболист', 1000, true),
  ('00000000-0000-0000-0000-0000000000e2', '00000000-0000-0000-0000-0000000000ca', 'Вратарь', 1500, true),
  ('00000000-0000-0000-0000-0000000000e3', '00000000-0000-0000-0000-0000000000ca', 'Снятый', 500, false),
  ('00000000-0000-0000-0000-0000000000e4', '00000000-0000-0000-0000-0000000000cb', 'Без срока', 900, true),
  ('00000000-0000-0000-0000-0000000000e5', '00000000-0000-0000-0000-0000000000cc', 'Срок вчера 1', 800, true),
  ('00000000-0000-0000-0000-0000000000e6', '00000000-0000-0000-0000-0000000000cc', 'Срок вчера 2', 900, true),
  ('00000000-0000-0000-0000-0000000000e7', '00000000-0000-0000-0000-0000000000cd', 'Сегодня 1', 700, true),
  ('00000000-0000-0000-0000-0000000000e8', '00000000-0000-0000-0000-0000000000cd', 'Сегодня 2', 750, true),
  ('00000000-0000-0000-0000-0000000000e9', '00000000-0000-0000-0000-0000000000ce', 'Старый', 500, true),
  ('00000000-0000-0000-0000-0000000000ea', '00000000-0000-0000-0000-0000000000cb', 'Без срока 2', 950, true);

create or replace function as_user(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
end $$;
grant execute on function as_user(uuid) to public;
create temp table ids (k text primary key, id uuid);
grant all on ids to authenticated;

-- Записи: Аня и Боря (родитель 1), Вася (родитель 2) на ca; гость с владельцем; записи на cb, cc, cd; старая запись на закончившемся сборе
select as_user('00000000-0000-0000-0000-0000000000b1');
insert into ids select 'anya', camp_parent_register('00000000-0000-0000-0000-0000000000ca', '00000000-0000-0000-0000-00000000d001', '00000000-0000-0000-0000-0000000000e1', 'комментарий');
insert into ids select 'borya', camp_parent_register('00000000-0000-0000-0000-0000000000ca', '00000000-0000-0000-0000-00000000d002', '00000000-0000-0000-0000-0000000000e1', null);
insert into ids select 'nodl', camp_parent_register('00000000-0000-0000-0000-0000000000cb', '00000000-0000-0000-0000-00000000d001', '00000000-0000-0000-0000-0000000000e4', null);
insert into ids select 'yest', camp_parent_register('00000000-0000-0000-0000-0000000000cc', '00000000-0000-0000-0000-00000000d001', '00000000-0000-0000-0000-0000000000e5', null);
insert into ids select 'today', camp_parent_register('00000000-0000-0000-0000-0000000000cd', '00000000-0000-0000-0000-00000000d001', '00000000-0000-0000-0000-0000000000e7', null);
select as_user('00000000-0000-0000-0000-0000000000b2');
insert into ids select 'vasya', camp_parent_register('00000000-0000-0000-0000-0000000000ca', '00000000-0000-0000-0000-00000000d003', '00000000-0000-0000-0000-0000000000e1', null);
reset role;
insert into camp_participants (id, camp_id, player_id, tariff_id, amount, status) values
  ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000ce', '00000000-0000-0000-0000-00000000d001', '00000000-0000-0000-0000-0000000000e9', 500, 'registered');
insert into camp_participants (id, camp_id, guest_name, tariff_id, amount, status, owner_user_id) values
  ('00000000-0000-0000-0000-0000000000f2', '00000000-0000-0000-0000-0000000000ca', 'Гость', '00000000-0000-0000-0000-0000000000e1', 1000, 'registered', '00000000-0000-0000-0000-0000000000b3');

-- ===== 28. Правка тарифа и комментария родителем =====
select as_user('00000000-0000-0000-0000-0000000000b1');
select lives_ok($$select camp_parent_update((select id from ids where k = 'anya'), '00000000-0000-0000-0000-0000000000e2', 'новый комментарий')$$, 'до срока полной оплаты родитель меняет тариф и комментарий');
select is((select tariff_id::text || '|' || amount || '|' || comment from camp_participants where id = (select id from ids where k = 'anya')), '00000000-0000-0000-0000-0000000000e2|1500.00|новый комментарий', 'сумма пересчитана по цене нового тарифа');
select is((select count(*)::int from camp_participant_events where participant_id = (select id from ids where k = 'anya') and from_status = 'registered' and to_status = 'registered' and tariff_id = '00000000-0000-0000-0000-0000000000e2' and amount = 1500 and note = 'parent'), 1, 'смена тарифа записана в журнал с новой суммой');
select is(camp_parent_update((select id from ids where k = 'anya'), null, 'только комментарий'), (select id from ids where k = 'anya'), 'без тарифа правится только комментарий');
select is((select count(*)::int from camp_participant_events where participant_id = (select id from ids where k = 'anya')), 2, 'правка комментария без смены суммы журнал не пополняет');
select is((select player_id from camp_participants where id = (select id from ids where k = 'anya')), '00000000-0000-0000-0000-00000000d001'::uuid, 'ребёнок в записи не меняется');
select throws_ok($$select camp_parent_update((select id from ids where k = 'anya'), null, repeat('я', 501))$$, '22023', 'bad comment', 'слишком длинный комментарий отклоняется');
select throws_ok($$select camp_parent_update((select id from ids where k = 'anya'), '00000000-0000-0000-0000-0000000000e3', null)$$, 'P0002', 'tariff not found', 'снятый тариф выбрать нельзя');
select throws_ok($$select camp_parent_update((select id from ids where k = 'anya'), '00000000-0000-0000-0000-0000000000e4', null)$$, 'P0002', 'tariff not found', 'тариф другого сбора выбрать нельзя');
select as_user('00000000-0000-0000-0000-0000000000b2');
select throws_ok($$select camp_parent_update((select id from ids where k = 'anya'), null, 'чужая запись')$$, '42501', 'forbidden', 'чужую запись родитель не правит');
select throws_ok($$select camp_parent_cancel((select id from ids where k = 'anya'))$$, '42501', 'forbidden', 'чужую запись родитель не отменяет');
select as_user('00000000-0000-0000-0000-0000000000a1');
select camp_pay((select id from ids where k = 'anya'), 1200, 'payment', current_date, 'Наличные', null);
select as_user('00000000-0000-0000-0000-0000000000b1');
select throws_ok($$select camp_parent_update((select id from ids where k = 'anya'), '00000000-0000-0000-0000-0000000000e1', null)$$, '22023', 'amount below paid', 'тариф дешевле оплаченного выбрать нельзя');
select is((select amount from camp_participants where id = (select id from ids where k = 'anya')), 1500::numeric, 'сумма после отказа не изменилась');
-- срок полной оплаты
select throws_ok($$select camp_parent_update((select id from ids where k = 'nodl'), '00000000-0000-0000-0000-0000000000ea', null)$$, '22023', 'tariff change closed', 'при пустом сроке полной оплаты смена тарифа запрещена');
select lives_ok($$select camp_parent_update((select id from ids where k = 'nodl'), null, 'комментарий при пустом сроке')$$, 'комментарий при пустом сроке править можно');
select throws_ok($$select camp_parent_update((select id from ids where k = 'yest'), '00000000-0000-0000-0000-0000000000e6', null)$$, '22023', 'tariff change closed', 'после срока полной оплаты смена тарифа запрещена');
select lives_ok($$select camp_parent_update((select id from ids where k = 'today'), '00000000-0000-0000-0000-0000000000e8', null)$$, 'в день срока полной оплаты (по Тбилиси) смена тарифа разрешена');
select is((select amount from camp_participants where id = (select id from ids where k = 'today')), 750::numeric, 'сумма в день срока пересчитана');
-- нестандартная сумма
select as_user('00000000-0000-0000-0000-0000000000a1');
select camp_update_participant((select id from ids where k = 'borya'), null, 1234, null, null, 'registered');
select as_user('00000000-0000-0000-0000-0000000000b1');
select throws_ok($$select camp_parent_update((select id from ids where k = 'borya'), '00000000-0000-0000-0000-0000000000e2', null)$$, '22023', 'custom amount', 'при нестандартной сумме смена тарифа запрещена');
select is((select amount from camp_participants where id = (select id from ids where k = 'borya')), 1234::numeric, 'нестандартная сумма осталась');
-- гость-владелец и неподходящие статусы
select as_user('00000000-0000-0000-0000-0000000000b3');
select lives_ok($$select camp_parent_update('00000000-0000-0000-0000-0000000000f2', null, 'комментарий гостя')$$, 'владелец гостевой записи правит комментарий');
select as_user('00000000-0000-0000-0000-0000000000b1');
select throws_ok($$select camp_parent_update('00000000-0000-0000-0000-0000000000f1', null, 'закончился')$$, '22023', 'camp closed', 'запись закончившегося сбора не правится');
select throws_ok($$select camp_parent_update('00000000-0000-0000-0000-000000000000', null, 'нет такой')$$, '42501', 'forbidden', 'несуществующая запись не раскрывается');
select as_user('00000000-0000-0000-0000-0000000000a1');
select throws_ok($$select camp_parent_update((select id from ids where k = 'anya'), null, 'админ')$$, '42501', 'forbidden', 'админская правка идёт через camp_update_participant, родительская функция админу не подходит');

-- ===== 31. Условия отмены: версия и действующий период по Тбилиси =====
select camp_terms_save('00000000-0000-0000-0000-0000000000ca', '[{"from":null,"to":"2099-01-01","text":"Возврат 100%"},{"from":"2099-01-02","to":null,"text":"Без возврата"}]'::jsonb);
reset role;  -- camp_terms_for внутренняя, прикладным ролям не выдана
select is(camp_terms_for('00000000-0000-0000-0000-0000000000ca', (now() at time zone 'Asia/Tbilisi')::date)::text, '{"text": "Возврат 100%", "version": 1}', 'на дату действует нужный период версии 1');
select is(camp_terms_for('00000000-0000-0000-0000-0000000000ca', '2099-01-05')::text, '{"text": "Без возврата", "version": 1}', 'на более позднюю дату действует второй период');
select is(camp_terms_for('00000000-0000-0000-0000-0000000000cb', current_date), null::jsonb, 'без условий возвращается пусто');
-- пересекающиеся периоды: выбор не зависит от порядка в списке (раньше заканчивающийся период важнее)
insert into camp_cancel_terms (camp_id, version, periods) values
  ('00000000-0000-0000-0000-0000000000cc', 1, '[{"to":"2099-12-20","text":"до 20.12"},{"to":"2099-12-01","text":"до 1.12"}]'),
  ('00000000-0000-0000-0000-0000000000cd', 1, '[{"to":"2099-12-01","text":"до 1.12"},{"to":"2099-12-20","text":"до 20.12"}]');
select is(camp_terms_for('00000000-0000-0000-0000-0000000000cc', current_date)->>'text', 'до 1.12', 'пересечение периодов: берётся раньше заканчивающийся');
select is(camp_terms_for('00000000-0000-0000-0000-0000000000cd', current_date)->>'text', 'до 1.12', 'пересечение периодов: порядок в списке на выбор не влияет');
-- неактивный сбор: правка закрыта, отмена разрешена
update camps set active = false where id = '00000000-0000-0000-0000-0000000000cb';
select as_user('00000000-0000-0000-0000-0000000000b1');
select throws_ok($$select camp_parent_update((select id from ids where k = 'nodl'), null, 'неактивный')$$, '22023', 'camp closed', 'на неактивном сборе родитель запись не правит');
reset role;
update camps set active = true where id = '00000000-0000-0000-0000-0000000000cb';

-- ===== 30. Отмена родителем =====
select as_user('00000000-0000-0000-0000-0000000000b1');
select is((camp_parent_cancel((select id from ids where k = 'borya')))->>'paid', '0', 'отмена возвращает внесённую сумму');
select is((select status from camp_participants where id = (select id from ids where k = 'borya')), 'cancelled', 'статус «отменён»');
select is((select status from camp_participants where id = (select id from ids where k = 'anya')), 'registered', 'отмена одного ребёнка не затрагивает другого');
select is((select count(*)::int from camp_participant_events where participant_id = (select id from ids where k = 'borya') and to_status = 'cancelled' and from_status = 'registered' and terms_version = 1 and terms_text = 'Возврат 100%' and note = 'parent-cancel' and paid = 0), 1, 'в журнале снимок условий (версия и период) и внесённая сумма');
select throws_ok($$select camp_parent_cancel((select id from ids where k = 'borya'))$$, '23505', 'already cancelled', 'повторная отмена отклоняется');
select throws_ok($$select camp_parent_update((select id from ids where k = 'borya'), null, 'после отмены')$$, '22023', 'not registered', 'отменённую запись править нельзя');
select as_user('00000000-0000-0000-0000-0000000000a1');
select is((select count(*)::int from camp_participants where camp_id = '00000000-0000-0000-0000-0000000000ca' and status = 'registered'), 3, 'место освобождено (остались Аня, Вася и гость)');
select camp_terms_save('00000000-0000-0000-0000-0000000000ca', '[{"from":null,"to":null,"text":"Новые условия"}]'::jsonb);
select as_user('00000000-0000-0000-0000-0000000000b1');
select is((camp_parent_cancel((select id from ids where k = 'anya')))->>'paid', '1200.00', 'вторая отмена видит внесённую сумму');
select is((select terms_version::text || '|' || terms_text from camp_participant_events where participant_id = (select id from ids where k = 'anya') and to_status = 'cancelled'), '2|Новые условия', 'новая версия условий применяется к новым отменам');
select is((select terms_version::text || '|' || terms_text from camp_participant_events where participant_id = (select id from ids where k = 'borya') and to_status = 'cancelled'), '1|Возврат 100%', 'прежний снимок остался прежним');
select is((select coalesce(sum(amount), 0) from camp_payments where participant_id = (select id from ids where k = 'anya')), 1200::numeric, 'платежи отменённой записи остаются');
select is((select count(*)::int from camp_participants where camp_id = '00000000-0000-0000-0000-0000000000cb' and status = 'registered'), 1, 'запись на другой сбор не затронута');
select throws_ok($$select camp_parent_cancel('00000000-0000-0000-0000-0000000000f1')$$, '22023', 'camp closed', 'запись закончившегося сбора не отменяется');
select as_user('00000000-0000-0000-0000-0000000000b3');
select lives_ok($$select camp_parent_cancel('00000000-0000-0000-0000-0000000000f2')$$, 'владелец гостевой записи отменяет её');
select as_user('00000000-0000-0000-0000-0000000000b2');
select throws_ok($$select camp_parent_cancel('00000000-0000-0000-0000-0000000000f2')$$, '42501', 'forbidden', 'чужую гостевую запись отменить нельзя');

-- ===== 32. Возврат администратором =====
select as_user('00000000-0000-0000-0000-0000000000a1');
select lives_ok($$select camp_refund((select id from ids where k = 'anya'), 200, (now() at time zone 'Asia/Tbilisi')::date, 'Частичный возврат')$$, 'администратор записывает возврат');
select is((select amount::text || '|' || kind || '|' || recorded_by::text from camp_payments where participant_id = (select id from ids where k = 'anya') and kind = 'refund'), '-200.00|refund|00000000-0000-0000-0000-0000000000a1', 'возврат записан с минусом и автором');
select is((select count(*)::int from camp_payments where participant_id = (select id from ids where k = 'anya')), 2, 'платёж не удалён: платёж и возврат');
select throws_ok($$select camp_refund((select id from ids where k = 'anya'), 1100, current_date, null)$$, '22023', 'refund above paid', 'возврат больше оставшегося оплаченного отклоняется');
select lives_ok($$select camp_refund((select id from ids where k = 'anya'), 1000, current_date, null)$$, 'возврат всего остатка разрешён');
select throws_ok($$select camp_refund((select id from ids where k = 'anya'), 0, current_date, null)$$, '22023', 'bad amount', 'нулевая сумма возврата отклоняется');
select throws_ok($$select camp_refund((select id from ids where k = 'anya'), 1, current_date + 400, null)$$, '22023', 'bad date', 'дата возврата в будущем отклоняется');
select throws_ok($$select camp_refund('00000000-0000-0000-0000-000000000000', 1, current_date, null)$$, 'P0002', 'participant not found', 'несуществующий участник');
select as_user('00000000-0000-0000-0000-0000000000b1');
select throws_ok($$select camp_refund((select id from ids where k = 'anya'), 1, current_date, null)$$, '42501', 'forbidden', 'родитель возврат не делает');
select as_user('00000000-0000-0000-0000-0000000000d1');
select throws_ok($$select camp_refund((select id from ids where k = 'anya'), 1, current_date, null)$$, '42501', 'forbidden', 'локальный администратор возврат не делает');

-- ===== 33. Замена участника: только факт =====
select as_user('00000000-0000-0000-0000-0000000000a1');
select lives_ok($$select camp_replace_participant((select id from ids where k = 'anya'), (select id from ids where k = 'vasya'), 'Вася вместо Ани')$$, 'администратор записывает факт замены');
select is((select count(*)::int from camp_participant_replacements where old_participant_id = (select id from ids where k = 'anya') and new_participant_id = (select id from ids where k = 'vasya') and by_user = '00000000-0000-0000-0000-0000000000a1' and note = 'Вася вместо Ани'), 1, 'в журнале замен старый, новый, кто и комментарий');
select is((select count(*)::int from camp_payments where participant_id = (select id from ids where k = 'anya')), 3, 'платежи прежнего участника остались (платёж и два возврата), деньги замена не двигает');
select throws_ok($$select camp_replace_participant((select id from ids where k = 'anya'), (select id from ids where k = 'vasya'), null)$$, '23505', 'already replaced', 'повторная замена того же участника отклоняется');
select throws_ok($$select camp_replace_participant((select id from ids where k = 'vasya'), (select id from ids where k = 'vasya'), null)$$, '22023', 'bad replacement', 'замена на самого себя отклоняется');
select throws_ok($$select camp_replace_participant((select id from ids where k = 'borya'), (select id from ids where k = 'nodl'), null)$$, '22023', 'bad replacement', 'замена между разными сборами отклоняется');
select as_user('00000000-0000-0000-0000-0000000000b1');
select throws_ok($$select camp_replace_participant((select id from ids where k = 'borya'), (select id from ids where k = 'vasya'), null)$$, '42501', 'forbidden', 'родитель замену не делает');
select is((select count(*)::int from camp_participant_replacements), 0, 'родитель журнал замен не читает');
select throws_ok($$delete from camp_participant_replacements$$, '42501', null, 'журнал замен не удаляется прямым запросом');
select as_user('00000000-0000-0000-0000-0000000000a1');
select is((select count(*)::int from camp_participant_replacements), 1, 'администратор журнал замен читает');

select * from finish();
rollback;
