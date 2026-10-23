-- Уведомления в Telegram (handoff, п. 6, docs/NOTIFICATIONS.md). События пишутся в очередь триггерами (существующие функции
-- не меняются), отправляет Edge Function tg-notify по расписанию. Что уведомляет:
--  * администраторов: новый запрос на привязку ребёнка (в том числе повторный), запрос на удаление данных;
--  * родителя: решение по запросу на привязку, итог запроса на удаление данных.
-- Пользователь может отключить уведомления в профиле (users.notifications_enabled).

alter table users add column notifications_enabled boolean not null default true;

create table notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  kind text not null,
  text text not null,
  state text not null default 'pending' check (state in ('pending', 'sent', 'failed')),
  attempts int not null default 0,
  claimed_at timestamptz,
  sent_at timestamptz,
  last_error text,
  created_at timestamptz not null default now()
);
create index notifications_pending on notifications (created_at) where state = 'pending';
alter table notifications enable row level security; -- политик нет: читает и пишет только служебная роль и функции ниже
revoke all on notifications from public, anon, authenticated;
grant select, insert, update, delete on notifications to service_role;

-- Поставить сообщение в очередь, если пользователь не отключил уведомления
create or replace function enqueue_notification(u uuid, k text, t text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from users where id = u and notifications_enabled) then
    insert into notifications (user_id, kind, text) values (u, k, t);
  end if;
end $$;

create or replace function enqueue_to_admins(k text, t text) returns void
language plpgsql security definer set search_path = public as $$
declare a uuid;
begin
  for a in select id from users where is_admin loop perform enqueue_notification(a, k, t); end loop;
end $$;

-- Запросы на привязку ребёнка
create or replace function notify_link_request() returns trigger
language plpgsql security definer set search_path = public as $$
declare child text; grp text;
begin
  select pl.full_name, g.name into child, grp from players pl left join groups g on g.id = pl.group_id where pl.id = new.player_id;
  if tg_op = 'INSERT' and new.status = 'pending' then
    perform enqueue_to_admins('link_request', 'Новый запрос на привязку ребёнка: ' || coalesce(child, '—') || coalesce(' (' || grp || ')', '') || E'.\nОткройте приложение, вкладка «Запросы».');
  elsif tg_op = 'UPDATE' and old.status = 'rejected' and new.status = 'pending' then
    perform enqueue_to_admins('link_request', 'Повторный запрос на привязку ребёнка: ' || coalesce(child, '—') || E'.\nОткройте приложение, вкладка «Запросы».');
  elsif tg_op = 'UPDATE' and old.status = 'pending' and new.status = 'approved' then
    perform enqueue_notification(new.user_id, 'link_decided', 'Запрос подтверждён: ' || coalesce(child, 'ребёнок') || E' привязан.\nОткройте приложение, чтобы увидеть баллы, расписание и оплату.');
  elsif tg_op = 'UPDATE' and old.status = 'pending' and new.status = 'rejected' then
    perform enqueue_notification(new.user_id, 'link_decided', 'Запрос на привязку ребёнка (' || coalesce(child, '—') || E') отклонён.\nВопросы — администратору клуба.');
  end if;
  return null;
end $$;
create trigger link_requests_notify after insert or update of status on link_requests
  for each row execute function notify_link_request();

-- Запросы на удаление данных (миграция 0025)
do $$ begin
  if to_regclass('public.data_requests') is not null then
    execute $f$
      create or replace function notify_data_request() returns trigger
      language plpgsql security definer set search_path = public as $b$
      declare who text;
      begin
        if tg_op = 'INSERT' then
          select coalesce(display_name, 'без имени') into who from users where id = new.user_id;
          perform enqueue_to_admins('data_request', 'Запрос на удаление данных от ' || who || E'.\nОткройте приложение, вкладка «Запросы».');
        elsif old.status = 'open' and new.status = 'done' then
          perform enqueue_notification(new.user_id, 'data_request_done', 'Ваш запрос на удаление данных выполнен.');
        elsif old.status = 'open' and new.status = 'rejected' then
          perform enqueue_notification(new.user_id, 'data_request_done', 'Ваш запрос на удаление данных отклонён' || coalesce(': ' || new.note, '') || E'.\nВопросы — администратору клуба.');
        end if;
        return null;
      end $b$
    $f$;
    execute 'create trigger data_requests_notify after insert or update of status on data_requests for each row execute function notify_data_request()';
  end if;
end $$;

-- Включить или выключить свои уведомления
create or replace function set_notifications(on_ boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  if current_user_id() is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  update users set notifications_enabled = coalesce(on_, true) where id = current_user_id();
end $$;

-- Для Edge Function tg-notify (только service_role): забрать пачку сообщений. Забранное на 2 минуты закрепляется за вызовом,
-- чтобы параллельные запуски не отправили одно и то же; не больше трёх попыток; отправленные старше 30 дней удаляются.
create or replace function claim_notifications(n int) returns table (id uuid, telegram_id bigint, text text)
language plpgsql security definer set search_path = public as $$
begin
  delete from notifications where state = 'sent' and sent_at < now() - interval '30 days';
  return query
    update notifications nt set attempts = nt.attempts + 1, claimed_at = now()
     where nt.id in (
       select x.id from notifications x
        where x.state = 'pending' and x.attempts < 3 and (x.claimed_at is null or x.claimed_at < now() - interval '2 minutes')
        order by x.created_at limit greatest(1, least(n, 50)) for update skip locked)
    returning nt.id, (select u.telegram_id from users u where u.id = nt.user_id), nt.text;
end $$;

-- Итог отправки. give_up = true (например, пользователь заблокировал бота) — больше не пытаться.
create or replace function finish_notification(i uuid, ok boolean, err text, give_up boolean default false) returns void
language plpgsql security definer set search_path = public as $$
begin
  if ok then
    update notifications set state = 'sent', sent_at = now(), last_error = null where id = i;
  else
    update notifications set last_error = left(err, 300), state = case when give_up or attempts >= 3 then 'failed' else 'pending' end where id = i;
  end if;
end $$;

revoke execute on function enqueue_notification(uuid, text, text), enqueue_to_admins(text, text), notify_link_request(),
  set_notifications(boolean), claim_notifications(int), finish_notification(uuid, boolean, text, boolean) from public, anon, authenticated;
grant execute on function set_notifications(boolean) to authenticated;
grant execute on function claim_notifications(int), finish_notification(uuid, boolean, text, boolean) to service_role;
