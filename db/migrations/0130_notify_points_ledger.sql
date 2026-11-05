-- 0130: уведомления родителю о баллах из нового журнала (#18). Решение владельца 2026-11-05: ручные баллы тренера и баллы за матчи.
--  * Уведомление «bonus» уходит при создании первой строки журнала источника manual или match; исправление (строка с supersedes_id)
--    и отмена не уведомляют, чтобы не слать повторы при правке счёта.
--  * Строки старше недели не уведомляют: так пересчёт при смене points_start или внесение старого матча не засыпает родителей.
--  * Нулевые баллы (технический результат) не уведомляют. Прежнее уведомление по point_events (0068) остаётся до отключения старого начисления.
-- Применять в SQL Editor целиком, сначала db/ops/preflight.sql.
begin;

create or replace function notify_points_ledger() returns trigger
language plpgsql security definer set search_path = public as $$
declare child text; txt text;
begin
  if new.status <> 'active' or new.supersedes_id is not null or new.points <= 0 then return null; end if;
  if new.source_type not in ('manual', 'match') then return null; end if;
  if new.event_date < tbilisi_day(now()) - 7 then return null; end if;
  select full_name into child from players where id = new.player_id;
  if new.source_type = 'manual' then
    txt := coalesce(nullif(new.components ->> 'note', ''), 'баллы от тренера');
  else
    txt := 'матч ' || to_char(new.event_date, 'DD.MM')
        || case new.components ->> 'result' when 'win' then ', победа' when 'draw' then ', ничья' else '' end;
  end if;
  perform enqueue_to_guardians(new.player_id, 'bonus', coalesce(child, 'Ребёнок') || ': +' || new.points || ' — ' || txt);
  return null;
end $$;
revoke execute on function notify_points_ledger() from public, anon, authenticated;

create trigger points_ledger_notify after insert on points_ledger
  for each row execute function notify_points_ledger();

commit;
