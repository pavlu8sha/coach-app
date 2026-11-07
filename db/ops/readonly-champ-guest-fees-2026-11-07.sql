-- Только чтение (7.11.2026). Гости чемпионата/фестиваля: игрок отмечен «Играл» в матче события,
-- но не входит в заявку этого события (tournament_fees), поэтому ни взноса за событие, ни взноса за матч у него нет.
-- Запускать в SQL Editor. Ничего не меняет.

-- 1. Все такие случаи (игрок сыграл, в заявке события его нет). Колонка has_match_fee = true означает, что взнос за матч уже есть.
select m.id as match_id,
       m.played_on,
       m.team,
       m.opponent,
       t.name as event_name,
       t.kind as event_kind,
       t.fee as event_fee,
       p.id as player_id,
       p.full_name,
       g.name as player_group,
       p.status as player_status,
       mp.goals,
       exists (select 1 from match_fees mf where mf.match_id = m.id and mf.player_id = p.id) as has_match_fee,
       (select mf.amount from match_fees mf where mf.match_id = m.id and mf.player_id = p.id) as match_fee_amount,
       exists (select 1 from match_payments x where x.match_id = m.id and x.player_id = p.id) as has_match_payment
  from match_players mp
  join matches m on m.id = mp.match_id
  join tournaments t on t.id = m.tournament_id
  join players p on p.id = mp.player_id
  left join groups g on g.id = p.group_id
 where mp.played
   and t.kind in ('championship', 'festival')
   and m.kind is distinct from 'friendly'
   and not exists (
     select 1 from tournament_fees f
      where f.tournament_id = m.tournament_id and f.player_id = mp.player_id
   )
 order by m.played_on desc, p.full_name;

-- 2. Смирнов Тимофей и Кухалашвили Миша: все матчи, где они отмечены, и есть ли они в заявке события.
select p.full_name,
       m.played_on,
       m.team,
       m.opponent,
       t.name as event_name,
       t.kind as event_kind,
       mp.played,
       mp.goals,
       (select count(*) from tournament_fees f where f.tournament_id = m.tournament_id and f.player_id = p.id) as in_event_roster,
       (select f.amount from tournament_fees f where f.tournament_id = m.tournament_id and f.player_id = p.id) as roster_fee,
       (select mf.amount from match_fees mf where mf.match_id = m.id and mf.player_id = p.id) as match_fee_amount
  from match_players mp
  join players p on p.id = mp.player_id
  join matches m on m.id = mp.match_id
  left join tournaments t on t.id = m.tournament_id
 where p.full_name ilike 'Смирнов%Тимоф%'
    or p.full_name ilike 'Кухалашвили%'
 order by p.full_name, m.played_on desc;

-- 3. Заявки события, в названии которых есть U9-B или U11 (чтобы увидеть, какие списки реально есть).
select t.id, t.name, t.team, t.kind, t.starts_on, t.fee,
       (select count(*) from tournament_fees f where f.tournament_id = t.id) as roster_size
  from tournaments t
 where t.name ilike '%U9%' or t.name ilike '%U11%' or t.team ilike '%U9%' or t.team ilike '%U11%'
 order by t.starts_on desc nulls last;
