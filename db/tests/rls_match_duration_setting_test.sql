-- pgTAP: длительность матча настройкой (0168). Родитель читает только ключ matches.durationMin и только клуба своего ребёнка;
-- остальные настройки клуба и сама таблица club_settings остаются закрытыми. Условия: docs/MATCH_DURATION_SETTING_ACCEPTANCE.md, п. 9–12.
begin;
create extension if not exists pgtap;
select plan(12);

insert into clubs (id, name) values
  ('00000000-0000-0000-0000-00000000c001', 'Свой клуб'),
  ('00000000-0000-0000-0000-00000000c002', 'Чужой клуб');
insert into users (id, telegram_id, display_name, is_admin) values
  ('00000000-0000-0000-0000-0000000000a1', 9701, 'Админ', true),
  ('00000000-0000-0000-0000-0000000000b1', 9702, 'Родитель', false),
  ('00000000-0000-0000-0000-0000000000b2', 9703, 'Родитель с отозванной связью', false),
  ('00000000-0000-0000-0000-0000000000f1', 9704, 'Без детей', false);
insert into players (id, club_id, full_name, status) values
  ('00000000-0000-0000-0000-00000000d001', '00000000-0000-0000-0000-00000000c001', 'Ребёнок', 'active');
insert into player_guardians (player_id, user_id, consent_version, consent_given_at, consent_revoked_at) values
  ('00000000-0000-0000-0000-00000000d001', '00000000-0000-0000-0000-0000000000b1', 'v1', now(), null),
  ('00000000-0000-0000-0000-00000000d001', '00000000-0000-0000-0000-0000000000b2', 'v1', now(), now());
insert into club_settings (club_id, key, scope, value) values
  ('00000000-0000-0000-0000-00000000c001', 'matches.durationMin', '', '100'),
  ('00000000-0000-0000-0000-00000000c001', 'matches.durationMin', 'U8', '50'),
  ('00000000-0000-0000-0000-00000000c001', 'matches.champFee', '', '200'),
  ('00000000-0000-0000-0000-00000000c001', 'matches.guestFee', '', '25'),
  ('00000000-0000-0000-0000-00000000c002', 'matches.durationMin', '', '70'),
  ('00000000-0000-0000-0000-00000000c002', 'matches.durationMin', 'U14', '130');

create or replace function as_user(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
end $$;

-- родитель: только длительность своего клуба
select as_user('00000000-0000-0000-0000-0000000000b1');
select is((select count(*)::int from match_duration_minutes()), 2, 'родитель видит две строки своего клуба');
select is((select value from match_duration_minutes() where team = ''), '100', 'общая длительность своего клуба');
select is((select value from match_duration_minutes() where team = 'U8'), '50', 'длительность команды U8');
select is((select count(*)::int from match_duration_minutes() where value in ('200', '25')), 0, 'взносы функция не отдаёт');
select is((select count(*)::int from match_duration_minutes() where team = 'U14' or value in ('70', '130')), 0, 'настройки чужого клуба не видны');
select is((select count(*)::int from club_settings), 0, 'сама таблица настроек родителю по-прежнему закрыта');

-- связь отозвана: настроек нет
select as_user('00000000-0000-0000-0000-0000000000b2');
select is((select count(*)::int from match_duration_minutes()), 0, 'родитель с отозванной связью ничего не получает');

-- пользователь без детей
select as_user('00000000-0000-0000-0000-0000000000f1');
select is((select count(*)::int from match_duration_minutes()), 0, 'пользователь без детей получает пустой список');

-- администратор видит все клубы
select as_user('00000000-0000-0000-0000-0000000000a1');
select is((select count(*)::int from match_duration_minutes()), 4, 'администратор видит длительность всех клубов');

-- гость
reset role;
select ok(not has_function_privilege('anon', 'match_duration_minutes()', 'execute'), 'гость (anon) вызвать функцию не может');
select ok(has_function_privilege('authenticated', 'match_duration_minutes()', 'execute'), 'вошедший пользователь вызывает функцию');
select is((select provolatile::text from pg_proc where proname = 'match_duration_minutes'), 's', 'функция только читает (stable)');

select * from finish();
rollback;
