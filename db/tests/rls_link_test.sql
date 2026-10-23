-- pgTAP: запросы на связь родитель–ребёнок.
begin;
create extension if not exists pgtap;
select plan(15);
insert into consent_versions (version) values ('draft-2026-10') on conflict do nothing;

insert into clubs (id, name) values ('00000000-0000-0000-0000-00000000c001', 'Клуб');
insert into users (id, telegram_id, display_name, is_admin) values
  ('00000000-0000-0000-0000-0000000000a1', 3001, 'Админ', true),
  ('00000000-0000-0000-0000-0000000000b1', 3002, 'Родитель А', false),
  ('00000000-0000-0000-0000-0000000000b2', 3003, 'Родитель Б', false);
insert into groups (id, club_id, name) values ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-00000000c001', 'U9');
insert into players (id, club_id, group_id, full_name) values
  ('00000000-0000-0000-0000-00000000d001', '00000000-0000-0000-0000-00000000c001', '00000000-0000-0000-0000-0000000000e1', 'Иванов Пётр'),
  ('00000000-0000-0000-0000-00000000d002', '00000000-0000-0000-0000-00000000c001', '00000000-0000-0000-0000-0000000000e1', 'Иванова Анна');

create or replace function as_user(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
end $$;

select as_user('00000000-0000-0000-0000-0000000000b1');
select is((select count(*)::int from search_players_for_link('Ив')), 0, 'поиск короче 3 букв ничего не возвращает');
select is((select count(*)::int from search_players_for_link('иван')), 2, 'поиск по части имени без учёта регистра');
select is((select count(*)::int from search_players_for_link('%%%')), 0, 'подстановочные знаки не срабатывают как маска');
select is((select count(*)::int from players), 0, 'родитель по-прежнему не читает таблицу игроков');

select throws_ok($$select request_link('00000000-0000-0000-0000-00000000d001', '')$$, null, 'consent required', 'без согласия запрос не принимается');
select throws_ok($$select request_link('00000000-0000-0000-0000-00000000d001', 'выдуманная-версия')$$, null, 'consent required', 'неизвестная версия согласия не принимается');
select lives_ok($$select request_link('00000000-0000-0000-0000-00000000d001', 'draft-2026-10')$$, 'родитель подаёт запрос с согласием');
select is((select count(*)::int from search_players_for_link('иван')), 1, 'запрошенный ребёнок исчезает из поиска');
select throws_ok($$insert into link_requests (user_id, player_id, status) values ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-00000000d002', 'approved')$$, '42501', null, 'родитель не пишет в запросы напрямую');
select throws_ok($$select decide_link((select id from link_requests limit 1), true)$$, '42501', null, 'родитель не может подтвердить связь');

select as_user('00000000-0000-0000-0000-0000000000b2');
select is((select count(*)::int from link_requests), 0, 'другой родитель не видит чужие запросы');

select as_user('00000000-0000-0000-0000-0000000000a1');
select decide_link((select id from link_requests limit 1), true);
select as_user('00000000-0000-0000-0000-0000000000b1');
select is((select full_name from players), 'Иванов Пётр', 'после подтверждения родитель видит ребёнка');
select is((select consent_version from player_guardians), 'draft-2026-10', 'версия согласия перенесена в связь');
select ok((select consent_given_at from player_guardians) <= now(), 'время согласия сохранено');
select as_user('00000000-0000-0000-0000-0000000000b2');
select is((select count(*)::int from players), 0, 'другой родитель по-прежнему ничего не видит');

select * from finish();
rollback;
