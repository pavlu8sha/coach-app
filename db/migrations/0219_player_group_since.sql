-- 0219 (docs/acceptance/group-since-2026-11-21.md): перенос начала текущей группы игрока на более раннюю дату и пересчёт баллов.
-- История групп ведётся триггером «с сегодняшнего дня»; если перевод внесли позже, начисления за прошедшие дни остались в прежней группе.
-- player_group_since(p, d, apply): только администратор. apply = false: предпросмотр без изменений.
-- Применение сдвигает границу между двумя последними интервалами на d и пересоздаёт начисления (индивидуальные, вратарские,
-- дополнительные, групповые, матчи) за [d, прежнее начало) штатными функциями points_reconcile_*: старая строка закрывается, выпускается новая.
-- Администратор только своего клуба (club_event_current_club). Ручные начисления журнала не пересоздаются. Таблицы, RLS и существующие функции не меняются.
-- Применять в SQL Editor целиком, сначала db/ops/preflight.sql.
create or replace function player_group_since(p uuid, d date, apply boolean default false) returns jsonb
language plpgsql security definer set search_path = public as $$
declare pl players; cur player_group_history; prv player_group_history; r record; rows_n int; manual_n int; before_n int; after_n int; changed int := 0;
begin
  if current_user_id() is null or not is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  if d is null then raise exception 'date required' using errcode = '22023'; end if;
  -- блокировка строки игрока: тот же замок берёт UPDATE players.group_id (обычный перевод), поэтому операции не пересекаются;
  -- границы групп читаются уже после получения замка
  select * into pl from players where id = p for update;
  if pl.id is null then raise exception 'player not found' using errcode = 'P0002'; end if;
  -- администратор только своего клуба (как club_event_*): игрок другого клуба недоступен даже для предпросмотра
  if club_event_current_club() is null or pl.club_id is distinct from club_event_current_club() then raise exception 'forbidden' using errcode = '42501'; end if;
  select * into cur from player_group_history where player_id = p and valid_to is null;
  select * into prv from player_group_history where player_id = p and valid_to = cur.valid_from order by valid_from desc limit 1;
  if cur.id is null or prv.id is null then raise exception 'no previous group' using errcode = '22023'; end if;
  if d > cur.valid_from then raise exception 'date after group start' using errcode = '22023'; end if;
  if d <= prv.valid_from then raise exception 'date before previous group start' using errcode = '22023'; end if;

  select count(*)::int, count(*) filter (where source_type = 'manual')::int into rows_n, manual_n
    from points_ledger where player_id = p and status = 'active' and event_date >= d and event_date < cur.valid_from;

  if apply and d < cur.valid_from then
    update player_group_history set valid_to = d where id = prv.id;
    update player_group_history set valid_from = d where id = cur.id;
    select count(*)::int into before_n from points_ledger where player_id = p and status <> 'active';
    for r in select distinct source_type, source_id from points_ledger
              where player_id = p and status = 'active' and event_date >= d and event_date < cur.valid_from
                and source_type in ('group_session', 'individual', 'goalkeeper', 'extra', 'match') loop
      if r.source_type = 'group_session' then perform points_reconcile_group_session(r.source_id);
      elsif r.source_type in ('individual', 'goalkeeper') then perform points_reconcile_individual(r.source_id);
      elsif r.source_type = 'extra' then perform points_reconcile_extra(r.source_id);
      else perform points_reconcile_match(r.source_id);
      end if;
    end loop;
    select count(*)::int into after_n from points_ledger where player_id = p and status <> 'active';
    changed := after_n - before_n;
  end if;

  return jsonb_build_object('from', cur.valid_from, 'to', d, 'prev_group_id', prv.group_id, 'group_id', cur.group_id,
                            'ledger_rows', rows_n, 'manual_rows', manual_n, 'changed', changed);
end $$;
revoke execute on function player_group_since(uuid, date, boolean) from public, anon;
grant execute on function player_group_since(uuid, date, boolean) to authenticated;
