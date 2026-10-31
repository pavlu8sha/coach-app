-- pgTAP: автосоздание индивидуальных и вратарских на выходные (0090, #336). Даты в 2099 году, чтобы тест не зависел от текущей даты.
begin;
create extension if not exists pgtap;
select plan(22);

insert into clubs (id, name) values ('00000000-0000-0000-0000-00000000c001', 'Клуб');
insert into users (id, telegram_id, display_name, is_admin) values
  ('00000000-0000-0000-0000-0000000000a1', 9301, 'Админ', true),
  ('00000000-0000-0000-0000-0000000000c1', 9302, 'Тренер', false);
insert into players (id, club_id, full_name, status) values
  ('00000000-0000-0000-0000-00000000d001', '00000000-0000-0000-0000-00000000c001', 'Аня', 'active'),
  ('00000000-0000-0000-0000-00000000d002', '00000000-0000-0000-0000-00000000c001', 'Боря', 'active');
insert into clubs (id, name) values ('00000000-0000-0000-0000-00000000c002', 'Чужой клуб');
insert into players (id, club_id, full_name, status) values ('00000000-0000-0000-0000-00000000d009', '00000000-0000-0000-0000-00000000c002', 'Чужой', 'active');
insert into individual_templates (id, club_id, isodow, start_time, goalkeepers, topics) values
  ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-00000000c001', 6, '19:00', false, array['Тема А', 'Тема Б']),
  ('00000000-0000-0000-0000-0000000000e2', '00000000-0000-0000-0000-00000000c001', 7, '18:00', false, array['Тема А', 'Тема Б']),
  ('00000000-0000-0000-0000-0000000000e3', '00000000-0000-0000-0000-00000000c001', 7, '19:00', true, array['Вратари']);
-- Аня постоянно ходит в воскресенье 18:00 в ноябре 2099
insert into individual_slot_members (template_id, player_id, month) values ('00000000-0000-0000-0000-0000000000e2', '00000000-0000-0000-0000-00000000d001', '2099-11-01');

create or replace function as_user(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
end $$;

select is(ind_autocreate('2099-11-03'), 3, 'вторник: созданы сб 19:00, вс 18:00 и вс 19:00 (вратарская)');
select is((select count(*)::int from individual_sessions where auto), 3, 'занятия помечены как автоматические');
select is(ind_autocreate('2099-11-03'), 0, 'повторный запуск ничего не дублирует');
select is((select starts_at from individual_sessions where external_id = 'IND-2099-11-07-1900'), '2099-11-07 19:00'::timestamp, 'суббота 19:00 на ближайшие выходные');
select is((select goalkeepers from individual_sessions where external_id = 'IND-2099-11-08-1900-GK'), true, 'воскресная 19:00 — вратарская');
select is((select topic from individual_sessions where external_id = 'IND-2099-11-08-1900-GK'), 'Вратари', 'у вратарской тема «Вратари»');
select is((select topic from individual_sessions where external_id = 'IND-2099-11-07-1900'), (select topic from individual_sessions where external_id = 'IND-2099-11-08-1800'), 'в субботу и воскресенье одной недели тема одна');
select is(ind_autocreate('2099-11-10'), 3, 'следующий вторник создаёт следующие выходные');
select isnt((select topic from individual_sessions where external_id = 'IND-2099-11-14-1900'), (select topic from individual_sessions where external_id = 'IND-2099-11-07-1900'), 'тема меняется по кругу по неделям');
select is((select count(*)::int from individual_bookings b join individual_sessions s on s.id = b.session_id where b.player_id = '00000000-0000-0000-0000-00000000d001'), 2, 'Аня записана на оба воскресных 18:00 ноября, на остальные слоты нет');
select is((select count(*)::int from individual_bookings b join individual_sessions s on s.id = b.session_id where b.player_id = '00000000-0000-0000-0000-00000000d001' and s.external_id like '%-1800'), 2, 'и именно на слот вс 18:00');
select is((select amount from individual_bookings b join individual_sessions s on s.id = b.session_id where s.external_id = 'IND-2099-11-15-1800' and b.player_id = '00000000-0000-0000-0000-00000000d001'), 50::numeric, 'запись постоянной обычная, с ценой занятия');

select as_user('00000000-0000-0000-0000-0000000000c1');
select throws_ok($$select ind_autocreate('2099-11-17')$$, '42501', null, 'тренер не вызывает ind_autocreate');
select throws_ok($$select ind_autocreate_now()$$, '42501', 'forbidden', 'тренер не запускает создание выходных');
select is((select count(*)::int from individual_templates), 0, 'тренер не видит шаблоны');

select as_user('00000000-0000-0000-0000-0000000000a1');
select throws_ok($$select ind_autocreate('2099-11-17')$$, '42501', null, 'админ не вызывает ind_autocreate напрямую (только cron/кнопка)');
select lives_ok($$select ind_autocreate_now()$$, 'админ запускает создание выходных кнопкой');
-- удаление автозанятия запоминается
select ind_delete_session((select id from individual_sessions where external_id = 'IND-2099-11-14-1900'));
reset role;
select is(ind_autocreate('2099-11-10'), 0, 'удалённое администратором автозанятие не воссоздаётся');
select as_user('00000000-0000-0000-0000-0000000000a1');
-- перенос автозанятия запоминает прежний слот
select ind_edit_session((select id from individual_sessions where external_id = 'IND-2099-11-15-1900-GK'), '2099-11-15', '20:00', 'Вратари', null);
reset role;
select is(ind_autocreate('2099-11-10'), 0, 'перенесённое автозанятие не создаётся заново в старое время');
select as_user('00000000-0000-0000-0000-0000000000a1');
-- постоянный на слот: Боря на сб 19:00 включается на уже созданные будущие занятия и снимается, если не оплачено
select ind_slot_member_set('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-00000000d002', '2099-11-20', true);
select is((select count(*)::int from individual_bookings where player_id = '00000000-0000-0000-0000-00000000d002'), 1, 'Боря записан на сб 19:00 (в ноябре осталось одно созданное)');
select ind_set_paid((select id from individual_sessions where external_id = 'IND-2099-11-07-1900'), '00000000-0000-0000-0000-00000000d002', true, 'Наличные');
select ind_slot_member_set('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-00000000d002', '2099-11-20', false);
select is((select count(*)::int from individual_bookings where player_id = '00000000-0000-0000-0000-00000000d002' and paid), 1, 'оплаченная запись при снятии с постоянных остаётся');
select throws_ok($$select ind_slot_member_set('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-00000000d009', '2099-11-20', true)$$, '22023', 'player not in club', 'игрок чужого клуба отклоняется');

select * from finish();
rollback;
