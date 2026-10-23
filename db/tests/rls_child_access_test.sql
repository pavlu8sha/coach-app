-- pgTAP: роль «Ребёнок» — доступ по коду от родителя.
begin;
create extension if not exists pgtap;
select plan(16);

insert into clubs (id, name) values ('00000000-0000-0000-0000-00000000c001', 'Клуб');
insert into users (id, telegram_id, display_name, is_admin, chosen_role) values
  ('00000000-0000-0000-0000-0000000000b1', 4201, 'Родитель А', false, 'parent'),
  ('00000000-0000-0000-0000-0000000000b2', 4202, 'Родитель Б', false, 'parent'),
  ('00000000-0000-0000-0000-0000000000d1', 4203, 'Ребёнок А', false, 'child'),
  ('00000000-0000-0000-0000-0000000000d2', 4204, 'Ребёнок Б', false, 'child'),
  ('00000000-0000-0000-0000-0000000000d3', 4205, 'Гость', false, 'guest');
insert into groups (id, club_id, name) values ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-00000000c001', 'U9');
insert into players (id, club_id, group_id, full_name) values
  ('00000000-0000-0000-0000-00000000a001', '00000000-0000-0000-0000-00000000c001', '00000000-0000-0000-0000-0000000000e1', 'Игрок А'),
  ('00000000-0000-0000-0000-00000000a002', '00000000-0000-0000-0000-00000000c001', '00000000-0000-0000-0000-0000000000e1', 'Игрок Б');
insert into player_guardians (player_id, user_id, consent_version, consent_given_at) values
  ('00000000-0000-0000-0000-00000000a001', '00000000-0000-0000-0000-0000000000b1', 'v1', now()),
  ('00000000-0000-0000-0000-00000000a002', '00000000-0000-0000-0000-0000000000b2', 'v1', now());
insert into rules (id, club_id, code, points, explanation, active_from) values ('00000000-0000-0000-0000-0000000000f0', '00000000-0000-0000-0000-00000000c001', 'x', 1, 'x', '2026-01-01');
insert into point_events (player_id, rule_id, points, source_type, occurred_on, explanation) values
  ('00000000-0000-0000-0000-00000000a001', '00000000-0000-0000-0000-0000000000f0', 3, 'coach', '2026-10-20', 'Свой'),
  ('00000000-0000-0000-0000-00000000a002', '00000000-0000-0000-0000-0000000000f0', 9, 'coach', '2026-10-20', 'Чужой');
insert into payments (player_id, amount, paid_on) values ('00000000-0000-0000-0000-00000000a001', 100, '2026-10-01');

create or replace function as_user(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
end $$;
create temp table code_a (c text);
grant all on code_a to authenticated;

select as_user('00000000-0000-0000-0000-0000000000b2');
select throws_ok($$select create_child_code('00000000-0000-0000-0000-00000000a001')$$, '42501', 'forbidden', 'код для чужого ребёнка создать нельзя');

select as_user('00000000-0000-0000-0000-0000000000b1');
insert into code_a select create_child_code('00000000-0000-0000-0000-00000000a001');
select is((select length(c) from code_a), 8, 'родитель получает код из 8 символов');
select throws_ok($$select count(*) from child_codes$$, '42501', null, 'таблица кодов закрыта для чтения');

select as_user('00000000-0000-0000-0000-0000000000d3');
select throws_ok($$select redeem_child_code((select c from code_a))$$, '42501', 'wrong role', 'гость не может ввести код');

select as_user('00000000-0000-0000-0000-0000000000d1');
select is((select count(*)::int from point_events), 0, 'до привязки баллов не видно');
select throws_ok($$select redeem_child_code('WRONGCOD')$$, '22023', 'invalid code', 'неверный код отклоняется');
select is(redeem_child_code((select c from code_a)), '00000000-0000-0000-0000-00000000a001'::uuid, 'ребёнок привязывается по коду');
select is((select array_agg(explanation) from point_events), array['Свой'], 'видны только свои баллы');
select is((select count(*)::int from players), 1, 'виден только свой игрок');
select is((select count(*)::int from payments), 0, 'оплаты ребёнку не видны');
select is((select array_agg(name) from groups), array['U9'], 'название своей группы видно');

select as_user('00000000-0000-0000-0000-0000000000d2');
select throws_ok($$select redeem_child_code((select c from code_a))$$, '22023', 'invalid code', 'код одноразовый');

select as_user('00000000-0000-0000-0000-0000000000b1');
select is(child_linked('00000000-0000-0000-0000-00000000a001'), true, 'родитель видит, что аккаунт привязан');

select revoke_consent('00000000-0000-0000-0000-00000000a001');
select as_user('00000000-0000-0000-0000-0000000000d1');
select is((select count(*)::int from point_events), 0, 'после отзыва согласия родителем доступ ребёнка закрыт');

select as_user('00000000-0000-0000-0000-0000000000b2');
select throws_ok($$select unlink_child('00000000-0000-0000-0000-00000000a001')$$, '42501', 'forbidden', 'чужой родитель не отвязывает');
select is(child_linked('00000000-0000-0000-0000-00000000a002'), false, 'у второго игрока ребёнок не привязан');

select * from finish();
rollback;
