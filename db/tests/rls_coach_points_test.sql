-- pgTAP: ручные баллы тренера и контакты родителей группы.
begin;
create extension if not exists pgtap;
select plan(21);

insert into clubs (id, name) values ('00000000-0000-0000-0000-00000000c001', 'Клуб');
insert into users (id, telegram_id, display_name, is_admin) values
  ('00000000-0000-0000-0000-0000000000a1', 7001, 'Админ', true),
  ('00000000-0000-0000-0000-0000000000c1', 7002, 'Тренер U9', false),
  ('00000000-0000-0000-0000-0000000000c2', 7003, 'Тренер U11', false),
  ('00000000-0000-0000-0000-0000000000b1', 7004, 'Мама Игрока 1', false),
  ('00000000-0000-0000-0000-0000000000b2', 7005, 'Папа Игрока 9', false),
  ('00000000-0000-0000-0000-0000000000b3', 7006, 'Бывший опекун', false);
insert into groups (id, club_id, name) values
  ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-00000000c001', 'U9'),
  ('00000000-0000-0000-0000-0000000000e2', '00000000-0000-0000-0000-00000000c001', 'U11');
insert into coach_groups (user_id, group_id) values
  ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000e1'),
  ('00000000-0000-0000-0000-0000000000c2', '00000000-0000-0000-0000-0000000000e2');
insert into players (id, club_id, group_id, full_name) values
  ('00000000-0000-0000-0000-00000000d001', '00000000-0000-0000-0000-00000000c001', '00000000-0000-0000-0000-0000000000e1', 'Игрок 1'),
  ('00000000-0000-0000-0000-00000000d009', '00000000-0000-0000-0000-00000000c001', '00000000-0000-0000-0000-0000000000e2', 'Игрок 9');
insert into player_guardians (player_id, user_id, consent_version, consent_given_at, consent_revoked_at) values
  ('00000000-0000-0000-0000-00000000d001', '00000000-0000-0000-0000-0000000000b1', 'test', now(), null),
  ('00000000-0000-0000-0000-00000000d009', '00000000-0000-0000-0000-0000000000b2', 'test', now(), null),
  ('00000000-0000-0000-0000-00000000d001', '00000000-0000-0000-0000-0000000000b3', 'test', now(), now());
insert into rules (club_id, code, points, explanation, active_from) values
  ('00000000-0000-0000-0000-00000000c001', 'coach_bonus', 1, 'Отметка тренера', '2026-01-01'),
  ('00000000-0000-0000-0000-00000000c001', 'attendance_present', 1, 'Пришёл на тренировку', '2026-01-01');
-- автоначисление, которое тренер отменять не должен
insert into point_events (id, player_id, rule_id, points, source_type, source_id, occurred_on, explanation)
  select '00000000-0000-0000-0000-0000000000ee', '00000000-0000-0000-0000-00000000d001', id, 1, 'session', gen_random_uuid(), '2026-10-19', 'Пришёл на тренировку'
  from rules where code = 'attendance_present';

create or replace function as_user(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
end $$;

-- Ручные баллы
select as_user('00000000-0000-0000-0000-0000000000c2');
select throws_ok($$select award_bonus('00000000-0000-0000-0000-00000000d001', 2, 'Молодец')$$, '42501', 'forbidden', 'тренер чужой группы не начисляет баллы');
select as_user('00000000-0000-0000-0000-0000000000b1');
select throws_ok($$select award_bonus('00000000-0000-0000-0000-00000000d001', 2, 'Сам себе')$$, '42501', 'forbidden', 'родитель не начисляет баллы');

select as_user('00000000-0000-0000-0000-0000000000c1');
select throws_ok($$insert into point_events (player_id, rule_id, points, source_type, source_id, occurred_on, explanation) select '00000000-0000-0000-0000-00000000d001', id, 100, 'coach', gen_random_uuid(), '2026-10-20', 'x' from rules limit 1$$, '42501', null, 'прямая вставка баллов тренеру закрыта');
select throws_ok($$select award_bonus('00000000-0000-0000-0000-00000000d001', 0, 'Ноль')$$, null, 'points must be between 1 and 5', '0 баллов нельзя');
select throws_ok($$select award_bonus('00000000-0000-0000-0000-00000000d001', 6, 'Много')$$, null, 'points must be between 1 and 5', 'больше 5 баллов нельзя');
select throws_ok($$select award_bonus('00000000-0000-0000-0000-00000000d001', -2, 'Штраф')$$, null, 'points must be between 1 and 5', 'отрицательные баллы нельзя');
select throws_ok($$select award_bonus('00000000-0000-0000-0000-00000000d001', 2, '   ')$$, null, 'note required', 'комментарий обязателен');
select throws_ok($$select award_bonus('00000000-0000-0000-0000-00000000d001', 2, repeat('я', 201))$$, null, 'note too long', 'комментарий не длиннее 200 знаков');
select lives_ok($$select award_bonus('00000000-0000-0000-0000-00000000d001', 3, ' Отлично играл в защите ')$$, 'тренер начисляет ручные баллы своему игроку');
select is((select points from point_events where source_type = 'coach'), 3, 'записано 3 балла');
select is((select explanation from point_events where source_type = 'coach'), 'Отлично играл в защите', 'комментарий (без пробелов по краям) — объяснение для родителя');

-- Родитель видит балл своего ребёнка; в аудите есть запись
reset role;
create temp table bonus_ids as select id from point_events where source_type = 'coach';
grant select on bonus_ids to authenticated;
select as_user('00000000-0000-0000-0000-0000000000b1');
select is((select count(*)::int from point_events where source_type = 'coach'), 1, 'родитель видит ручной балл своего ребёнка');
select as_user('00000000-0000-0000-0000-0000000000a1');
select is((select count(*)::int from audit_log where action = 'award_bonus'), 1, 'начисление записано в аудит');

-- Отмена ручного балла
select as_user('00000000-0000-0000-0000-0000000000c2');
select throws_ok($$select revoke_bonus((select id from bonus_ids))$$, '42501', 'forbidden', 'тренер чужой группы не отменяет чужой балл');
select as_user('00000000-0000-0000-0000-0000000000c1');
select throws_ok($$select revoke_bonus('00000000-0000-0000-0000-0000000000ee')$$, null, 'bonus not found', 'автоначисление отменить нельзя');
select lives_ok($$select revoke_bonus((select id from point_events where source_type = 'coach'))$$, 'тренер отменяет ошибочный ручной балл');
select is((select count(*)::int from point_events), 1, 'остаётся только автоначисление');

-- Контакты родителей
select is((select count(*)::int from group_parents('00000000-0000-0000-0000-0000000000e1')), 1, 'тренер видит родителя своей группы (без отозвавшего согласие)');
select is((select telegram_id from group_parents('00000000-0000-0000-0000-0000000000e1')), 7004::bigint, 'контакт — Telegram родителя');
select throws_ok($$select * from group_parents('00000000-0000-0000-0000-0000000000e2')$$, '42501', 'forbidden', 'контакты чужой группы тренеру недоступны');
select as_user('00000000-0000-0000-0000-0000000000b1');
select throws_ok($$select * from group_parents('00000000-0000-0000-0000-0000000000e1')$$, '42501', 'forbidden', 'родитель не видит контакты других родителей');

select * from finish();
rollback;
