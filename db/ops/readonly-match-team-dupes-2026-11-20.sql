-- Только чтение. Дубли матчей U9 / U9-B (20.11.2026): матч, созданный через «Новый матч» с подтверждением, получал команду «U9»,
-- а не команду события «U9-B»; рядом лежит такой же матч, созданный через «Добавить матч». Скрипт показывает всё, что нужно,
-- чтобы решить, что оставить, а что удалить. Ничего не меняет.
-- Запуск: блоки 1 и 2 по очереди, результаты прислать в чат.

-- 1) Все матчи U9* на 14.11 и 21.11.2026 (и их события) с количеством связанных строк.
select m.id, m.team, m.opponent, m.played_on, m.starts_at, m.kind, m.lifecycle_status,
       t.id as event_id, t.name as event_name, t.team as event_team, t.kind as event_kind,
       m.goals_for, m.goals_against,
       (select count(*) from match_invitations i where i.match_id = m.id) as invitations,
       (select count(*) from match_invitations i where i.match_id = m.id and i.response is not null) as answered,
       (select count(*) from match_players p where p.match_id = m.id) as roster_rows,
       (select count(*) from match_players p where p.match_id = m.id and (p.played or p.goals > 0)) as played_rows,
       (select count(*) from match_fees f where f.match_id = m.id) as fees,
       (select count(*) from match_staff s where s.match_id = m.id) as staff,
       (select count(*) from match_activity a where a.match_id = m.id) as activity
  from matches m
  left join tournaments t on t.id = m.tournament_id
 where m.team like 'U9%' and m.played_on in (date '2026-11-14', date '2026-11-21')
 order by m.played_on, m.team, m.opponent;

-- 2) События U9 и U9-B с количеством игр (чтобы видеть, к какому событию относится «Champions 2» и «Festival»).
select t.id, t.name, t.team, t.kind, t.starts_on, t.fee,
       (select count(*) from matches m where m.tournament_id = t.id) as games,
       (select count(*) from tournament_fees f where f.tournament_id = t.id) as roster
  from tournaments t
 where t.team like 'U9%'
 order by t.starts_on desc;

-- 3) Все игры событий, у которых команда матча не совпадает с командой события (другие матчи с той же ошибкой).
select m.id, m.team as match_team, t.team as event_team, t.name as event_name, m.opponent, m.played_on, m.lifecycle_status
  from matches m join tournaments t on t.id = m.tournament_id
 where m.team is distinct from t.team
 order by m.played_on desc;
