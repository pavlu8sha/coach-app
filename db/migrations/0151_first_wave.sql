-- Первая волна уведомлений, однократная информация и разовая пятничная рассылка (Issue #274, PR 8).
-- Первая волна: список «ребёнок + направление» вносит администратор в интерфейсе (из Telegram-групп владельца). Родителям этих детей
-- включаются настройки направлений с источником 'admin'. Выбор самого родителя (источник 'self') не перезаписывается и не снимается.
-- Информационное сообщение при первом входе: флаг users.booking_info_seen_at, баннер без блокировки.
-- Разовая пятничная рассылка: функция ручного запуска, по умолчанию только предпросмотр; реальную отправку запускает только владелец
-- (db/ops/first_wave_friday_send.sql), повтор безопасен (один родитель получает сообщение по направлению один раз).

create table first_wave_children (
  player_id uuid not null references players(id) on delete cascade,
  direction text not null check (direction in ('ind_sat', 'ind_sun', 'goalkeeper')),
  added_by uuid references users(id) on delete set null,
  added_at timestamptz not null default now(),
  primary key (player_id, direction)
);
alter table first_wave_children enable row level security;
drop policy if exists first_wave_children_admin_read on first_wave_children;
create policy first_wave_children_admin_read on first_wave_children for select using (is_admin());
revoke all on first_wave_children from public, anon, authenticated;
grant select on first_wave_children to authenticated;

alter table users add column booking_info_seen_at timestamptz;

-- Добавить детей в направления и включить настройки их родителям. Возвращает, сколько настроек родителей включено или уже включено администратором.
create or replace function first_wave_add(dirs text[], pls uuid[]) returns int
language plpgsql security definer set search_path = public as $$
declare d text; n int := 0; k int;
begin
  if not is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  if coalesce(cardinality(dirs), 0) = 0 or coalesce(cardinality(pls), 0) = 0 then return 0; end if;
  foreach d in array dirs loop
    if d not in ('ind_sat', 'ind_sun', 'goalkeeper') then raise exception 'bad direction' using errcode = '22023'; end if;
    insert into first_wave_children (player_id, direction, added_by)
      select pl.id, d, current_user_id() from players pl where pl.id = any(pls) on conflict do nothing;
    insert into notification_prefs (user_id, direction, enabled, source)
      select distinct g.user_id, d, true, 'admin' from player_guardians g
       where g.player_id = any(pls) and g.consent_revoked_at is null
      on conflict (user_id, direction) do update set enabled = true, updated_at = now() where notification_prefs.source = 'admin';
    get diagnostics k = row_count;
    n := n + k;
  end loop;
  return n;
end $$;

-- Убрать ребёнка из направления. Настройка родителя снимается, только если её включил администратор и у родителя нет других детей в этом направлении.
create or replace function first_wave_remove(d text, p uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  delete from first_wave_children where direction = d and player_id = p;
  delete from notification_prefs np
   where np.direction = d and np.source = 'admin'
     and np.user_id in (select g.user_id from player_guardians g where g.player_id = p)
     and not exists (select 1 from first_wave_children f join player_guardians g2 on g2.player_id = f.player_id
                      where f.direction = d and g2.user_id = np.user_id and g2.consent_revoked_at is null);
end $$;

-- Список для экрана: ребёнок, направление, сколько у него родителей и у скольких настройка включена
create or replace function first_wave_list()
returns table (player_id uuid, name text, direction text, parents int, enabled int)
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  return query
  select f.player_id, pl.full_name, f.direction,
         (select count(distinct g.user_id)::int from player_guardians g where g.player_id = f.player_id and g.consent_revoked_at is null),
         (select count(distinct g.user_id)::int from player_guardians g where g.player_id = f.player_id and g.consent_revoked_at is null and notify_direction_enabled(g.user_id, f.direction))
    from first_wave_children f join players pl on pl.id = f.player_id
   order by f.direction, pl.full_name;
end $$;

-- Есть ли у ребёнка будущая запись по направлению (суббота, воскресенье, вратарская)
create or replace function first_wave_has_booking(p uuid, d text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from individual_bookings b join individual_sessions s on s.id = b.session_id
     where b.player_id = p and s.starts_at >= now() at time zone 'Asia/Tbilisi'
       and case d when 'goalkeeper' then s.goalkeepers
                  when 'ind_sat' then not s.goalkeepers and extract(isodow from s.starts_at) = 6
                  when 'ind_sun' then not s.goalkeepers and extract(isodow from s.starts_at) = 7 else false end)
$$;

-- Разовая пятничная рассылка первой волны. dry = true (по умолчанию): только считает получателей, ничего не ставит в очередь.
-- Исключает детей с уже оформленной записью по направлению, родителей с выключенным направлением или общим выключателем, и тех, кто это сообщение уже получал.
-- Реально ставит в очередь только при dry = false и включённом booking.notify (иначе sent = false).
create or replace function first_wave_friday(dry boolean default true)
returns table (direction text, recipients int, sent boolean)
language plpgsql security definer set search_path = public as $$
declare d text; c uuid; pls uuid[]; ref uuid; n int; on_ boolean; head text; lbl text;
begin
  if not is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  foreach d in array array['ind_sat', 'ind_sun', 'goalkeeper'] loop
    ref := md5('first_wave_friday:' || d)::uuid;
    lbl := case d when 'ind_sat' then 'индивидуальные тренировки в субботу' when 'ind_sun' then 'индивидуальные тренировки в воскресенье' else 'вратарские тренировки' end;
    sent := false;
    recipients := 0;
    for c in select distinct pl.club_id from first_wave_children f join players pl on pl.id = f.player_id where f.direction = d loop
      pls := array(select f.player_id from first_wave_children f join players pl on pl.id = f.player_id
                    where f.direction = d and pl.club_id = c and pl.status = 'active' and not first_wave_has_booking(f.player_id, d));
      select count(distinct g.user_id)::int into n from player_guardians g
       where g.player_id = any(pls) and g.consent_revoked_at is null and notify_direction_enabled(g.user_id, d)
         and not exists (select 1 from booking_notice_log l where l.kind = 'first_wave_friday' and l.ref_id = ref and l.user_id = g.user_id);
      recipients := recipients + n;
      if not dry and booking_notify_enabled(c) and n > 0 then
        perform booking_family_notice(c, d, 'first_wave_friday', ref, pls,
          'Запись на ' || lbl || ' теперь в приложении («Расписание» → «Запись на занятия»). Для: ',
          '. Когда откроются места, мы пришлём отдельное сообщение. Настроить уведомления можно в профиле.');
        sent := true;
      end if;
    end loop;
    direction := d;
    return next;
  end loop;
end $$;

-- Информационное сообщение при первом входе: показывать ли баннер и отметить, что показано
create or replace function booking_info_pending() returns boolean
language sql stable security definer set search_path = public as $$
  select current_user_id() is not null and booking_is_parent()
     and exists (select 1 from users u where u.id = current_user_id() and u.booking_info_seen_at is null)
$$;
create or replace function booking_info_seen() returns void
language plpgsql security definer set search_path = public as $$
begin
  if current_user_id() is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  update users set booking_info_seen_at = coalesce(booking_info_seen_at, now()) where id = current_user_id();
end $$;

revoke execute on function first_wave_has_booking(uuid, text) from public, anon, authenticated;
revoke execute on function first_wave_add(text[], uuid[]), first_wave_remove(text, uuid), first_wave_list(), first_wave_friday(boolean),
  booking_info_pending(), booking_info_seen() from public, anon;
grant execute on function first_wave_add(text[], uuid[]), first_wave_remove(text, uuid), first_wave_list(), first_wave_friday(boolean),
  booking_info_pending(), booking_info_seen() to authenticated;
