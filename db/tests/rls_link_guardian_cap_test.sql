-- pgTAP: потолок 4 опекуна и проверка клуба в decide_link (миграция 0199). Условия: docs/LINK_GUARDIAN_CAP_ACCEPTANCE.md.
begin;
create extension if not exists pgtap;
select plan(11);

insert into clubs (id, name) values ('00000000-0000-0000-0000-00000000c0f1', 'Клуб А'), ('00000000-0000-0000-0000-00000000c0f2', 'Клуб Б');
insert into users (id, telegram_id, display_name, is_admin, club_id) values
  ('00000000-0000-0000-0000-0000000000f0', 9401, 'Админ', true, null),
  ('00000000-0000-0000-0000-0000000000f1', 9411, 'Р1', false, null),
  ('00000000-0000-0000-0000-0000000000f2', 9412, 'Р2', false, null),
  ('00000000-0000-0000-0000-0000000000f3', 9413, 'Р3', false, null),
  ('00000000-0000-0000-0000-0000000000f4', 9414, 'Р4', false, null),
  ('00000000-0000-0000-0000-0000000000f5', 9415, 'Р5', false, null),
  ('00000000-0000-0000-0000-0000000000f6', 9416, 'Чужой', false, '00000000-0000-0000-0000-00000000c0f2');
insert into players (id, club_id, full_name) values
  ('00000000-0000-0000-0000-00000000d0f1', '00000000-0000-0000-0000-00000000c0f1', 'Тестов Ребёнок');
insert into player_guardians (player_id, user_id, consent_version, consent_given_at) values
  ('00000000-0000-0000-0000-00000000d0f1', '00000000-0000-0000-0000-0000000000f1', 'v', now()),
  ('00000000-0000-0000-0000-00000000d0f1', '00000000-0000-0000-0000-0000000000f2', 'v', now()),
  ('00000000-0000-0000-0000-00000000d0f1', '00000000-0000-0000-0000-0000000000f3', 'v', now());
insert into link_requests (id, user_id, player_id) values
  ('00000000-0000-0000-0000-0000000a0004', '00000000-0000-0000-0000-0000000000f4', '00000000-0000-0000-0000-00000000d0f1'),
  ('00000000-0000-0000-0000-0000000a0005', '00000000-0000-0000-0000-0000000000f5', '00000000-0000-0000-0000-00000000d0f1'),
  ('00000000-0000-0000-0000-0000000a0006', '00000000-0000-0000-0000-0000000000f6', '00000000-0000-0000-0000-00000000d0f1');

create or replace function as_user(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
end $$;
select as_user('00000000-0000-0000-0000-0000000000f0');

select lives_ok($$select decide_link('00000000-0000-0000-0000-0000000a0004', true)$$, 'У2: четвёртый опекун (при трёх) подтверждается');
select throws_ok($$select decide_link('00000000-0000-0000-0000-0000000a0005', true)$$, '54000', 'guardian limit reached', 'У1: пятый опекун отклоняется');
select is((select status from link_requests where id = '00000000-0000-0000-0000-0000000a0005'), 'pending', 'У1: запрос остался «ждёт»');
select is((select count(*)::int from player_guardians where user_id = '00000000-0000-0000-0000-0000000000f5'), 0, 'У1: связь не создана');
select lives_ok($$select decide_link('00000000-0000-0000-0000-0000000a0005', false)$$, 'У5: отказ не ограничен потолком');

reset role;
update player_guardians set consent_revoked_at = now() where user_id = '00000000-0000-0000-0000-0000000000f1';
update link_requests set status = 'pending', decided_at = null where id = '00000000-0000-0000-0000-0000000a0005';
select as_user('00000000-0000-0000-0000-0000000000f0');
select lives_ok($$select decide_link('00000000-0000-0000-0000-0000000a0005', true)$$, 'У3: отозванная связь в потолок не входит');

select throws_ok($$select decide_link('00000000-0000-0000-0000-0000000a0006', true)$$, '42501', 'club mismatch', 'У4: родитель из другого клуба отклоняется');
select is((select status from link_requests where id = '00000000-0000-0000-0000-0000000a0006'), 'pending', 'У4: запрос остался «ждёт»');
select throws_ok($$select decide_link('00000000-0000-0000-0000-0000000a0004', true)$$, 'P0001', 'request not found or already decided', 'У6: повторное решение запрещено');

select as_user('00000000-0000-0000-0000-0000000000f1');
select throws_ok($$select decide_link('00000000-0000-0000-0000-0000000a0006', true)$$, '42501', 'forbidden', 'У6: не админ не может');
reset role;
select ok(has_function_privilege('authenticated', 'decide_link(uuid,boolean)', 'execute') and not has_function_privilege('anon', 'decide_link(uuid,boolean)', 'execute'), 'У7: права authenticated да, anon нет');

select * from finish();
rollback;
