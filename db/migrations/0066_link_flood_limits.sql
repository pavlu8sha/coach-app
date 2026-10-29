-- S-02: поток уведомлений администратору через request_link / cancel_link.
-- 1) Запросы и отмены на привязку — не больше 5 операций в час на пользователя (общий счётчик link_flow:<user>).
-- 2) Уведомление администратору о запросе по паре родитель–ребёнок не повторяется в пределах часа: отмена удаляет
--    строку запроса, поэтому состояние хранится в link_notify_log. Доступа у приложения нет; пишут только функции.
-- Повторная подача отклонённого запроса (retry_link) уже ограничена раз в сутки; дедупликация уведомлений действует и на неё.

create table if not exists link_notify_log (
  user_id uuid not null references users(id) on delete cascade,
  player_id uuid not null references players(id) on delete cascade,
  notified_at timestamptz not null default now(),
  primary key (user_id, player_id)
);
alter table link_notify_log enable row level security;
revoke all on link_notify_log from public, anon, authenticated;

create or replace function request_link(p uuid, consent text) returns uuid
language plpgsql security definer set search_path = public as $$
declare rid uuid;
begin
  if current_user_id() is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  if not rate_limit_hit('link_flow:' || current_user_id()::text, 5, 3600) then
    raise exception 'link request limit reached' using errcode = '54000';
  end if;
  if not exists (select 1 from consent_versions where version = consent and active) then raise exception 'consent required'; end if;
  if not exists (select 1 from players where id = p and status = 'active') then raise exception 'player not found'; end if;
  if (select count(*) from link_requests where user_id = current_user_id() and status = 'pending') >= 5 then
    raise exception 'too many pending requests';
  end if;
  insert into link_requests (user_id, player_id, consent_version, consent_given_at)
    values (current_user_id(), p, consent, now())
    on conflict (user_id, player_id) do nothing;
  select id into rid from link_requests where user_id = current_user_id() and player_id = p;
  return rid;
end $$;

create or replace function cancel_link(r uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if current_user_id() is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  if not rate_limit_hit('link_flow:' || current_user_id()::text, 5, 3600) then
    raise exception 'link request limit reached' using errcode = '54000';
  end if;
  delete from link_requests where id = r and user_id = current_user_id() and status = 'pending';
  if not found then raise exception 'request not found or already decided'; end if;
end $$;

create or replace function notify_link_request() returns trigger
language plpgsql security definer set search_path = public as $$
declare child text; grp text;
begin
  select pl.full_name, g.name into child, grp from players pl left join groups g on g.id = pl.group_id where pl.id = new.player_id;
  if (tg_op = 'INSERT' and new.status = 'pending') or (tg_op = 'UPDATE' and old.status = 'rejected' and new.status = 'pending') then
    -- не чаще одного уведомления администратору по паре родитель–ребёнок в час
    if not exists (select 1 from link_notify_log l where l.user_id = new.user_id and l.player_id = new.player_id and l.notified_at > now() - interval '1 hour') then
      insert into link_notify_log (user_id, player_id, notified_at) values (new.user_id, new.player_id, now())
        on conflict (user_id, player_id) do update set notified_at = excluded.notified_at;
      if tg_op = 'INSERT' then
        perform enqueue_to_admins('link_request', 'Новый запрос на привязку ребёнка: ' || coalesce(child, '—') || coalesce(' (' || grp || ')', '') || E'.\nОткройте приложение, вкладка «Запросы».');
      else
        perform enqueue_to_admins('link_request', 'Повторный запрос на привязку ребёнка: ' || coalesce(child, '—') || E'.\nОткройте приложение, вкладка «Запросы».');
      end if;
    end if;
  elsif tg_op = 'UPDATE' and old.status = 'pending' and new.status = 'approved' then
    perform enqueue_notification(new.user_id, 'link_decided', 'Запрос подтверждён: ' || coalesce(child, 'ребёнок') || E' привязан.\nОткройте приложение, чтобы увидеть баллы, расписание и оплату.');
  elsif tg_op = 'UPDATE' and old.status = 'pending' and new.status = 'rejected' then
    perform enqueue_notification(new.user_id, 'link_decided', 'Запрос на привязку ребёнка (' || coalesce(child, '—') || E') отклонён.\nВопросы — администратору клуба.');
  end if;
  return null;
end $$;
