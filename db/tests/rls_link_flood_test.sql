-- pgTAP: лимит запросов и отмен на привязку и дедупликация уведомлений администратору (S-02, миграция 0066).
begin;
create extension if not exists pgtap;
select plan(13);
insert into consent_versions (version) values ('draft-2026-10') on conflict do nothing;

insert into clubs (id, name) values ('00000000-0000-0000-0000-00000000c001', 'Клуб');
insert into users (id, telegram_id, display_name, is_admin) values
  ('00000000-0000-0000-0000-0000000000a1', 9301, 'Админ', true),
  ('00000000-0000-0000-0000-0000000000b1', 9302, 'Родитель А', false);
insert into groups (id, club_id, name) values ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-00000000c001', 'U9');
insert into players (id, club_id, group_id, full_name) values
  ('00000000-0000-0000-0000-00000000d001', '00000000-0000-0000-0000-00000000c001', '00000000-0000-0000-0000-0000000000e1', 'Иванов Пётр'),
  ('00000000-0000-0000-0000-00000000d002', '00000000-0000-0000-0000-00000000c001', '00000000-0000-0000-0000-0000000000e1', 'Иванова Анна');

create or replace function as_user(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
end $$;

-- Родитель: запрос, отмена, снова запрос на того же ребёнка — без нового уведомления администратору
select as_user('00000000-0000-0000-0000-0000000000b1');
select lives_ok($$select request_link('00000000-0000-0000-0000-00000000d001', 'draft-2026-10')$$, 'первый запрос проходит');
reset role;
select is((select count(*)::int from notifications where kind = 'link_request'), 1, 'администратор получил одно уведомление');

select as_user('00000000-0000-0000-0000-0000000000b1');
select lives_ok($$select cancel_link((select id from link_requests where player_id = '00000000-0000-0000-0000-00000000d001'))$$, 'отмена запроса проходит');
select lives_ok($$select request_link('00000000-0000-0000-0000-00000000d001', 'draft-2026-10')$$, 'повторный запрос на того же ребёнка проходит');
select lives_ok($$select cancel_link((select id from link_requests where player_id = '00000000-0000-0000-0000-00000000d001'))$$, 'вторая отмена проходит');
select lives_ok($$select request_link('00000000-0000-0000-0000-00000000d001', 'draft-2026-10')$$, 'третий запрос на того же ребёнка проходит');
reset role;
select is((select count(*)::int from notifications where kind = 'link_request'), 1, 'в пределах часа повтор по той же паре не уведомляет администратора');

-- Пять операций за час уже сделаны; шестой запрос (другого ребёнка) отклоняется
select as_user('00000000-0000-0000-0000-0000000000b1');
select throws_ok($$select request_link('00000000-0000-0000-0000-00000000d002', 'draft-2026-10')$$, '54000', 'link request limit reached', 'шестой запрос за час отклоняется');
reset role;
select is((select count(*)::int from notifications where kind = 'link_request'), 1, 'отклонённый запрос администратору не уведомляет');

-- Через час по той же паре уведомление снова уходит (окно дедупликации истекло, счётчик лимита сброшен)
reset role;
update link_notify_log set notified_at = now() - interval '2 hours';
delete from rate_limits where key like 'link_flow:%';
select as_user('00000000-0000-0000-0000-0000000000b1');
select lives_ok($$select cancel_link((select id from link_requests where player_id = '00000000-0000-0000-0000-00000000d001'))$$, 'после окна отмена проходит');
select lives_ok($$select request_link('00000000-0000-0000-0000-00000000d001', 'draft-2026-10')$$, 'после окна родитель снова подаёт запрос');
reset role;
select is((select count(*)::int from notifications where kind = 'link_request'), 2, 'после окна уведомление по той же паре уходит снова');
select is((select count(*)::int from link_requests), 1, 'в таблице остаётся один открытый запрос');

select * from finish();
rollback;
