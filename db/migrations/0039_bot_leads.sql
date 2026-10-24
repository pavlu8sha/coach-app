-- Заявки новых родителей из бота («Хочу в KickStart»): черновик диалога и заявка для администратора.
-- Таблица trials (0003) — заявки; доступ только администратору (политика trials_admin, 0004). Черновик диалога лежит в
-- lead_drafts: читает и пишет только служебная роль (функция tg-bot); черновики старше двух суток удаляются при следующей заявке.
-- Статусы заявки: new → contacted → trial → joined / declined.
alter table trials
  add column if not exists telegram_id bigint,
  add column if not exists parent_name text,
  add column if not exists username text,
  add column if not exists birth_year int,
  add column if not exists note text,
  add column if not exists consent_at timestamptz,
  add column if not exists updated_at timestamptz not null default now();
create index if not exists trials_telegram on trials (telegram_id, created_at desc);

create table lead_drafts (
  telegram_id bigint primary key,
  step text not null,
  child_name text,
  birth_year int,
  phone text,
  parent_name text,
  username text,
  updated_at timestamptz not null default now()
);
alter table lead_drafts enable row level security; -- политик нет: только служебная роль
revoke all on lead_drafts from public, anon, authenticated;
grant select, insert, update, delete on lead_drafts to service_role;

-- Отправить заявку (вызывает tg-bot от имени служебной роли). Не больше 3 заявок в сутки с одного Telegram.
-- Возвращает id заявки; повторное нажатие «Отправить», пока предыдущая заявка с тем же ребёнком не старше суток, новую не создаёт.
create or replace function lead_submit(tg bigint, parent text, uname text, child text, byear int, phone text) returns uuid
language plpgsql security definer set search_path = public as $$
declare c uuid; r uuid;
begin
  if tg is null or nullif(trim(child), '') is null or char_length(child) > 80 then raise exception 'bad child' using errcode = '22023'; end if;
  if byear is null or byear < extract(year from now())::int - 18 or byear > extract(year from now())::int - 2 then raise exception 'bad year' using errcode = '22023'; end if;
  if phone is null or phone !~ '^\+?[0-9 ()\-]{7,20}$' then raise exception 'bad phone' using errcode = '22023'; end if;
  select id into c from clubs order by id limit 1;
  select id into r from trials where telegram_id = tg and lower(full_name) = lower(trim(child)) and created_at > now() - interval '1 day' limit 1;
  if r is not null then return r; end if;
  if (select count(*) from trials where telegram_id = tg and created_at > now() - interval '1 day') >= 3 then raise exception 'too many leads' using errcode = '54000'; end if;
  insert into trials (club_id, full_name, phone, source, status, telegram_id, parent_name, username, birth_year, consent_at)
  values (c, trim(child), trim(phone), 'bot', 'new', tg, left(trim(parent), 80), left(trim(uname), 40), byear, now()) returning id into r;
  delete from lead_drafts where telegram_id = tg or updated_at < now() - interval '2 days';
  perform enqueue_to_admins('lead', 'Новая заявка в клуб: ' || trim(child) || ' (' || byear || E' г.р.).\nОткройте приложение: Ещё → Заявки.');
  return r;
end $$;
revoke execute on function lead_submit(bigint, text, text, text, int, text) from public, anon, authenticated;
grant execute on function lead_submit(bigint, text, text, text, int, text) to service_role;

-- Администратор: сменить статус и заметку
create or replace function lead_set_status(i uuid, st text, nt text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  if st not in ('new', 'contacted', 'trial', 'joined', 'declined') then raise exception 'bad status' using errcode = '22023'; end if;
  update trials set status = st, note = left(nullif(trim(nt), ''), 300), updated_at = now() where id = i;
  if not found then raise exception 'not found' using errcode = 'P0002'; end if;
end $$;
revoke execute on function lead_set_status(uuid, text, text) from public, anon;
grant execute on function lead_set_status(uuid, text, text) to authenticated;
