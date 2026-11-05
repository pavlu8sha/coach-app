-- 0128: автосоздание абонементов на месяц и счётчик «у скольких игроков ещё нет строки».
-- Зачем: прошлый месяц попадает в долг только у игроков со строкой абонемента (docs/DEBT_RULES.md). Кнопку «Создать абонементы на месяц»
-- раньше нужно было помнить нажимать. Теперь 1-го числа это делает pg_cron (db/ops/subscription_month_cron.sql, включает владелец);
-- кнопка остаётся как запасной вариант (cron не сработал, игрок добавлен посреди месяца).
-- Безопасно повторять: on conflict do nothing, существующие строки не меняются. Расчёт долга не затронут.
begin;

-- Внутренняя: создаёт строки на текущий месяц по Asia/Tbilisi (или на указанный в пределах сезона). Без проверки администратора:
-- её вызывает cron от владельца базы. Снаружи недоступна (права только у владельца).
create or replace function subscription_month_auto(m date default null) returns int
language plpgsql security definer set search_path = public as $$
declare cur date := date_trunc('month', tbilisi_day(now()))::date; mm date := date_trunc('month', coalesce(m, tbilisi_day(now())))::date; n int;
begin
  if mm < debt_start() or mm > (cur + interval '1 month')::date then raise exception 'month out of range' using errcode = '22023'; end if;
  insert into subscriptions (player_id, group_id, month, amount_due)
  select pl.id, pl.group_id, mm, coalesce(tariff_for(pl.club_id, pl.group_id, mm), 0)
  from players pl join groups gr on gr.id = pl.group_id
  where pl.status = 'active' and lower(gr.name) <> 'индивидуальные / вратарские'
  on conflict (player_id, month) do nothing;
  get diagnostics n = row_count;
  return n;
end $$;
revoke execute on function subscription_month_auto(date) from public, anon, authenticated;

-- Для экрана «Должники»: сколько активных игроков с группой (кроме индивидуальных) ещё без строки абонемента за месяц.
create or replace function subscription_month_missing(m date) returns int
language plpgsql stable security definer set search_path = public as $$
declare mm date := date_trunc('month', m)::date; cur date := date_trunc('month', tbilisi_day(now()))::date; n int;
begin
  if not is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  if mm < debt_start() or mm > (cur + interval '1 month')::date then raise exception 'month out of range' using errcode = '22023'; end if;
  select count(*)::int into n
  from players pl join groups gr on gr.id = pl.group_id
  where pl.status = 'active' and lower(gr.name) <> 'индивидуальные / вратарские'
    and not exists (select 1 from subscriptions s where s.player_id = pl.id and s.month = mm);
  return n;
end $$;
revoke execute on function subscription_month_missing(date) from public, anon;
grant execute on function subscription_month_missing(date) to authenticated;

commit;
