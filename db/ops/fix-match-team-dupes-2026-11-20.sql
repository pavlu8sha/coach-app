-- Исправление дублей матчей U9 / U9-B (20.11.2026). Основание: результат readonly-match-team-dupes-2026-11-20.sql, присланный Павлом.
-- Причина: «Новый матч» с подтверждением писал матчу команду «U9» вместо команды события «U9-B» (исправлено в PR #754).
--
-- Что делает (один do-блок, всё или ничего, без begin/commit):
--   1. Удаляет пустой дубль c «Championship 2 · U9-B»: e2c81257 (U9-B vs U9-A, 21.11, без счёта, состава, взносов, приглашений).
--   2. Матч с подтверждением c0ff18c3 (U9 vs U9-A, 21.11, опубликован, 13 приглашений, 1 ответ) делает матчем чемпионата:
--      команда U9-B, kind = game, tournament_id = Championship 2 (U9-B) b4e65391. Приглашения и ответ родителя сохраняются.
--   3. Удаляет ошибочный матч 8e92e832 (U9, Tbilisi 2025, 14.11, legacy, без счёта; 24 строки состава, никто не сыграл).
-- Каждый шаг останавливается с ошибкой, если данные уже не такие, как в диагностике (ничего не удаляется и не меняется).
-- Уведомлений родителям не будет: триггеры уведомлений срабатывают на смену статуса, соперника, времени, места, адреса и заметки,
-- а здесь меняются только команда, вид и событие.
--
-- Запуск: блок 1 отдельно (только чтение, должно показать те же 4 матча), блок 2 отдельно, блок 3 отдельно.
-- Откат: у 8e92e832 и e2c81257 отката нет (пустые). У c0ff18c3 вернуть прежние значения блоком «Откат» внизу.

-- 1) Только чтение: до исправления.
select m.id, m.team, m.opponent, m.played_on, m.kind, m.lifecycle_status, m.tournament_id,
       (select count(*) from match_invitations i where i.match_id = m.id) as invitations,
       (select count(*) from match_players p where p.match_id = m.id) as roster_rows
  from matches m
 where m.id in ('8e92e832-de59-4d4e-a20c-f19801ebab27', 'e2c81257-e6ce-4f8c-852a-5c0b37635c7b', 'c0ff18c3-a04d-4850-83ca-7400e255768b')
 order by m.played_on, m.team;

-- 2) Исправление с проверками (одним запуском).
do $$
declare
  ev constant uuid := 'b4e65391-d5e4-4cd8-8537-4951de23d0ed';      -- Championship 2, U9-B
  m_tbilisi constant uuid := '8e92e832-de59-4d4e-a20c-f19801ebab27'; -- U9, Tbilisi 2025, 14.11, legacy
  m_dupe constant uuid := 'e2c81257-e6ce-4f8c-852a-5c0b37635c7b';    -- U9-B vs U9-A, 21.11, legacy, в событии
  m_rsvp constant uuid := 'c0ff18c3-a04d-4850-83ca-7400e255768b';    -- U9 vs U9-A, 21.11, с подтверждением
  r matches; n int; inv int; k int;
begin
  -- событие
  if not exists (select 1 from tournaments where id = ev and team = 'U9-B' and kind = 'championship' and name = 'Championship 2') then
    raise exception 'событие Championship 2 (U9-B) не найдено или изменилось';
  end if;

  -- шаг 1: пустой дубль в событии
  select * into r from matches where id = m_dupe for update;
  if not found then raise exception 'дубль e2c81257 не найден (возможно, уже удалён): остановлено'; end if;
  if r.team is distinct from 'U9-B' or r.opponent is distinct from 'U9-A' or r.played_on <> date '2026-11-21'
     or r.tournament_id is distinct from ev or r.lifecycle_status is distinct from 'legacy'
     or r.goals_for is not null or r.goals_against is not null then
    raise exception 'дубль e2c81257 изменился: остановлено';
  end if;
  select (select count(*) from match_players where match_id = m_dupe)
       + (select count(*) from match_fees where match_id = m_dupe)
       + (select count(*) from match_staff where match_id = m_dupe)
       + (select count(*) from match_invitations where match_id = m_dupe) into n;
  if n <> 0 then raise exception 'в дубле e2c81257 есть данные (%): остановлено, разберите вручную', n; end if;
  delete from matches where id = m_dupe;

  -- шаг 2: матч с подтверждением становится матчем чемпионата U9-B
  select * into r from matches where id = m_rsvp for update;
  if not found then raise exception 'матч c0ff18c3 не найден'; end if;
  if r.team is distinct from 'U9' or r.opponent is distinct from 'U9-A' or r.played_on <> date '2026-11-21'
     or r.kind is distinct from 'friendly' or r.tournament_id is not null or r.lifecycle_status is distinct from 'published' then
    raise exception 'матч c0ff18c3 изменился (команда %, вид %, событие %, статус %): остановлено', r.team, r.kind, r.tournament_id, r.lifecycle_status;
  end if;
  select count(*) into inv from match_invitations where match_id = m_rsvp;
  if inv <> 13 then raise exception 'у матча c0ff18c3 приглашений % вместо 13: остановлено', inv; end if;
  update matches set team = 'U9-B', kind = 'game', tournament_id = ev where id = m_rsvp;

  -- шаг 3: ошибочный матч Tbilisi 2025
  select * into r from matches where id = m_tbilisi for update;
  if not found then raise exception 'матч 8e92e832 не найден (возможно, уже удалён): остановлено'; end if;
  if r.team is distinct from 'U9' or r.opponent is distinct from 'Tbilisi 2025' or r.played_on <> date '2026-11-14'
     or r.tournament_id is not null or r.lifecycle_status is distinct from 'legacy'
     or r.goals_for is not null or r.goals_against is not null then
    raise exception 'матч 8e92e832 изменился: остановлено';
  end if;
  select count(*) into k from match_players where match_id = m_tbilisi and (played or goals > 0);
  select (select count(*) from match_fees where match_id = m_tbilisi)
       + (select count(*) from match_staff where match_id = m_tbilisi)
       + (select count(*) from match_invitations where match_id = m_tbilisi) + k into n;
  if n <> 0 then raise exception 'в матче 8e92e832 есть данные (%): остановлено, разберите вручную', n; end if;
  delete from matches where id = m_tbilisi;
end $$;

-- 3) Сверка (отдельным запуском): строки c0ff18c3 с командой U9-B, kind game, событием b4e65391 и 13 приглашениями;
--    e2c81257 и 8e92e832 отсутствуют (в списке две строки: c0ff18c3 и ничего больше).
select m.id, m.team, m.opponent, m.played_on, m.kind, m.lifecycle_status, m.tournament_id,
       (select count(*) from match_invitations i where i.match_id = m.id) as invitations
  from matches m
 where m.id in ('8e92e832-de59-4d4e-a20c-f19801ebab27', 'e2c81257-e6ce-4f8c-852a-5c0b37635c7b', 'c0ff18c3-a04d-4850-83ca-7400e255768b');

-- Откат только для c0ff18c3 (если нужно вернуть как было):
-- update matches set team = 'U9', kind = 'friendly', tournament_id = null where id = 'c0ff18c3-a04d-4850-83ca-7400e255768b';
