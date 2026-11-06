-- Настройки уведомлений по направлениям тренировок (Issue #274, PR 1).
-- Четыре независимые настройки родителя: индивидуальная суббота, индивидуальное воскресенье, вратарская, дополнительные.
-- Общий выключатель users.notifications_enabled имеет приоритет: если он выключен, бот не пишет ничего (enqueue_notification).
-- По умолчанию: «дополнительные» включены (решение владельца); индивидуальные и вратарская включаются явно:
-- родителям первой волны администратор (PR 8), остальные включают сами после однократного информационного сообщения.
-- Сами рассылки подключаются в следующих PR; здесь только хранение настроек и помощник проверки.

create table notification_prefs (
  user_id uuid not null references users(id) on delete cascade,
  direction text not null check (direction in ('ind_sat', 'ind_sun', 'goalkeeper', 'extra')),
  enabled boolean not null,
  source text not null default 'self' check (source in ('self', 'admin')),
  updated_at timestamptz not null default now(),
  primary key (user_id, direction)
);
alter table notification_prefs enable row level security; -- политик нет: доступ только через функции ниже
revoke all on notification_prefs from public, anon, authenticated;
grant select, insert, update, delete on notification_prefs to service_role;

-- Значение по умолчанию, пока родитель настройку не менял
create or replace function notify_pref_default(d text) returns boolean
language sql immutable security definer set search_path = public as $$
  select d = 'extra'
$$;
revoke execute on function notify_pref_default(text) from public, anon, authenticated;

-- Включено ли направление у пользователя с учётом общего выключателя (он приоритетнее)
create or replace function notify_direction_enabled(u uuid, d text) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select usr.notifications_enabled from users usr where usr.id = u), false)
     and coalesce((select np.enabled from notification_prefs np where np.user_id = u and np.direction = d), notify_pref_default(d))
$$;
revoke execute on function notify_direction_enabled(uuid, text) from public, anon, authenticated;

-- Информационная рассылка по направлению: сначала настройка направления, затем общий выключатель (enqueue_notification)
create or replace function enqueue_direction_notification(u uuid, d text, k text, t text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if notify_direction_enabled(u, d) then perform enqueue_notification(u, k, t); end if;
end $$;
revoke execute on function enqueue_direction_notification(uuid, text, text, text) from public, anon, authenticated;

-- Свои настройки: все четыре направления с действующим значением
create or replace function notify_prefs_get() returns table (direction text, enabled boolean)
language plpgsql stable security definer set search_path = public as $$
begin
  if current_user_id() is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  return query
    select d.d, coalesce(np.enabled, notify_pref_default(d.d))
      from (values ('ind_sat'), ('ind_sun'), ('goalkeeper'), ('extra')) as d(d)
      left join notification_prefs np on np.user_id = current_user_id() and np.direction = d.d
     order by array_position(array['ind_sat', 'ind_sun', 'goalkeeper', 'extra'], d.d);
end $$;
revoke execute on function notify_prefs_get() from public, anon;
grant execute on function notify_prefs_get() to authenticated;

create or replace function notify_pref_set(d text, on_ boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  if current_user_id() is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  if d is null or d not in ('ind_sat', 'ind_sun', 'goalkeeper', 'extra') then raise exception 'bad direction' using errcode = '22023'; end if;
  insert into notification_prefs (user_id, direction, enabled, source) values (current_user_id(), d, coalesce(on_, false), 'self')
    on conflict (user_id, direction) do update set enabled = excluded.enabled, source = 'self', updated_at = now();
end $$;
revoke execute on function notify_pref_set(text, boolean) from public, anon;
grant execute on function notify_pref_set(text, boolean) to authenticated;
