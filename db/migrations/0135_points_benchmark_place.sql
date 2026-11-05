-- 0135: место ребёнка в группе за месяц в анонимных ориентирах (#18, решение Павла 05.11).
--  * К каждому элементу groups добавлено поле place: место игрока по сумме баллов за месяц в этой группе по правилу 1,1,1,4
--    (равные баллы делят место, следующее пропускается): place = 1 + число игроков группы с БОЛЬШЕЙ суммой.
--  * Отдаётся только при status = ok (группа не меньше порога приватности), иначе place = null. Имён и чужих баллов функция по-прежнему не отдаёт.
--  * Остальное поведение функции points_group_benchmark не изменено (create or replace). Только чтение. Применять в SQL Editor целиком, сначала db/ops/preflight.sql.
begin;

create or replace function points_group_benchmark(p uuid, ym date) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare pl players; m0 date; m1 date; rv points_rule_versions; minsz int; g record; size int; avg numeric; mx int; plc int; personal int; mine int;
        groups jsonb := '[]'::jsonb; st text;
begin
  if current_user_id() is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  select * into pl from players where id = p;
  if pl.id is null then raise exception 'player not found' using errcode = 'P0002'; end if;
  if not (is_admin() or is_coach_of_player(p) or is_guardian_of(p) or is_self_player(p)) then raise exception 'forbidden' using errcode = '42501'; end if;
  if ym is null then raise exception 'month required' using errcode = '22023'; end if;
  m0 := ym - (extract(day from ym)::int - 1);
  m1 := (m0 + interval '1 month')::date;

  select coalesce(sum(l.points), 0) into personal from points_ledger l
    where l.player_id = p and l.status = 'active' and l.month = m0;

  rv := points_rules_for(pl.club_id, least(m1 - 1, tbilisi_day(now())));
  if rv.id is null then select * into rv from points_rule_versions v where v.club_id = pl.club_id order by v.effective_from limit 1; end if;
  minsz := coalesce((rv.params #>> '{group_benchmark,min_size}')::int, 5);

  for g in
    select l.group_id as gid, sum(l.points)::int as pts from points_ledger l
      where l.player_id = p and l.status = 'active' and l.month = m0
      group by l.group_id order by l.group_id nulls last
  loop
    st := 'ok'; avg := null; mx := null; plc := null;
    if g.gid is null then
      st := 'no_data';
    elsif rv.id is null or not coalesce((rv.params #>> '{enabled,benchmark}')::boolean, false) then
      st := 'off';
    else
      -- игроки группы в месяце: по истории групп, без ушедших до начала месяца
      with members as (
        select distinct h.player_id from player_group_history h join players x on x.id = h.player_id
         where h.group_id = g.gid and h.valid_from < m1 and (h.valid_to is null or h.valid_to > m0)
           and (x.ends_on is null or x.ends_on >= m0)
        union
        select l.player_id from points_ledger l where l.group_id = g.gid and l.status = 'active' and l.month = m0
      ), sums as (
        select m.player_id, coalesce(sum(l.points), 0)::int as pts
          from members m left join points_ledger l
            on l.player_id = m.player_id and l.group_id = g.gid and l.status = 'active' and l.month = m0
         group by m.player_id
      )
      select count(*)::int, round(avg(pts)::numeric, 1), max(pts), (count(*) filter (where pts > g.pts) + 1)::int into size, avg, mx, plc from sums;
      if size < minsz then st := 'insufficient'; avg := null; mx := null; plc := null; end if;
    end if;
    groups := groups || jsonb_build_array(jsonb_build_object(
      'group_id', g.gid, 'group_name', (select name from groups where id = g.gid), 'personal', g.pts,
      'status', st, 'avg', avg, 'max', mx, 'place', plc));
  end loop;

  return jsonb_build_object('month', m0, 'personal_total', personal, 'groups', groups);
end $$;
revoke execute on function points_group_benchmark(uuid, date) from public, anon;
grant execute on function points_group_benchmark(uuid, date) to authenticated;

commit;
