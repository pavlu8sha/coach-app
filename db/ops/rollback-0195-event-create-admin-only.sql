-- ОТКАТ 0195: возвращает event_create из 0051 (создавать события могут и тренеры, взнос тренера игнорируется).
-- Сначала db/ops/preflight.sql. Вместе с откатом нужно откатить веб-приложение (кнопка «Новое событие» у тренера).
begin;
create or replace function event_create(k text, tm text, nm text, d date, fee numeric, copy_from uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare club uuid; tid uuid; amount numeric(10,2) := 0;
begin
  perform event_assert_staff();
  if k not in ('championship', 'festival', 'cup') then raise exception 'invalid kind'; end if;
  if nullif(trim(tm), '') is null then raise exception 'team required'; end if;
  select g.club_id into club from groups g where g.name = trim(tm) limit 1;
  if club is null then select c.id into club from clubs c order by c.id limit 1; end if;
  if is_admin() and fee is not null then
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
commit;
