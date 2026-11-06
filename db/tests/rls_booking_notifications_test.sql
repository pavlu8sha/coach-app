-- pgTAP: уведомления о записи на тренировки (0148, #274, PR 5). Даты в 2099 году.
begin;
create extension if not exists pgtap;
select plan(21);

insert into clubs (id, name) values ('00000000-0000-0000-0000-00000000c001', 'Клуб');
insert into users (id, telegram_id, display_name, is_admin) values
  ('00000000-0000-0000-0000-0000000000a1', 9801, 'Админ', true),
  ('00000000-0000-0000-0000-0000000000b1', 9802, 'Родитель 1 (двое детей)', false),
  ('00000000-0000-0000-0000-0000000000b2', 9803, 'Родитель 2', false),
  ('00000000-0000-0000-0000-0000000000b3', 9804, 'Родитель 3 (общий выключатель выключен)', false);
update users set notifications_enabled = false where id = '00000000-0000-0000-0000-0000000000b3';
insert into groups (id, club_id, name) values
  ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-00000000c001', 'U9'),
  ('00000000-0000-0000-0000-0000000000e2', '00000000-0000-0000-0000-00000000c001', 'U11');
insert into players (id, club_id, group_id, full_name, status) values
  ('00000000-0000-0000-0000-00000000d001', '00000000-0000-0000-0000-00000000c001', '00000000-0000-0000-0000-0000000000e1', 'Аня', 'active'),
  ('00000000-0000-0000-0000-00000000d002', '00000000-0000-0000-0000-00000000c001', '00000000-0000-0000-0000-0000000000e2', 'Боря', 'active'),
  ('00000000-0000-0000-0000-00000000d003', '00000000-0000-0000-0000-00000000c001', '00000000-0000-0000-0000-0000000000e1', 'Вера', 'active'),
  ('00000000-0000-0000-0000-00000000d004', '00000000-0000-0000-0000-00000000c001', '00000000-0000-0000-0000-0000000000e1', 'Гриша', 'active');
insert into player_guardians (player_id, user_id, consent_version, consent_given_at) values
  ('00000000-0000-0000-0000-00000000d001', '00000000-0000-0000-0000-0000000000b1', 'test', now()),
  ('00000000-0000-0000-0000-00000000d004', '00000000-0000-0000-0000-0000000000b1', 'test', now()),
  ('00000000-0000-0000-0000-00000000d002', '00000000-0000-0000-0000-0000000000b2', 'test', now()),
  ('00000000-0000-0000-0000-00000000d003', '00000000-0000-0000-0000-0000000000b3', 'test', now());
insert into individual_templates (id, club_id, isodow, start_time, goalkeepers) values
  ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-00000000c001', 6, '19:00', false);
insert into individual_slot_members (template_id, player_id, month) values ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-00000000d001', '2099-11-01');

create or replace function as_user(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
end $$;
create temp table ids (k text primary key, id uuid);
grant all on ids to authenticated;

-- выключатель клуба не включён: ничего не ставится в очередь
select as_user('00000000-0000-0000-0000-0000000000a1');
insert into ids select 'i1', ind_create_session('2099-11-07', '19:00', false, 'Тема');
select ind_add_player((select id from ids where k = 'i1'), '00000000-0000-0000-0000-00000000d001');
reset role;
select is((select count(*)::int from notifications where kind like 'booking\_%'), 0, 'пока booking.notify не включён, сообщений о записи нет');
insert into club_settings (club_id, key, value, scope) values ('00000000-0000-0000-0000-00000000c001', 'booking.notify', 'on', '');

-- подтверждение записи администратором и родителем
select as_user('00000000-0000-0000-0000-0000000000a1');
select ind_add_player((select id from ids where k = 'i1'), '00000000-0000-0000-0000-00000000d004');
select as_user('00000000-0000-0000-0000-0000000000b2');
select booking_signup('individual', (select id from ids where k = 'i1'), '00000000-0000-0000-0000-00000000d002');
reset role;
select is((select count(*)::int from notifications where kind = 'booking_confirm' and user_id = '00000000-0000-0000-0000-0000000000b1'), 1, 'запись администратором: родитель получил подтверждение');
select ok((select text from notifications where kind = 'booking_confirm' and user_id = '00000000-0000-0000-0000-0000000000b1') like 'Запись подтверждена: Гриша — Индивидуальная тренировка, сб 07.11 19:00.', 'в тексте ребёнок и занятие');
select is((select count(*)::int from notifications where kind = 'booking_confirm' and user_id = '00000000-0000-0000-0000-0000000000b2'), 1, 'запись родителем: подтверждение семье');

-- изменение занятия: один родитель с двумя детьми получает одно сообщение
select as_user('00000000-0000-0000-0000-0000000000a1');
select ind_add_player((select id from ids where k = 'i1'), '00000000-0000-0000-0000-00000000d003');
select ind_edit_session((select id from ids where k = 'i1'), '2099-11-07', '18:00', 'Тема');
reset role;
select is((select count(*)::int from notifications where kind = 'booking_changed' and user_id = '00000000-0000-0000-0000-0000000000b1'), 1, 'изменение времени: одно сообщение на семью');
select ok((select text from notifications where kind = 'booking_changed' and user_id = '00000000-0000-0000-0000-0000000000b1') like '%Аня, Гриша%', 'в сообщении оба ребёнка семьи');
select is((select count(*)::int from notifications where user_id = '00000000-0000-0000-0000-0000000000b3'), 0, 'общий выключатель родителя блокирует все сообщения о записи');

-- автосоздание: автозапись постоянному; открытие записи только при включённом направлении
select ind_autocreate('2099-11-10');
select is((select count(*)::int from notifications where kind = 'booking_auto' and user_id = '00000000-0000-0000-0000-0000000000b1'), 1, 'постоянному: сообщение об автозаписи');
select is((select count(*)::int from notifications where kind = 'booking_open'), 0, 'направление «суббота» выключено по умолчанию: открытия записи нет');
insert into notification_prefs (user_id, direction, enabled) values ('00000000-0000-0000-0000-0000000000b2', 'ind_sat', true);
select is(ind_autocreate('2099-11-17'), 1, 'следующая неделя: одна суббота создана');
select is((select count(*)::int from notifications where kind = 'booking_open' and user_id = '00000000-0000-0000-0000-0000000000b2'), 1, 'открытие записи получил родитель с включённой субботой');
select ok((select text from notifications where kind = 'booking_open' and user_id = '00000000-0000-0000-0000-0000000000b2') like '%Можно записать: Боря.%', 'в тексте только его ребёнок');
select is((select count(*)::int from notifications where kind = 'booking_open' and user_id = '00000000-0000-0000-0000-0000000000b1'), 0, 'у родителя с выключенным направлением открытия нет');
select is(ind_autocreate('2099-11-17'), 0, 'повторный запуск ничего не создаёт');
select is((select count(*)::int from notifications where kind in ('booking_open', 'booking_auto')), 3, 'и повторных сообщений нет');

-- постоянный назначен на месяц: одно сообщение со списком занятий
select as_user('00000000-0000-0000-0000-0000000000a1');
select ind_slot_member_set('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-00000000d004', '2099-11-01', true);
reset role;
select is((select count(*)::int from notifications where kind = 'booking_auto' and user_id = '00000000-0000-0000-0000-0000000000b1' and text like 'Постоянная запись: Гриша%'), 1, 'назначение постоянным: одно сообщение со списком занятий');

-- отмена занятия администратором
select as_user('00000000-0000-0000-0000-0000000000a1');
select ind_delete_session((select id from individual_sessions where external_id = 'IND-2099-11-21-1900'));
reset role;
select is((select count(*)::int from notifications where kind = 'booking_cancelled' and user_id = '00000000-0000-0000-0000-0000000000b1'), 1, 'отмена занятия: одно сообщение семье записанных');

-- дополнительная: приглашение целевым группам, настройка «дополнительные», отмена
select as_user('00000000-0000-0000-0000-0000000000a1');
insert into ids select 'x1', extra_create_session('2099-12-05', 20, 'Зал', array['00000000-0000-0000-0000-0000000000e1']::uuid[], null);
reset role;
select is((select count(*)::int from notifications where kind = 'booking_extra_invite' and user_id = '00000000-0000-0000-0000-0000000000b1'), 1, 'приглашение получил родитель детей целевой группы (одно на семью)');
select is((select count(*)::int from notifications where kind = 'booking_extra_invite' and user_id = '00000000-0000-0000-0000-0000000000b2'), 0, 'родитель ребёнка другой группы приглашения не получил');
select as_user('00000000-0000-0000-0000-0000000000a1');
select extra_target_player((select id from ids where k = 'x1'), '00000000-0000-0000-0000-00000000d002', true);
reset role;
select is((select count(*)::int from notifications where kind = 'booking_extra_invite' and user_id = '00000000-0000-0000-0000-0000000000b2'), 1, 'приглашённому лично сообщение после публикации');
insert into notification_prefs (user_id, direction, enabled) values ('00000000-0000-0000-0000-0000000000b1', 'extra', false);
select as_user('00000000-0000-0000-0000-0000000000a1');
select extra_add_player((select id from ids where k = 'x1'), '00000000-0000-0000-0000-00000000d001');
select extra_cancel_session((select id from ids where k = 'x1'), 'Нет зала');
reset role;
select is((select count(*)::int from notifications where kind = 'booking_cancelled' and user_id = '00000000-0000-0000-0000-0000000000b1' and text like 'Тренировка отменена%Нет зала%'), 1, 'отмена клубом сообщает записанным, даже если настройка «дополнительные» выключена');

select * from finish();
rollback;
