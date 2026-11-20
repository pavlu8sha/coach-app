-- 0213: при переводе игрока на «оплату за визит» недостающие визиты за уже отмеченные занятия создаются сами.
-- Было (0200): визит создаётся только триггером в момент отметки «Был». Если «за визит» выставили задним числом (например, с 01.11), то занятия, отмеченные до этого,
-- визита не получали: игрок был на тренировке, а долга за визит нет (так вышло у Fedorov Matvey и Fedorov Lev за 04.11, Kuznetsov Filipp за 02.11 и 11.11).
-- Теперь: own_visits_backfill(p) создаёт неоплаченные визиты (сумма из own_visit.fee) за занятия с отметкой «Был», дата которых не раньше pay_mode_from и не позже сегодня,
-- если строки визита ещё нет. Оплаченные и существующие строки не трогаются. Вызывается из player_set_pay_mode при переводе на per_visit и при повторном сохранении того же режима и даты (так дозаполняют уже переведённых); прямого доступа у ролей нет.
-- Тело player_set_pay_mode взято из 0200 (единственное определение: grep -lEi "function +(public\.)?player_set_pay_mode *\(" db/migrations/*.sql), добавлен только вызов.
-- Откат: db/ops/rollback-0213-own-visits-backfill.sql. Условия приёмки: docs/PAY_PER_VISIT_BACKFILL_ACCEPTANCE.md.
create or replace function own_visits_backfill(p uuid) returns int
language plpgsql security definer set search_path = public as $$
declare pl players; n int;
begin
  select * into pl from players where id = p;
  if not found or pl.pay_mode <> 'per_visit' or pl.pay_mode_from is null then return 0; end if;
  insert into own_visits (session_id, player_id, amount)
    select s.id, pl.id, own_visit_fee(g.club_id)
      from attendance a
      join sessions s on s.id = a.session_id
      join groups g on g.id = s.group_id
     where a.player_id = pl.id and a.status = 'present'
       and tbilisi_day(s.starts_at) >= pl.pay_mode_from and tbilisi_day(s.starts_at) <= tbilisi_day(now())
    on conflict do nothing;
  get diagnostics n = row_count;
  return n;
end $$;
revoke execute on function own_visits_backfill(uuid) from public, anon, authenticated;

create or replace function player_set_pay_mode(p uuid, mode text, from_d date default null) returns void
language plpgsql security definer set search_path = public as $$
declare pl players; nf date;
begin
  if current_user_id() is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  if not is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  if mode is null or mode not in ('subscription', 'per_visit') then raise exception 'bad pay mode' using errcode = '22023'; end if;
  select * into pl from players where id = p for update;
  if not found then raise exception 'player not found' using errcode = 'P0002'; end if;
  nf := case when mode = 'per_visit' then coalesce(from_d, tbilisi_day(now())) else null end;
  if nf is not null and nf > tbilisi_day(now()) then raise exception 'date in the future' using errcode = '22023'; end if;
  if pl.pay_mode = mode and pl.pay_mode_from is not distinct from nf then
    if mode = 'per_visit' then perform own_visits_backfill(p); end if;
    return;
  end if;
  update players set pay_mode = mode, pay_mode_from = nf where id = p;
  insert into audit_log (actor_id, action, entity, entity_id, before, after)
  values (current_user_id(), 'player_pay_mode', 'players', p,
          jsonb_build_object('pay_mode', pl.pay_mode, 'pay_mode_from', pl.pay_mode_from),
          jsonb_build_object('pay_mode', mode, 'pay_mode_from', nf));
  if mode = 'per_visit' then perform own_visits_backfill(p); end if;
end $$;
revoke execute on function player_set_pay_mode(uuid, text, date) from public, anon;
grant execute on function player_set_pay_mode(uuid, text, date) to authenticated;
