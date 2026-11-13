-- События (чемпионат, фестиваль, кубок) создаёт только администратор (условия: docs/EVENT_CREATE_ADMIN_ONLY_ACCEPTANCE.md).
-- Тренер случайно создал чемпионат вместо матча. Тело event_create из 0051 без изменений, кроме проверки роли.
-- Список событий, состав, игры события и товарищеские матчи тренера не менялись. Откат: db/ops/rollback-0195-event-create-admin-only.sql.

create or replace function event_create(k text, tm text, nm text, d date, fee numeric, copy_from uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare club uuid; tid uuid; amount numeric(10,2) := 0;
begin
  if current_user_id() is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  if not is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  if k not in ('championship', 'festival', 'cup') then raise exception 'invalid kind'; end if;
  if nullif(trim(tm), '') is null then raise exception 'team required'; end if;
  select g.club_id into club from groups g where g.name = trim(tm) limit 1;
  if club is null then select c.id into club from clubs c order by c.id limit 1; end if;
  if fee is not null then
    if fee < 0 then raise exception 'invalid fee'; end if;
    amount := fee;
  end if;
  insert into tournaments (club_id, team, kind, name, fee, starts_on)
    values (club, trim(tm), k, nullif(trim(nm), ''), amount, d) returning id into tid;
  if copy_from is not null then
    insert into tournament_fees (tournament_id, player_id, amount)
      select tid, f.player_id, amount from tournament_fees f where f.tournament_id = copy_from
      on conflict do nothing;
  end if;
  return tid;
end $$;
revoke execute on function event_create(text, text, text, date, numeric, uuid) from public, anon;
grant execute on function event_create(text, text, text, date, numeric, uuid) to authenticated;
