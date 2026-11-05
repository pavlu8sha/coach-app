-- pgTAP: перенос матча сохраняет снимок фактических отметок и счёта, затем сбрасывает их; возврат из снимка (миграция 0136).
begin;
create extension if not exists pgtap;
select plan(24);

insert into clubs (id, name) values ('00000000-0000-0000-0000-00000000c001', 'Клуб А'), ('00000000-0000-0000-0000-00000000c002', 'Клуб Б');
insert into users (id, telegram_id, display_name, is_admin) values
  ('00000000-0000-0000-0000-0000000000c1', 7601, 'Тренер А', false),
  ('00000000-0000-0000-0000-0000000000c2', 7602, 'Тренер Б', false),
  ('00000000-0000-0000-0000-0000000000b1', 7603, 'Родитель', false);
insert into groups (id, club_id, name) values
  ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-00000000c001', 'U9'),
  ('00000000-0000-0000-0000-0000000000e9', '00000000-0000-0000-0000-00000000c002', 'U9');
insert into coach_groups (user_id, group_id) values
  ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000e1'),
  ('00000000-0000-0000-0000-0000000000c2', '00000000-0000-0000-0000-0000000000e9');
insert into players (id, club_id, group_id, full_name, status) values
  ('00000000-0000-0000-0000-00000000d001', '00000000-0000-0000-0000-00000000c001', '00000000-0000-0000-0000-0000000000e1', 'Аня', 'active'),
  ('00000000-0000-0000-0000-00000000d002', '00000000-0000-0000-0000-00000000c001', '00000000-0000-0000-0000-0000000000e1', 'Боря', 'active'),
  ('00000000-0000-0000-0000-00000000d003', '00000000-0000-0000-0000-00000000c001', '00000000-0000-0000-0000-0000000000e1', 'Вера', 'active');
insert into player_guardians (player_id, user_id, consent_version, consent_given_at) values ('00000000-0000-0000-0000-00000000d001', '00000000-0000-0000-0000-0000000000b1', 't', now());
insert into tournaments (id, club_id, team, kind, name, fee, status) values
  ('00000000-0000-0000-0000-0000000000a7', '00000000-0000-0000-0000-00000000c001', 'U9', 'championship', 'Идущее', 0, 'active'),
  ('00000000-0000-0000-0000-0000000000a8', '00000000-0000-0000-0000-00000000c001', 'U9', 'championship', 'Завершённое', 0, 'finished');
insert into points_rule_versions (id, club_id, effective_from, params) values ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-00000000c001', '2026-11-01', jsonb_build_object(
  'training', jsonb_build_object('group', 1, 'individual', 2, 'goalkeeper', 2, 'extra', 2, 'moved_group', 1),
  'match', jsonb_build_object('played', 1, 'draw', 1, 'win', 2, 'goal', 1, 'best', 2, 'cap', 5, 'technical', 0),
  'manual', jsonb_build_object('values', jsonb_build_array(1, 2, 3), 'limits', jsonb_build_object('1', 3, '2', 2, '3', 1), 'month_cap', 10),
  'series', jsonb_build_object('thresholds', jsonb_build_array()),
  'group_benchmark', jsonb_build_object('min_size', 5),
  'enabled', jsonb_build_object('training', true, 'match', true, 'series', true, 'manual', true, 'benchmark', true)));

create or replace function as_user(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
end $$;
create temp table ids (k text primary key, v uuid);
grant all on ids to authenticated;
create or replace function mid(k text) returns uuid language sql stable as $$ select v from ids where ids.k = mid.k $$;
grant execute on function mid(text) to authenticated;

-- Завершённое событие
select as_user('00000000-0000-0000-0000-0000000000c1');
select throws_ok($$select match_rsvp_create_draft('00000000-0000-0000-0000-00000000c001', 'game', 'U9', 'X', now() + interval '5 days', null, null, null, '00000000-0000-0000-0000-0000000000a8')$$, '55000', 'event is finished', 'черновик для завершённого события не создаётся');
select lives_ok($$insert into ids select 'm', match_rsvp_create_draft('00000000-0000-0000-0000-00000000c001', 'game', 'U9', 'Соперник', now() + interval '3 days', null, null, null, '00000000-0000-0000-0000-0000000000a7')$$, 'для идущего создаётся');
select lives_ok($$insert into ids select 'n', match_rsvp_create_draft('00000000-0000-0000-0000-00000000c001', 'friendly', 'U9', 'Без отметок', now() + interval '3 days', null, null, null)$$, 'матч без отметок');
select match_rsvp_invite(mid('m'), array['00000000-0000-0000-0000-00000000d001', '00000000-0000-0000-0000-00000000d002', '00000000-0000-0000-0000-00000000d003']::uuid[]);
select match_rsvp_invite(mid('n'), array['00000000-0000-0000-0000-00000000d001']::uuid[]);
select match_rsvp_publish(mid('m'));
select match_rsvp_publish(mid('n'));
reset role;

-- Матч m: счёт 3:1, играли Аня (3 гола, лучший) и Боря; Вера не играла. Баллы начисляются новым журналом.
update matches set goals_for = 3, goals_against = 1 where id = mid('m');
insert into match_players (match_id, player_id, played, goals, best) values
  (mid('m'), '00000000-0000-0000-0000-00000000d001', true, 3, true),
  (mid('m'), '00000000-0000-0000-0000-00000000d002', true, 0, false),
  (mid('m'), '00000000-0000-0000-0000-00000000d003', false, 0, false);
set constraints all immediate;
select is((select count(*)::int from points_ledger where source_id = mid('m') and status = 'active'), 2, 'до переноса баллы за матч начислены двум игрокам');

-- перенос матча без отметок: снимка нет
select as_user('00000000-0000-0000-0000-0000000000c1');
select lives_ok($$select match_rsvp_reschedule(mid('n'), now() + interval '6 days')$$, 'перенос матча без отметок');
reset role;
select is((select count(*)::int from match_mark_snapshots where match_id = mid('n')), 0, 'снимок не создаётся, если отмечать было нечего');

-- перенос матча с отметками
select as_user('00000000-0000-0000-0000-0000000000b1');
select throws_ok($$select match_rsvp_restore_marks('00000000-0000-0000-0000-000000000000')$$, '42501', 'forbidden', 'родитель снимки не использует');
select as_user('00000000-0000-0000-0000-0000000000c1');
select lives_ok($$select match_rsvp_reschedule(mid('m'), now() + interval '8 days')$$, 'перенос матча с отметками');
reset role;
select is((select count(*)::int from match_mark_snapshots where match_id = mid('m')), 1, 'снимок создан');
select is((select jsonb_array_length(players) from match_mark_snapshots where match_id = mid('m')), 3, 'в снимке все строки состава');
select is((select (players->0->>'goals') || ':' || (players->0->>'best') from match_mark_snapshots where match_id = mid('m')), '3:true', 'в снимке голы и «лучший» Ани');
select is((select goals_for::text || ':' || goals_against::text from match_mark_snapshots where match_id = mid('m')), '3:1', 'в снимке счёт');
select is((select count(*)::int from match_players where match_id = mid('m')), 3, 'строки match_players не удалены');
select is((select count(*)::int from match_players where match_id = mid('m') and (played or goals <> 0 or best)), 0, 'отметки сброшены');
select ok((select goals_for is null and goals_against is null from matches where id = mid('m')), 'счёт сброшен');
set constraints all immediate;
select is((select count(*)::int from points_ledger where source_id = mid('m') and status = 'active'), 0, 'баллы за несыгранный матч пересчитаны существующими триггерами (активных нет)');
select is((select count(*)::int from points_ledger where source_id = mid('m') and status <> 'active'), 2, 'прежние начисления сохранены в журнале закрытыми строками (не удалены)');
select ok((select (payload->>'fact_marks_present')::boolean and payload->>'marks_snapshot_id' is not null from match_activity where match_id = mid('m') and action = 'rescheduled'), 'в журнале матча ссылка на снимок');

-- возврат из снимка
select as_user('00000000-0000-0000-0000-0000000000c2');
select throws_ok($$select match_rsvp_restore_marks((select id from match_mark_snapshots where match_id = mid('m')))$$, '42501', 'forbidden', 'тренер другого клуба снимок не использует');
select as_user('00000000-0000-0000-0000-0000000000c1');
select is((select count(*)::int from match_mark_snapshots where match_id = mid('m')), 1, 'тренер клуба снимок видит');
select lives_ok($$select match_rsvp_restore_marks((select id from match_mark_snapshots where match_id = mid('m')))$$, 'возврат отметок из снимка');
select throws_ok($$select match_rsvp_restore_marks((select id from match_mark_snapshots where match_id = mid('m')))$$, '55000', 'snapshot already restored', 'повторно снимок не применяется');
reset role;
select is((select goals::text || best::text from match_players where match_id = mid('m') and player_id = '00000000-0000-0000-0000-00000000d001'), '3true', 'голы и «лучший» вернулись');
select is((select goals_for::text || ':' || goals_against::text from matches where id = mid('m')), '3:1', 'счёт вернулся');

select * from finish();
rollback;
