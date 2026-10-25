-- Миграции 0028–0046 одной транзакцией. Сгенерировано scripts/make-apply-bundle.sh 0028.
-- Перед запуском выполните db/ops/preflight.sql: все номера от 0028 должны быть applied = false. После: db/ops/postcheck.sql.
begin;

-- ===== 0028_child_access.sql =====
-- 0028: роль «Ребёнок» — доступ к своим баллам и матчам по одноразовому коду от родителя.
-- Родитель (действующая связь с согласием) создаёт код для своего ребёнка; аккаунт с выбранной ролью «Ребёнок» вводит код
-- и привязывается к игроку. Видит ребёнок только своего игрока, его баллы и участие в матчах; оплаты и данные родителя закрыты.
-- Отзыв согласия родителем отключает и доступ ребёнка.

create table child_codes (
  code text primary key,
  player_id uuid not null references players(id) on delete cascade,
  created_by uuid not null references users(id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '3 days',
  used_at timestamptz
);

create table child_links (
  user_id uuid primary key references users(id) on delete cascade,
  player_id uuid not null unique references players(id) on delete cascade,
  linked_at timestamptz not null default now()
);

alter table child_codes enable row level security;  -- без политик: только через функции
alter table child_links enable row level security;
create policy child_links_read on child_links for select using (user_id = current_user_id() or is_admin());
grant select on child_links to authenticated;
grant select, insert, update, delete on child_codes, child_links to service_role;

-- Это игрок аккаунта-ребёнка, и у родителя ещё действует согласие.
create or replace function is_self_player(p uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from child_links c
    where c.player_id = p and c.user_id = current_user_id()
      and exists (select 1 from player_guardians g where g.player_id = p and g.consent_revoked_at is null)
  )
$$;
revoke execute on function is_self_player(uuid) from public, anon;
grant execute on function is_self_player(uuid) to authenticated;

drop policy if exists players_read on players;
create policy players_read on players for select
  using (is_admin() or is_coach_of_group(group_id) or is_guardian_of(id) or is_self_player(id));
drop policy if exists points_read on point_events;
create policy points_read on point_events for select
  using (is_admin() or is_coach_of_player(player_id) or is_guardian_of(player_id) or is_self_player(player_id));
drop policy if exists match_players_read on match_players;
create policy match_players_read on match_players for select
  using (is_admin() or is_guardian_of(player_id) or is_coach_of_player(player_id) or is_self_player(player_id));

-- Название своей группы видит и ребёнок (при действующем согласии родителя).
create or replace function is_guardian_in_group(g uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from players pl
    join player_guardians pg on pg.player_id = pl.id
    where pl.group_id = g and pg.consent_revoked_at is null
      and (pg.user_id = current_user_id() or exists (select 1 from child_links c where c.player_id = pl.id and c.user_id = current_user_id()))
  )
$$;

-- Родитель создаёт код для своего ребёнка (старые неиспользованные коды этого ребёнка гаснут).
create or replace function create_child_code(p uuid) returns text
language plpgsql security definer set search_path = public as $$
declare c text := ''; i int;
  alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
begin
  if current_user_id() is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  if not is_guardian_of(p) then raise exception 'forbidden' using errcode = '42501'; end if;
  delete from child_codes where player_id = p and used_at is null;
  for i in 1..8 loop c := c || substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1); end loop;
  insert into child_codes (code, player_id, created_by) values (c, p, current_user_id());
  return c;
end $$;

-- Ребёнок вводит код. Возвращает id игрока.
create or replace function redeem_child_code(c text) returns uuid
language plpgsql security definer set search_path = public as $$
declare rec child_codes; role_ text;
begin
  if current_user_id() is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  select chosen_role into role_ from users where id = current_user_id();
  if role_ is distinct from 'child' then raise exception 'wrong role' using errcode = '42501'; end if;
  select * into rec from child_codes where code = upper(trim(c)) and used_at is null and expires_at > now() for update;
  if not found then raise exception 'invalid code' using errcode = '22023'; end if;
  if not exists (select 1 from player_guardians where player_id = rec.player_id and consent_revoked_at is null) then
    raise exception 'invalid code' using errcode = '22023';
  end if;
  if exists (select 1 from child_links where player_id = rec.player_id and user_id <> current_user_id()) then
    raise exception 'already linked' using errcode = '23505';
  end if;
  insert into child_links (user_id, player_id) values (current_user_id(), rec.player_id)
    on conflict (user_id) do update set player_id = excluded.player_id, linked_at = now();
  update child_codes set used_at = now() where code = rec.code;
  insert into audit_log (actor_id, action, entity, entity_id, after)
    values (current_user_id(), 'child_link', 'child_links', rec.player_id, jsonb_build_object('player_id', rec.player_id, 'code_by', rec.created_by));
  return rec.player_id;
end $$;

-- Родитель отвязывает аккаунт ребёнка.
create or replace function unlink_child(p uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if current_user_id() is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  if not is_guardian_of(p) then raise exception 'forbidden' using errcode = '42501'; end if;
  delete from child_links where player_id = p;
  delete from child_codes where player_id = p and used_at is null;
end $$;

-- Родитель видит, привязан ли у ребёнка аккаунт (без доступа к самим таблицам).
create or replace function child_linked(p uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select is_guardian_of(p) and exists (select 1 from child_links where player_id = p)
$$;

revoke execute on function create_child_code(uuid), redeem_child_code(text), unlink_child(uuid), child_linked(uuid) from public, anon;
grant execute on function create_child_code(uuid), redeem_child_code(text), unlink_child(uuid), child_linked(uuid) to authenticated;

-- ===== 0029_child_code_hardening.sql =====
-- Укрепление кода ребёнка (0028): криптостойкая генерация и ограничение числа попыток ввода.
--  * Раньше код строился через random() (не криптостойкий). Теперь — из gen_random_uuid() (источник CSPRNG), без смещения:
--    алфавит из 32 символов, 256 делится на 32 нацело.
--  * Ввод кода ограничен: 8 попыток за 10 минут с одного аккаунта и 200 за 10 минут на весь клуб (счётчики rate_limits, 0016).
--  * Неверный или устаревший код теперь возвращает NULL, а не ошибку: ошибка откатывала бы транзакцию вместе со счётчиком
--    попыток, и ограничение не работало бы. Превышение лимита — ошибка 'too many attempts' (54000).

create or replace function create_child_code(p uuid) returns text
language plpgsql security definer set search_path = public as $$
declare c text; i int; b bytea; tries int := 0;
  alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
begin
  if current_user_id() is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  if not is_guardian_of(p) then raise exception 'forbidden' using errcode = '42501'; end if;
  delete from child_codes where player_id = p and used_at is null;
  delete from child_codes where expires_at < now() - interval '7 days'; -- чистим давно истёкшие
  loop
    b := decode(replace(gen_random_uuid()::text, '-', ''), 'hex'); -- 16 случайных байт
    c := '';
    for i in 0..7 loop c := c || substr(alphabet, (get_byte(b, i) % 32) + 1, 1); end loop;
    exit when not exists (select 1 from child_codes where code = c);
    tries := tries + 1;
    if tries > 5 then raise exception 'could not generate code'; end if;
  end loop;
  insert into child_codes (code, player_id, created_by) values (c, p, current_user_id());
  return c;
end $$;

create or replace function redeem_child_code(c text) returns uuid
language plpgsql security definer set search_path = public as $$
declare rec child_codes; role_ text; me uuid := current_user_id();
begin
  if me is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  select chosen_role into role_ from users where id = me;
  if role_ is distinct from 'child' then raise exception 'wrong role' using errcode = '42501'; end if;
  -- ограничение попыток (каждая попытка, верная и неверная, учитывается; при блокировке счётчик не растёт)
  if not rate_limit_hit('child_code:' || me, 8, 600) or not rate_limit_hit('child_code_all', 200, 600) then
    raise exception 'too many attempts' using errcode = '54000';
  end if;
  select * into rec from child_codes where code = upper(trim(coalesce(c, ''))) and used_at is null and expires_at > now() for update;
  if not found then return null; end if;
  if not exists (select 1 from player_guardians where player_id = rec.player_id and consent_revoked_at is null) then return null; end if;
  if exists (select 1 from child_links where player_id = rec.player_id and user_id <> me) then
    raise exception 'already linked' using errcode = '23505';
  end if;
  insert into child_links (user_id, player_id) values (me, rec.player_id)
    on conflict (user_id) do update set player_id = excluded.player_id, linked_at = now();
  update child_codes set used_at = now() where code = rec.code;
  insert into audit_log (actor_id, action, entity, entity_id, after)
    values (me, 'child_link', 'child_links', rec.player_id, jsonb_build_object('player_id', rec.player_id, 'code_by', rec.created_by));
  return rec.player_id;
end $$;

revoke execute on function create_child_code(uuid), redeem_child_code(text) from public, anon;
grant execute on function create_child_code(uuid), redeem_child_code(text) to authenticated;

-- ===== 0030_revoke_trigger_function.sql =====
-- Триггерная функция notify_data_request (0026) создавалась внутри do-блока уже после отзыва прав,
-- поэтому оставалась доступной ролям anon и authenticated. Напрямую её вызвать нельзя (ошибка
-- «trigger functions can only be called as triggers»), но служебным функциям это доступно ни к чему.
do $$ begin
  if to_regprocedure('public.notify_data_request()') is not null then
    execute 'revoke execute on function public.notify_data_request() from public, anon, authenticated';
  end if;
end $$;

-- ===== 0031_notifications_v2.sql =====
-- Уведомления, часть 2 (см. docs/NOTIFICATIONS.md): тренеру — о назначении группы;
-- родителю — о принятой оплате и о ручных баллах ребёнку. Получатель и так видит эти данные в приложении.
-- Родителям пишем только при действующем согласии (consent_revoked_at is null).

create or replace function enqueue_to_guardians(p uuid, k text, t text) returns void
language plpgsql security definer set search_path = public as $$
declare g uuid;
begin
  for g in select user_id from player_guardians where player_id = p and consent_revoked_at is null loop
    perform enqueue_notification(g, k, t);
  end loop;
end $$;

-- Тренеру: назначена группа
create or replace function notify_coach_group() returns trigger
language plpgsql security definer set search_path = public as $$
declare grp text;
begin
  select name into grp from groups where id = new.group_id;
  perform enqueue_notification(new.user_id, 'coach_assigned', 'Вам назначена группа ' || coalesce(grp, '—') || E'.\nОткройте приложение: вкладки «Занятия», «Матчи» и «Группа».');
  return null;
end $$;
create trigger coach_groups_notify after insert on coach_groups
  for each row execute function notify_coach_group();

-- Родителю: оплата принята (сумма с минусом — исправление, о нём не пишем)
create or replace function notify_payment() returns trigger
language plpgsql security definer set search_path = public as $$
declare child text;
begin
  if new.amount > 0 then
    select full_name into child from players where id = new.player_id;
    perform enqueue_to_guardians(new.player_id, 'payment', 'Получена оплата ' || trim(trailing '.' from trim(trailing '0' from new.amount::text)) || ' ₾ за ' || coalesce(child, 'ребёнка') || '. Спасибо!');
  end if;
  return null;
end $$;
create trigger payments_notify after insert on payments
  for each row execute function notify_payment();

-- Родителю: ручные баллы от тренера
create or replace function notify_bonus() returns trigger
language plpgsql security definer set search_path = public as $$
declare child text;
begin
  if new.source_type = 'coach' and new.points > 0 then
    select full_name into child from players where id = new.player_id;
    perform enqueue_to_guardians(new.player_id, 'bonus', coalesce(child, 'Ребёнок') || ': +' || new.points || ' — ' || coalesce(new.explanation, 'баллы от тренера'));
  end if;
  return null;
end $$;
create trigger point_events_notify after insert on point_events
  for each row execute function notify_bonus();

revoke execute on function enqueue_to_guardians(uuid, text, text), notify_coach_group(), notify_payment(), notify_bonus()
  from public, anon, authenticated;

-- ===== 0032_debt_writeoff_month.sql =====
-- Долги: «Списано» и создание абонементов на месяц (перенос из старого приложения: appDebtWrote, appCreatePayMonth).
-- Списанный долг не показывается ни администратору в «Должниках», ни родителю. Списание ставит администратор
-- (subscriptions.written_off, запись остаётся: можно снять); платежи не трогаются.
alter table subscriptions add column if not exists written_off boolean not null default false;

create or replace function parent_debts()
returns table (player_id uuid, month date, tariff numeric, paid numeric, debt numeric)
language plpgsql stable security definer set search_path = public as $$
declare cur date := date_trunc('month', tbilisi_day(now()))::date;
begin
  if current_user_id() is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  return query
  with kids as (
    select pl.id pid, pl.club_id, pl.group_id gid
    from players pl
    join player_guardians pg on pg.player_id = pl.id and pg.user_id = current_user_id() and pg.consent_revoked_at is null
    where pl.status = 'active'
      and exists (select 1 from club_settings cs where cs.club_id = pl.club_id and cs.key = 'parent_debt_enabled' and cs.value = 'true')
  ), mon as (
    select generate_series(debt_start(), cur, interval '1 month')::date m
  ), base as (
    select k.pid, k.club_id, mo.m, coalesce(s.group_id, k.gid) g, coalesce(s.discount, false) disc, coalesce(s.written_off, false) wo
    from kids k cross join mon mo
    left join subscriptions s on s.player_id = k.pid and s.month = mo.m
    where mo.m = cur or s.id is not null
  ), paid_m as (
    select p.player_id pid, date_trunc('month', p.paid_on)::date m, sum(p.amount) amt from payments p group by 1, 2
  ), calc as (
    select b.pid, b.m, tariff_for(b.club_id, b.g, b.m) t, coalesce(pm.amt, 0) pd, b.disc, b.wo
    from base b
    left join paid_m pm on pm.pid = b.pid and pm.m = b.m
    left join groups gr on gr.id = b.g
    where coalesce(lower(gr.name), '') <> 'индивидуальные / вратарские'
  )
  select c.pid, c.m, c.t, c.pd,
         case when c.wo or (c.disc and c.pd > 0) then 0::numeric else greatest(c.t - c.pd, 0) end
  from calc c where c.t is not null
  order by c.m desc, c.pid;
end $$;


create or replace function debtors(m date)
returns table (group_name text, player_id uuid, full_name text, tariff numeric, paid numeric, debt numeric, discount boolean)
language plpgsql stable security definer set search_path = public as $$
declare cur date := date_trunc('month', tbilisi_day(now()))::date; mm date := date_trunc('month', m)::date;
begin
  if not is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  if mm < debt_start() or mm > cur then raise exception 'month out of range'; end if;
  return query
  select gr.name, pl.id, pl.full_name, t.tariff, coalesce(pm.amt, 0), greatest(t.tariff - coalesce(pm.amt, 0), 0), coalesce(s.discount, false)
  from players pl
  left join subscriptions s on s.player_id = pl.id and s.month = mm
  join groups gr on gr.id = coalesce(s.group_id, pl.group_id)
  cross join lateral (select tariff_for(pl.club_id, gr.id, mm) as tariff) t
  left join lateral (select sum(p.amount) amt from payments p where p.player_id = pl.id and date_trunc('month', p.paid_on)::date = mm) pm on true
  where pl.status = 'active' and t.tariff is not null
    and lower(gr.name) <> 'индивидуальные / вратарские'
    and (mm = cur or s.id is not null)
    and coalesce(pm.amt, 0) < t.tariff
    and not (coalesce(s.discount, false) and coalesce(pm.amt, 0) > 0)
    and not coalesce(s.written_off, false)
  order by gr.name, pl.full_name;
end $$;

-- Создать строки абонементов на месяц для активных игроков с группой (кроме групп «Индивидуальные / Вратарские»).
-- Уже существующие строки не трогаются. Возвращает число созданных. Месяц: не раньше начала сезона и не позже следующего.
create or replace function create_subscription_month(m date) returns int
language plpgsql security definer set search_path = public as $$
declare mm date := date_trunc('month', m)::date; cur date := date_trunc('month', tbilisi_day(now()))::date; n int;
begin
  if not is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  if mm < debt_start() or mm > (cur + interval '1 month')::date then raise exception 'month out of range' using errcode = '22023'; end if;
  insert into subscriptions (player_id, group_id, month, amount_due)
  select pl.id, pl.group_id, mm, coalesce(tariff_for(pl.club_id, pl.group_id, mm), 0)
  from players pl join groups gr on gr.id = pl.group_id
  where pl.status = 'active' and lower(gr.name) <> 'индивидуальные / вратарские'
  on conflict (player_id, month) do nothing;
  get diagnostics n = row_count;
  return n;
end $$;
revoke execute on function create_subscription_month(date) from public, anon;
grant execute on function create_subscription_month(date) to authenticated;

-- ===== 0033_attendance_stats.sql =====
-- Статистика посещаемости по группам за период (перенос «Статистики» из старого приложения: appStatsRange).
-- Занятие считается проведённым, если на нём отмечен хотя бы один «был». Функция работает с правами вызывающего (RLS):
-- администратор видит все группы, тренер — свои. Родителям и остальным недоступна.
create or replace function attendance_stats(p_from date, p_to date)
returns table (group_id uuid, group_name text, player_id uuid, full_name text, attended int, total int)
language plpgsql stable set search_path = public as $$
begin
  if current_user_id() is null or not (is_admin() or exists (select 1 from coach_groups c where c.user_id = current_user_id())) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_from is null or p_to is null or p_from > p_to then raise exception 'bad period' using errcode = '22023'; end if;
  if p_to - p_from > 400 then raise exception 'period too large' using errcode = '22023'; end if;
  return query
  with held as (
    select s.id, s.group_id from sessions s
    where tbilisi_day(s.starts_at) between p_from and p_to
      and exists (select 1 from attendance a where a.session_id = s.id and a.status = 'present')
  ), n as (
    select h.group_id, count(*)::int total from held h group by 1
  ), roster as (
    select pl.id pid, pl.group_id gid from players pl where pl.status = 'active' and pl.group_id is not null
    union
    select a.player_id, h.group_id from attendance a join held h on h.id = a.session_id
  )
  select g.id, g.name, p.id, p.full_name,
         (select count(*)::int from attendance a join held h on h.id = a.session_id
           where a.player_id = r.pid and h.group_id = r.gid and a.status = 'present'),
         n.total
  from roster r
  join n on n.group_id = r.gid
  join groups g on g.id = r.gid
  join players p on p.id = r.pid
  order by g.name, p.full_name;
end $$;
revoke execute on function attendance_stats(date, date) from public, anon;
grant execute on function attendance_stats(date, date) to authenticated;

-- Статистика матчей за период (перенос appMatchStats): по командам — игры, победы, ничьи, поражения, голы; по игрокам — матчи и голы.
-- Работает с правами вызывающего (RLS): администратор видит все матчи, тренер — матчи своих команд. Родителям недоступна.
-- Учитываются матчи со счётом. kind = 'team' (строка команды) или 'player' (строка игрока).
create or replace function match_stats(p_from date, p_to date)
returns table (kind text, team text, name text, games int, wins int, draws int, losses int, goals_for int, goals_against int, played int, goals int)
language plpgsql stable set search_path = public as $$
begin
  if current_user_id() is null or not (is_admin() or exists (select 1 from coach_groups c where c.user_id = current_user_id())) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_from is null or p_to is null or p_from > p_to then raise exception 'bad period' using errcode = '22023'; end if;
  if p_to - p_from > 400 then raise exception 'period too large' using errcode = '22023'; end if;
  return query
  with m as (
    select x.id, x.team, x.goals_for gf, x.goals_against ga from matches x
    where x.played_on between p_from and p_to and x.goals_for is not null and x.goals_against is not null
  )
  select 'team'::text, m.team, null::text,
         count(*)::int, count(*) filter (where m.gf > m.ga)::int, count(*) filter (where m.gf = m.ga)::int, count(*) filter (where m.gf < m.ga)::int,
         sum(m.gf)::int, sum(m.ga)::int, null::int, null::int
  from m group by m.team
  union all
  select 'player'::text, m.team, p.full_name, null::int, null::int, null::int, null::int, null::int, null::int,
         count(*) filter (where mp.played)::int, coalesce(sum(mp.goals), 0)::int
  from m join match_players mp on mp.match_id = m.id join players p on p.id = mp.player_id
  where mp.played or mp.goals > 0
  group by m.team, p.id, p.full_name
  order by 1, 2, 3;
end $$;
revoke execute on function match_stats(date, date) from public, anon;
grant execute on function match_stats(date, date) to authenticated;

-- ===== 0034_individual_admin.sql =====
-- Индивидуальные и вратарские занятия для администратора (перенос из старого приложения: Individual.js).
-- Таблицы individual_sessions / individual_bookings — миграция 0008 (только администратор). Здесь: тип занятия
-- (вратари), постоянные участники и функции записи, которые держат правила в базе:
--   • оплаченную запись нельзя убрать, занятие с оплатами нельзя удалить или перенести;
--   • мест на занятии не больше настройки ind.capIndividual / ind.capGoalkeepers (если задана);
--   • сумма записи — цена kind = 'individual' на дату занятия (по умолчанию 50 ₾).
alter table individual_sessions add column if not exists goalkeepers boolean not null default false;
-- Отметка посещения записанного (null — не отмечено, true — был, false — не пришёл)
alter table individual_bookings add column if not exists attended boolean;

create table if not exists individual_regulars (
  club_id uuid not null references clubs(id),
  player_id uuid not null references players(id) on delete cascade,
  goalkeepers boolean not null default false,
  primary key (club_id, player_id, goalkeepers)
);
alter table individual_regulars enable row level security;
create policy individual_regulars_admin on individual_regulars for all using (is_admin()) with check (is_admin());
grant select, insert, update, delete on individual_regulars to authenticated, service_role;

create or replace function ind_price(c uuid, d date) returns numeric
language sql stable security definer set search_path = public as $$
  select coalesce((select amount from prices where club_id = c and kind = 'individual' and group_id is null
                      and valid_from <= date_trunc('month', d)::date and (valid_to is null or valid_to >= date_trunc('month', d)::date)
                    order by valid_from desc limit 1), 50)
$$;

create or replace function ind_cap(c uuid, gk boolean) returns int
language sql stable security definer set search_path = public as $$
  select nullif(regexp_replace(coalesce((select value from club_settings where club_id = c and key = case when gk then 'ind.capGoalkeepers' else 'ind.capIndividual' end), ''), '[^0-9]', '', 'g'), '')::int
$$;

create or replace function ind_assert_admin() returns void
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
end $$;

-- Записать игрока на занятие (внутренняя; проверки места и клуба здесь)
create or replace function ind_book(s uuid, p uuid) returns void
language plpgsql security definer set search_path = public as $$
declare ses individual_sessions; cap int; n int; pc uuid;
begin
  select * into ses from individual_sessions where id = s;
  if not found then raise exception 'session not found' using errcode = 'P0002'; end if;
  select club_id into pc from players where id = p;
  if pc is null or pc <> ses.club_id then raise exception 'player not in club' using errcode = '22023'; end if;
  if exists (select 1 from individual_bookings where session_id = s and player_id = p) then raise exception 'already booked' using errcode = '23505'; end if;
  cap := ind_cap(ses.club_id, ses.goalkeepers);
  select count(*) into n from individual_bookings where session_id = s;
  if cap is not null and n >= cap then raise exception 'session full' using errcode = '22023'; end if;
  insert into individual_bookings (session_id, player_id, amount, paid) values (s, p, ind_price(ses.club_id, ses.starts_at::date), false);
end $$;

create or replace function ind_create_session(d date, t time, gk boolean, theme text) returns uuid
language plpgsql security definer set search_path = public as $$
declare c uuid; sid uuid; ext text; r record;
begin
  perform ind_assert_admin();
  if d is null or t is null then raise exception 'date required' using errcode = '22023'; end if;
  select id into c from clubs order by id limit 1;
  ext := 'IND-' || to_char(d, 'YYYY-MM-DD') || '-' || to_char(t, 'HH24MI') || case when gk then '-GK' else '' end;
  if exists (select 1 from individual_sessions where club_id = c and external_id = ext) then raise exception 'session exists' using errcode = '23505'; end if;
  insert into individual_sessions (club_id, external_id, starts_at, topic, goalkeepers)
  values (c, ext, (d + t), nullif(trim(theme), ''), coalesce(gk, false)) returning id into sid;
  for r in select r2.player_id from individual_regulars r2 join players pl on pl.id = r2.player_id
            where r2.club_id = c and r2.goalkeepers = coalesce(gk, false) and pl.status = 'active' loop
    begin perform ind_book(sid, r.player_id); exception when others then null; end; -- переполнение мест не отменяет занятие
  end loop;
  return sid;
end $$;

create or replace function ind_add_player(s uuid, p uuid) returns void
language plpgsql security definer set search_path = public as $$
begin perform ind_assert_admin(); perform ind_book(s, p); end $$;

create or replace function ind_set_paid(s uuid, p uuid, is_paid boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform ind_assert_admin();
  update individual_bookings set paid = coalesce(is_paid, false) where session_id = s and player_id = p;
  if not found then raise exception 'booking not found' using errcode = 'P0002'; end if;
end $$;

create or replace function ind_remove_player(s uuid, p uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform ind_assert_admin();
  if exists (select 1 from individual_bookings where session_id = s and player_id = p and paid) then raise exception 'booking is paid' using errcode = '22023'; end if;
  delete from individual_bookings where session_id = s and player_id = p;
  if not found then raise exception 'booking not found' using errcode = 'P0002'; end if;
end $$;

create or replace function ind_edit_session(s uuid, d date, t time, theme text) returns void
language plpgsql security definer set search_path = public as $$
declare ses individual_sessions; ext text;
begin
  perform ind_assert_admin();
  select * into ses from individual_sessions where id = s;
  if not found then raise exception 'session not found' using errcode = 'P0002'; end if;
  if exists (select 1 from individual_bookings where session_id = s and paid) and (d + t) <> ses.starts_at then raise exception 'session has payments' using errcode = '22023'; end if;
  ext := 'IND-' || to_char(d, 'YYYY-MM-DD') || '-' || to_char(t, 'HH24MI') || case when ses.goalkeepers then '-GK' else '' end;
  if ext <> ses.external_id and exists (select 1 from individual_sessions where club_id = ses.club_id and external_id = ext) then raise exception 'session exists' using errcode = '23505'; end if;
  update individual_sessions set starts_at = (d + t), external_id = ext, topic = nullif(trim(theme), '') where id = s;
end $$;

create or replace function ind_delete_session(s uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform ind_assert_admin();
  if exists (select 1 from individual_bookings where session_id = s and paid) then raise exception 'session has payments' using errcode = '22023'; end if;
  delete from individual_sessions where id = s;
  if not found then raise exception 'session not found' using errcode = 'P0002'; end if;
end $$;

-- Отметка посещения (раздел «Отметки» старого приложения для индивидуальных и вратарей)
create or replace function ind_set_attended(s uuid, p uuid, was boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform ind_assert_admin();
  update individual_bookings set attended = was where session_id = s and player_id = p;
  if not found then raise exception 'booking not found' using errcode = 'P0002'; end if;
end $$;

-- Постоянные участники: при создании занятия записываются автоматически; кнопка «Записать постоянных» — для уже созданных
create or replace function ind_set_regular(p uuid, gk boolean, on_ boolean) returns void
language plpgsql security definer set search_path = public as $$
declare c uuid;
begin
  perform ind_assert_admin();
  select club_id into c from players where id = p;
  if c is null then raise exception 'player not found' using errcode = 'P0002'; end if;
  if on_ then insert into individual_regulars (club_id, player_id, goalkeepers) values (c, p, coalesce(gk, false)) on conflict do nothing;
  else delete from individual_regulars where club_id = c and player_id = p and goalkeepers = coalesce(gk, false); end if;
end $$;

revoke execute on function ind_price(uuid, date), ind_cap(uuid, boolean), ind_assert_admin(), ind_book(uuid, uuid) from public, anon, authenticated;
revoke execute on function ind_create_session(date, time, boolean, text), ind_add_player(uuid, uuid), ind_set_paid(uuid, uuid, boolean),
  ind_remove_player(uuid, uuid), ind_edit_session(uuid, date, time, text), ind_delete_session(uuid), ind_set_regular(uuid, boolean, boolean), ind_set_attended(uuid, uuid, boolean) from public, anon;
grant execute on function ind_create_session(date, time, boolean, text), ind_add_player(uuid, uuid), ind_set_paid(uuid, uuid, boolean),
  ind_remove_player(uuid, uuid), ind_edit_session(uuid, date, time, text), ind_delete_session(uuid), ind_set_regular(uuid, boolean, boolean), ind_set_attended(uuid, uuid, boolean) to authenticated;

-- ===== 0035_extra_sessions.sql =====
-- Дополнительные тренировки для администратора (перенос из старого приложения: Extra.js).
-- Тренировка: дата, сумма и место; записанные игроки платят отдельно. Только администратор.
-- Правила в функциях: оплаченную запись нельзя убрать, тренировку с оплатами нельзя удалить, перенести или изменить в сумме.
create table extra_sessions (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references clubs(id),
  starts_on date not null,
  amount numeric(10,2) not null default 0 check (amount >= 0),
  place text,
  unique (club_id, starts_on)
);
create table extra_bookings (
  session_id uuid not null references extra_sessions(id) on delete cascade,
  player_id uuid not null references players(id) on delete cascade,
  paid boolean not null default false,
  paid_amount numeric(10,2),
  method text,
  attended boolean, -- null — не отмечено, true — был, false — не пришёл
  primary key (session_id, player_id)
);
alter table extra_sessions enable row level security;
alter table extra_bookings enable row level security;
create policy extra_sessions_admin on extra_sessions for all using (is_admin()) with check (is_admin());
create policy extra_bookings_admin on extra_bookings for all using (is_admin()) with check (is_admin());
grant select, insert, update, delete on extra_sessions, extra_bookings to authenticated, service_role;

create or replace function extra_create_session(d date, amt numeric, plc text) returns uuid
language plpgsql security definer set search_path = public as $$
declare c uuid; sid uuid;
begin
  if not is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  if d is null then raise exception 'date required' using errcode = '22023'; end if;
  if amt is null or amt < 0 then raise exception 'bad amount' using errcode = '22023'; end if;
  select id into c from clubs order by id limit 1;
  if exists (select 1 from extra_sessions where club_id = c and starts_on = d) then raise exception 'session exists' using errcode = '23505'; end if;
  insert into extra_sessions (club_id, starts_on, amount, place) values (c, d, amt, nullif(trim(plc), '')) returning id into sid;
  return sid;
end $$;

create or replace function extra_edit_session(s uuid, d date, amt numeric, plc text) returns void
language plpgsql security definer set search_path = public as $$
declare ses extra_sessions;
begin
  if not is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  select * into ses from extra_sessions where id = s;
  if not found then raise exception 'session not found' using errcode = 'P0002'; end if;
  if amt is null or amt < 0 then raise exception 'bad amount' using errcode = '22023'; end if;
  if exists (select 1 from extra_bookings where session_id = s and paid) and (d <> ses.starts_on or amt <> ses.amount) then raise exception 'session has payments' using errcode = '22023'; end if;
  if d <> ses.starts_on and exists (select 1 from extra_sessions where club_id = ses.club_id and starts_on = d) then raise exception 'session exists' using errcode = '23505'; end if;
  update extra_sessions set starts_on = d, amount = amt, place = nullif(trim(plc), '') where id = s;
end $$;

create or replace function extra_delete_session(s uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  if exists (select 1 from extra_bookings where session_id = s and paid) then raise exception 'session has payments' using errcode = '22023'; end if;
  delete from extra_sessions where id = s;
  if not found then raise exception 'session not found' using errcode = 'P0002'; end if;
end $$;

create or replace function extra_add_player(s uuid, p uuid) returns void
language plpgsql security definer set search_path = public as $$
declare c uuid; pc uuid;
begin
  if not is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  select club_id into c from extra_sessions where id = s;
  if c is null then raise exception 'session not found' using errcode = 'P0002'; end if;
  select club_id into pc from players where id = p;
  if pc is null or pc <> c then raise exception 'player not in club' using errcode = '22023'; end if;
  if exists (select 1 from extra_bookings where session_id = s and player_id = p) then raise exception 'already booked' using errcode = '23505'; end if;
  insert into extra_bookings (session_id, player_id) values (s, p);
end $$;

create or replace function extra_remove_player(s uuid, p uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  if exists (select 1 from extra_bookings where session_id = s and player_id = p and paid) then raise exception 'booking is paid' using errcode = '22023'; end if;
  delete from extra_bookings where session_id = s and player_id = p;
  if not found then raise exception 'booking not found' using errcode = 'P0002'; end if;
end $$;

-- Оплата: по умолчанию сумма тренировки; можно указать другую. Отмена оплаты — is_paid = false.
create or replace function extra_set_paid(s uuid, p uuid, is_paid boolean, mth text default null, amt numeric default null) returns void
language plpgsql security definer set search_path = public as $$
declare ses_amt numeric;
begin
  if not is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  select amount into ses_amt from extra_sessions where id = s;
  if is_paid then
    update extra_bookings set paid = true, paid_amount = coalesce(amt, ses_amt), method = nullif(trim(mth), '') where session_id = s and player_id = p;
  else
    update extra_bookings set paid = false, paid_amount = null, method = null where session_id = s and player_id = p;
  end if;
  if not found then raise exception 'booking not found' using errcode = 'P0002'; end if;
end $$;

create or replace function extra_set_attended(s uuid, p uuid, was boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  update extra_bookings set attended = was where session_id = s and player_id = p;
  if not found then raise exception 'booking not found' using errcode = 'P0002'; end if;
end $$;

revoke execute on function extra_create_session(date, numeric, text), extra_edit_session(uuid, date, numeric, text), extra_delete_session(uuid),
  extra_add_player(uuid, uuid), extra_remove_player(uuid, uuid), extra_set_paid(uuid, uuid, boolean, text, numeric), extra_set_attended(uuid, uuid, boolean) from public, anon;
grant execute on function extra_create_session(date, numeric, text), extra_edit_session(uuid, date, numeric, text), extra_delete_session(uuid),
  extra_add_player(uuid, uuid), extra_remove_player(uuid, uuid), extra_set_paid(uuid, uuid, boolean, text, numeric), extra_set_attended(uuid, uuid, boolean) to authenticated;

-- ===== 0036_equipment_admin.sql =====
-- Экипировка для администратора (перенос из старого приложения: Equip.js, EquipIssue.js, Catalog.js).
-- Таблицы каталога и заказов — миграции 0003/0006. Здесь: выдача вещей и функции, которые держат правила в базе:
--   • сумма заказа считается по каталогу (цена на дату заказа), можно задать свою (например, скидка на полный набор);
--   • оплачено не меньше нуля и не больше суммы заказа;
--   • заказ с оплатой или выдачей удалить нельзя;
--   • номер на форме не повторяется внутри группы (u7-a и u7-b считаются одной группой «u7»).
-- Все функции — только администратор.
create table if not exists equipment_issues (
  order_id uuid not null references equipment_orders(id) on delete cascade,
  kit text not null,
  issued_on date not null default current_date,
  issued_by text,
  primary key (order_id, kit)
);
alter table equipment_issues enable row level security;
create policy equipment_issues_admin on equipment_issues for all using (is_admin()) with check (is_admin());
create policy equipment_issues_read on equipment_issues for select
  using (exists (select 1 from equipment_orders o where o.id = order_id and is_guardian_of(o.player_id)));
grant select, insert, update, delete on equipment_issues to authenticated, service_role;

create or replace function eq_assert_admin() returns void
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
end $$;

create or replace function eq_num_norm(n text) returns text
language sql immutable as $$ select nullif(regexp_replace(replace(coalesce(n, ''), '/', ','), '\s+', '', 'g'), '') $$;

-- Занят ли номер другим заказом в той же группе
create or replace function eq_number_taken(o uuid, p uuid, n text) returns boolean
language sql stable security definer set search_path = public as $$
  select eq_num_norm(n) is not null and exists (
    select 1 from equipment_orders eo
    join players pl on pl.id = eo.player_id
    join groups g on g.id = pl.group_id
    where eo.id is distinct from o and eo.player_id is distinct from p
      and eq_num_norm(eo.number) = eq_num_norm(n)
      and regexp_replace(lower(g.name), '-.*$', '') = (select regexp_replace(lower(g2.name), '-.*$', '') from players p2 join groups g2 on g2.id = p2.group_id where p2.id = p))
$$;

create or replace function eq_price(c uuid, k text, d date) returns numeric
language sql stable security definer set search_path = public as $$
  select price from equipment_catalog where club_id = c and kit = k and valid_from <= d order by valid_from desc limit 1
$$;

-- lines: [{"kit": "...", "size": "...", "quantity": 1}]
create or replace function eq_create_order(p uuid, lines jsonb, insc text, num text, inst boolean, loc text, custom_total numeric default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare c uuid; oid uuid; l jsonb; pr numeric; tot numeric := 0; q int;
begin
  perform eq_assert_admin();
  select club_id into c from players where id = p;
  if c is null then raise exception 'player not found' using errcode = 'P0002'; end if;
  if jsonb_typeof(lines) <> 'array' or jsonb_array_length(lines) = 0 then raise exception 'no items' using errcode = '22023'; end if;
  if eq_number_taken(null, p, num) then raise exception 'number taken' using errcode = '23505'; end if;
  insert into equipment_orders (club_id, player_id, ordered_on, inscription, number, installment, total, paid, location)
  values (c, p, current_date, nullif(trim(insc), ''), nullif(trim(num), ''), coalesce(inst, false), 0, 0, nullif(trim(loc), '')) returning id into oid;
  for l in select * from jsonb_array_elements(lines) loop
    pr := eq_price(c, l->>'kit', current_date);
    if pr is null then raise exception 'kit not in catalog' using errcode = '22023'; end if;
    q := coalesce((l->>'quantity')::int, 1);
    insert into equipment_order_lines (order_id, kit, size, quantity, unit_price) values (oid, l->>'kit', nullif(l->>'size', ''), q, pr);
    tot := tot + pr * q;
  end loop;
  if custom_total is not null and custom_total < 0 then raise exception 'bad amount' using errcode = '22023'; end if;
  update equipment_orders set total = coalesce(custom_total, tot) where id = oid;
  return oid;
end $$;

create or replace function eq_edit_order(o uuid, insc text, num text, inst boolean, loc text, new_total numeric) returns void
language plpgsql security definer set search_path = public as $$
declare eo equipment_orders;
begin
  perform eq_assert_admin();
  select * into eo from equipment_orders where id = o;
  if not found then raise exception 'order not found' using errcode = 'P0002'; end if;
  if new_total is null or new_total < eo.paid then raise exception 'total below paid' using errcode = '22023'; end if;
  if eq_number_taken(o, eo.player_id, num) then raise exception 'number taken' using errcode = '23505'; end if;
  update equipment_orders set inscription = nullif(trim(insc), ''), number = nullif(trim(num), ''), installment = coalesce(inst, false),
    location = nullif(trim(loc), ''), total = new_total where id = o;
end $$;

-- Платёж по заказу: положительный — оплата, отрицательный — исправление; итог между 0 и суммой заказа
create or replace function eq_add_payment(o uuid, amt numeric) returns numeric
language plpgsql security definer set search_path = public as $$
declare eo equipment_orders; np numeric;
begin
  perform eq_assert_admin();
  select * into eo from equipment_orders where id = o for update;
  if not found then raise exception 'order not found' using errcode = 'P0002'; end if;
  if amt is null or amt = 0 then raise exception 'bad amount' using errcode = '22023'; end if;
  np := eo.paid + amt;
  if np < 0 then raise exception 'paid below zero' using errcode = '22023'; end if;
  if np > eo.total then raise exception 'paid above total' using errcode = '22023'; end if;
  update equipment_orders set paid = np where id = o;
  return np;
end $$;

create or replace function eq_set_issued(o uuid, k text, on_ boolean, who text default null, d date default current_date) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform eq_assert_admin();
  if not exists (select 1 from equipment_order_lines where order_id = o and kit = k) then raise exception 'item not in order' using errcode = 'P0002'; end if;
  if on_ then
    insert into equipment_issues (order_id, kit, issued_on, issued_by) values (o, k, coalesce(d, current_date), nullif(trim(who), ''))
    on conflict (order_id, kit) do update set issued_on = excluded.issued_on, issued_by = excluded.issued_by;
  else
    delete from equipment_issues where order_id = o and kit = k;
  end if;
end $$;

create or replace function eq_delete_order(o uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform eq_assert_admin();
  if exists (select 1 from equipment_orders where id = o and paid > 0) then raise exception 'order has payments' using errcode = '22023'; end if;
  if exists (select 1 from equipment_issues where order_id = o) then raise exception 'order has issues' using errcode = '22023'; end if;
  delete from equipment_orders where id = o;
  if not found then raise exception 'order not found' using errcode = 'P0002'; end if;
end $$;

-- Каталог: новая цена позиции с даты (старые заказы остаются по старой цене)
create or replace function eq_catalog_save(k text, pr numeric, d date default current_date) returns void
language plpgsql security definer set search_path = public as $$
declare c uuid;
begin
  perform eq_assert_admin();
  if nullif(trim(k), '') is null or pr is null or pr < 0 then raise exception 'bad amount' using errcode = '22023'; end if;
  select id into c from clubs order by id limit 1;
  insert into equipment_catalog (club_id, kit, price, valid_from) values (c, trim(k), pr, coalesce(d, current_date))
  on conflict (club_id, kit, valid_from) do update set price = excluded.price;
end $$;

revoke execute on function eq_assert_admin(), eq_num_norm(text), eq_number_taken(uuid, uuid, text), eq_price(uuid, text, date) from public, anon, authenticated;
revoke execute on function eq_create_order(uuid, jsonb, text, text, boolean, text, numeric), eq_edit_order(uuid, text, text, boolean, text, numeric),
  eq_add_payment(uuid, numeric), eq_set_issued(uuid, text, boolean, text, date), eq_delete_order(uuid), eq_catalog_save(text, numeric, date) from public, anon;
grant execute on function eq_create_order(uuid, jsonb, text, text, boolean, text, numeric), eq_edit_order(uuid, text, text, boolean, text, numeric),
  eq_add_payment(uuid, numeric), eq_set_issued(uuid, text, boolean, text, date), eq_delete_order(uuid), eq_catalog_save(text, numeric, date) to authenticated;

-- ===== 0037_camps_admin.sql =====
-- Сборы для администратора (перенос из старого приложения: Camps.js).
-- Таблицы — миграции 0003/0010 (сборы, тарифы, участники, платежи; записывает только администратор).
-- Функции держат правила в базе:
--   • участник привязан к тарифу сбора; сумма по умолчанию — цена тарифа;
--   • платёж — положительная сумма, вид «бронь» или «оплата»; отмена платежа — отдельная строка с минусом (вид «возврат»),
--     ничего не удаляется, повторно отменить тот же платёж нельзя;
--   • итог по участнику не уходит ниже нуля; отказ участника ставится статусом, строка остаётся.
create or replace function camp_assert_admin() returns void
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
end $$;

create or replace function camp_save(cid uuid, nm text, loc text, d1 date, d2 date, fee numeric, fee_by date, pay_by date, act boolean) returns uuid
language plpgsql security definer set search_path = public as $$
declare c uuid; r uuid;
begin
  perform camp_assert_admin();
  if nullif(trim(nm), '') is null then raise exception 'name required' using errcode = '22023'; end if;
  if d1 is null or d2 is null or d2 < d1 then raise exception 'bad dates' using errcode = '22023'; end if;
  if fee is null or fee < 0 then raise exception 'bad amount' using errcode = '22023'; end if;
  if cid is null then
    select id into c from clubs order by id limit 1;
    insert into camps (club_id, name, location, starts_on, ends_on, booking_fee, booking_deadline, full_payment_deadline, active)
    values (c, trim(nm), nullif(trim(loc), ''), d1, d2, fee, fee_by, pay_by, coalesce(act, true)) returning id into r;
  else
    update camps set name = trim(nm), location = nullif(trim(loc), ''), starts_on = d1, ends_on = d2, booking_fee = fee,
      booking_deadline = fee_by, full_payment_deadline = pay_by, active = coalesce(act, true) where id = cid returning id into r;
    if r is null then raise exception 'camp not found' using errcode = 'P0002'; end if;
  end if;
  return r;
end $$;

-- Тариф: добавить или изменить цену и активность по названию. Тариф не удаляется (его можно снять с «активен»).
create or replace function camp_tariff_save(cid uuid, nm text, pr numeric, act boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform camp_assert_admin();
  if nullif(trim(nm), '') is null or pr is null or pr < 0 then raise exception 'bad amount' using errcode = '22023'; end if;
  if not exists (select 1 from camps where id = cid) then raise exception 'camp not found' using errcode = 'P0002'; end if;
  insert into camp_tariffs (camp_id, name, price, active) values (cid, trim(nm), pr, coalesce(act, true))
  on conflict (camp_id, name) do update set price = excluded.price, active = excluded.active;
end $$;

-- Записать игрока на сбор (если ранее отказался — вернуть статус «записан»)
create or replace function camp_register(cid uuid, p uuid, tid uuid, amt numeric, tshirt text, cmt text) returns uuid
language plpgsql security definer set search_path = public as $$
declare c uuid; pc uuid; tp numeric; r uuid; st text;
begin
  perform camp_assert_admin();
  select club_id into c from camps where id = cid;
  if c is null then raise exception 'camp not found' using errcode = 'P0002'; end if;
  select club_id into pc from players where id = p;
  if pc is null or pc <> c then raise exception 'player not in club' using errcode = '22023'; end if;
  select price into tp from camp_tariffs where id = tid and camp_id = cid and active;
  if tp is null then raise exception 'tariff not found' using errcode = 'P0002'; end if;
  if amt is not null and amt < 0 then raise exception 'bad amount' using errcode = '22023'; end if;
  select id, status into r, st from camp_participants where camp_id = cid and player_id = p;
  if r is not null and st = 'registered' then raise exception 'already registered' using errcode = '23505'; end if;
  if r is null then
    insert into camp_participants (camp_id, player_id, tariff_id, amount, tshirt_size, comment, status, registered_on)
    values (cid, p, tid, coalesce(amt, tp), nullif(trim(tshirt), ''), nullif(trim(cmt), ''), 'registered', current_date) returning id into r;
  else
    update camp_participants set tariff_id = tid, amount = coalesce(amt, tp), tshirt_size = nullif(trim(tshirt), ''), comment = nullif(trim(cmt), ''), status = 'registered' where id = r;
  end if;
  return r;
end $$;

create or replace function camp_update_participant(pid uuid, tid uuid, amt numeric, tshirt text, cmt text, st text) returns void
language plpgsql security definer set search_path = public as $$
declare cid uuid;
begin
  perform camp_assert_admin();
  select camp_id into cid from camp_participants where id = pid;
  if cid is null then raise exception 'participant not found' using errcode = 'P0002'; end if;
  if st not in ('registered', 'declined') then raise exception 'bad status' using errcode = '22023'; end if;
  if amt is null or amt < 0 then raise exception 'bad amount' using errcode = '22023'; end if;
  if tid is not null and not exists (select 1 from camp_tariffs where id = tid and camp_id = cid) then raise exception 'tariff not found' using errcode = 'P0002'; end if;
  update camp_participants set tariff_id = coalesce(tid, tariff_id), amount = amt, tshirt_size = nullif(trim(tshirt), ''), comment = nullif(trim(cmt), ''), status = st where id = pid;
end $$;

create or replace function camp_pay(pid uuid, amt numeric, k text, d date, mth text, cmt text) returns uuid
language plpgsql security definer set search_path = public as $$
declare cp camp_participants; r uuid;
begin
  perform camp_assert_admin();
  select * into cp from camp_participants where id = pid;
  if not found then raise exception 'participant not found' using errcode = 'P0002'; end if;
  if k not in ('booking', 'payment') then raise exception 'bad kind' using errcode = '22023'; end if;
  if amt is null or amt <= 0 then raise exception 'bad amount' using errcode = '22023'; end if;
  insert into camp_payments (camp_id, participant_id, player_id, amount, paid_on, kind, method, comment)
  values (cp.camp_id, pid, cp.player_id, amt, coalesce(d, current_date), k, nullif(trim(mth), ''), nullif(trim(cmt), '')) returning id into r;
  return r;
end $$;

-- Отмена платежа: строка с минусом, исходная остаётся. Повторно отменить нельзя.
create or replace function camp_cancel_payment(payid uuid) returns void
language plpgsql security definer set search_path = public as $$
declare p camp_payments; total numeric;
begin
  perform camp_assert_admin();
  select * into p from camp_payments where id = payid;
  if not found then raise exception 'payment not found' using errcode = 'P0002'; end if;
  if p.kind = 'refund' or p.amount <= 0 then raise exception 'not cancellable' using errcode = '22023'; end if;
  if exists (select 1 from camp_payments where legacy_ref = 'cancel:' || payid) then raise exception 'already cancelled' using errcode = '23505'; end if;
  select coalesce(sum(amount), 0) into total from camp_payments where participant_id = p.participant_id;
  if total - p.amount < 0 then raise exception 'paid below zero' using errcode = '22023'; end if;
  insert into camp_payments (camp_id, participant_id, player_id, amount, paid_on, kind, method, comment, legacy_ref)
  values (p.camp_id, p.participant_id, p.player_id, -p.amount, current_date, 'refund', p.method, 'Отмена платежа', 'cancel:' || payid);
end $$;

revoke execute on function camp_assert_admin() from public, anon, authenticated;
revoke execute on function camp_save(uuid, text, text, date, date, numeric, date, date, boolean), camp_tariff_save(uuid, text, numeric, boolean),
  camp_register(uuid, uuid, uuid, numeric, text, text), camp_update_participant(uuid, uuid, numeric, text, text, text),
  camp_pay(uuid, numeric, text, date, text, text), camp_cancel_payment(uuid) from public, anon;
grant execute on function camp_save(uuid, text, text, date, date, numeric, date, date, boolean), camp_tariff_save(uuid, text, numeric, boolean),
  camp_register(uuid, uuid, uuid, numeric, text, text), camp_update_participant(uuid, uuid, numeric, text, text, text),
  camp_pay(uuid, numeric, text, date, text, text), camp_cancel_payment(uuid) to authenticated;

-- ===== 0038_training_log_admin.sql =====
-- Учёт проведённых тренировок и часов тренеров для администратора (перенос из старого приложения: GamesNew.js,
-- страница «Посещаемость тренеров»). Таблица training_log — миграция 0009 (только администратор). Одна строка — один тренер
-- на одной тренировке; часы считаются по времени начала и конца. Ключ строки: дата|тренер|группа|начало|номер.
-- Правила в функциях: только администратор; будущие тренировки не подтверждаются; уже подтверждённую тренировку
-- (группа + время) повторным подтверждением не дублируем.
create or replace function tl_assert_admin() returns void
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
end $$;

create or replace function tl_hours(st time, en time) returns numeric
language sql immutable as $$ select case when st is null or en is null or en <= st then 0 else round(extract(epoch from (en - st)) / 360)::numeric / 10 end $$;

create or replace function tl_key(d date, coach text, label text, st time) returns text
language sql immutable as $$ select d::text || '|' || coach || '|' || label || '|' || coalesce(to_char(st, 'HH24:MI'), '') $$;

-- Добавить строку (тренер на тренировке)
create or replace function tl_add(d date, coach text, label text, kind text, st time, en time, loc text, is_held boolean default true) returns uuid
language plpgsql security definer set search_path = public as $$
declare c uuid; r uuid; n int; base text;
begin
  perform tl_assert_admin();
  if d is null or nullif(trim(coach), '') is null or nullif(trim(label), '') is null then raise exception 'fields required' using errcode = '22023'; end if;
  if kind not in ('Групповая', 'Индивидуальная', 'Вратарская') then raise exception 'bad kind' using errcode = '22023'; end if;
  if coalesce(is_held, true) and d > (now() at time zone 'Asia/Tbilisi')::date then raise exception 'date in the future' using errcode = '22023'; end if;
  select id into c from clubs order by id limit 1;
  base := tl_key(d, trim(coach), trim(label), st);
  select count(*) + 1 into n from training_log where club_id = c and external_id like base || '|%';
  insert into training_log (club_id, external_id, held_on, weekday, coach, location, group_label, kind, starts_at, ends_at, hours, held)
  values (c, base || '|' || n, d, (array['Пн','Вт','Ср','Чт','Пт','Сб','Вс'])[extract(isodow from d)::int], trim(coach), nullif(trim(loc), ''), trim(label), kind, st, en, tl_hours(st, en), coalesce(is_held, true))
  returning id into r;
  return r;
end $$;

-- Подтвердить плановую тренировку: по строке на каждого тренера; существующие отметки «Нет» превращаются в «Да»
create or replace function tl_confirm(d date, label text, kind text, st time, en time, loc text, coaches text[]) returns int
language plpgsql security definer set search_path = public as $$
declare c uuid; t text; done int := 0; rid uuid;
begin
  perform tl_assert_admin();
  if d is null or nullif(trim(label), '') is null or coaches is null or array_length(coaches, 1) is null then raise exception 'fields required' using errcode = '22023'; end if;
  if d > (now() at time zone 'Asia/Tbilisi')::date then raise exception 'date in the future' using errcode = '22023'; end if;
  select id into c from clubs order by id limit 1;
  if exists (select 1 from training_log where club_id = c and held_on = d and group_label = trim(label) and starts_at is not distinct from st and held) then return 0; end if;
  foreach t in array coaches loop
    continue when nullif(trim(t), '') is null;
    select id into rid from training_log where club_id = c and held_on = d and group_label = trim(label) and starts_at is not distinct from st and coach = trim(t) and not held limit 1;
    if rid is not null then
      update training_log set held = true where id = rid;
    else
      perform tl_add(d, t, label, kind, st, en, loc, true);
    end if;
    done := done + 1;
  end loop;
  return done;
end $$;

create or replace function tl_set_held(i uuid, is_held boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform tl_assert_admin();
  update training_log set held = coalesce(is_held, false) where id = i;
  if not found then raise exception 'not found' using errcode = 'P0002'; end if;
end $$;

-- Заменить тренера в строке
create or replace function tl_replace_coach(i uuid, new_coach text) returns void
language plpgsql security definer set search_path = public as $$
declare r training_log; base text; n int;
begin
  perform tl_assert_admin();
  if nullif(trim(new_coach), '') is null then raise exception 'fields required' using errcode = '22023'; end if;
  select * into r from training_log where id = i;
  if not found then raise exception 'not found' using errcode = 'P0002'; end if;
  if exists (select 1 from training_log where club_id = r.club_id and held_on = r.held_on and group_label = r.group_label and starts_at is not distinct from r.starts_at and coach = trim(new_coach) and id <> i) then
    raise exception 'coach already in' using errcode = '23505';
  end if;
  base := tl_key(r.held_on, trim(new_coach), r.group_label, r.starts_at);
  select count(*) + 1 into n from training_log where club_id = r.club_id and external_id like base || '|%';
  update training_log set coach = trim(new_coach), external_id = base || '|' || n where id = i;
end $$;

revoke execute on function tl_assert_admin(), tl_hours(time, time), tl_key(date, text, text, time) from public, anon, authenticated;
revoke execute on function tl_add(date, text, text, text, time, time, text, boolean), tl_confirm(date, text, text, time, time, text, text[]),
  tl_set_held(uuid, boolean), tl_replace_coach(uuid, text) from public, anon;
grant execute on function tl_add(date, text, text, text, time, time, text, boolean), tl_confirm(date, text, text, time, time, text, text[]),
  tl_set_held(uuid, boolean), tl_replace_coach(uuid, text) to authenticated;

-- ===== 0039_bot_leads.sql =====
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

-- ===== 0040_points_start.sql =====
-- Баллы считаются с запуска приложения (решение владельца 2026-10-24): родители не должны получить приложение с уже набранными баллами.
-- Дата старта хранится в club_settings (ключ points_start). Пока дата не задана, ограничения нет. Когда задана, баллы раньше этой даты
-- (occurred_on) не видит никто через приложение: ни родитель и ребёнок, ни тренер, ни администратор, и они не входят в рейтинг группы.
-- Записи в журнале не удаляются: историю можно вернуть, очистив дату старта.
create or replace function points_start() returns date
language sql stable security definer set search_path = public as $$
  select case when value ~ '^\d{4}-\d{2}-\d{2}$' then value::date end from club_settings where key = 'points_start' and scope = '' limit 1
$$;
revoke execute on function points_start() from public, anon;
grant execute on function points_start() to authenticated;

drop policy if exists points_read on point_events;
create policy points_read on point_events for select
  using ((is_admin() or is_coach_of_player(player_id) or is_guardian_of(player_id) or is_self_player(player_id))
         and occurred_on >= coalesce(points_start(), '-infinity'::date));

create or replace function group_rating(p_group uuid, p_season uuid default null)
returns table (group_id uuid, total_points bigint, players_count bigint)
language sql stable security definer set search_path = public as $$
  select g.id,
         coalesce(sum(e.points), 0)::bigint,
         count(distinct pl.id)::bigint
  from groups g
  join players pl on pl.group_id = g.id and pl.status = 'active'
  left join point_events e on e.player_id = pl.id and e.occurred_on >= coalesce(points_start(), '-infinity'::date)
  where g.id = p_group
    and (auth.uid() is not null)
  group by g.id
$$;

-- Администратор задаёт дату старта (null — снять ограничение)
create or replace function set_points_start(d date) returns void
language plpgsql security definer set search_path = public as $$
declare c uuid;
begin
  if not is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  select id into c from clubs order by id limit 1;
  if d is null then
    delete from club_settings where club_id = c and key = 'points_start' and scope = '';
  else
    insert into club_settings (club_id, key, value, scope, updated_at) values (c, 'points_start', to_char(d, 'YYYY-MM-DD'), '', current_date)
    on conflict (club_id, key, scope) do update set value = excluded.value, updated_at = excluded.updated_at;
  end if;
end $$;
revoke execute on function set_points_start(date) from public, anon;
grant execute on function set_points_start(date) to authenticated;

-- ===== 0041_match_tournament_labels.sql =====
-- Название и тип турнира для матчей, которые пользователь и так видит (фильтр «Турнир» на экране «Матчи»).
-- Таблица tournaments закрыта для всех, кроме администратора (там взносы), поэтому отдаём только название и тип.
-- Функция работает с правами вызывающего: список матчей ограничен политикой matches_read, турнир берётся через узкую функцию.
create or replace function tournament_label(tid uuid) returns table (name text, kind text)
language sql stable security definer set search_path = public as $$
  select t.name, t.kind from tournaments t where t.id = tid and auth.uid() is not null
$$;
revoke execute on function tournament_label(uuid) from public, anon;
grant execute on function tournament_label(uuid) to authenticated;

create or replace function match_tournaments() returns table (match_id uuid, tournament_id uuid, tournament_name text, tournament_kind text, match_kind text)
language sql stable set search_path = public as $$
  select m.id, m.tournament_id, l.name, l.kind, m.kind
  from matches m
  left join lateral tournament_label(m.tournament_id) l on m.tournament_id is not null
$$;
revoke execute on function match_tournaments() from public, anon;
grant execute on function match_tournaments() to authenticated;

-- ===== 0042_coach_all_groups.sql =====
-- Тренеры видят и ведут все группы (решение владельца 2026-10-24, как в старом приложении):
-- посещаемость любой группы (отметка), матчи всех команд с составами, участием и голами, расписание и статистика по всем группам.
-- Остаётся закрытым: взносы и платежи (только администратор), баллы чужих групп (начислять можно только своим),
-- контакты родителей (group_parents), отзыв согласий и прочее. Родителей и детей изменение не касается.
-- Добавляется просмотр журнала тренировок (кто из тренеров проводил занятия) без часов и денег: функция trainer_attendance.

create or replace function is_any_coach() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from coach_groups c where c.user_id = current_user_id())
$$;
revoke execute on function is_any_coach() from public, anon;
grant execute on function is_any_coach() to authenticated;

-- Чтение: игроки (имя, дата рождения, группа), группы, занятия, посещаемость, матчи, составы, расписание
drop policy if exists players_read on players;
create policy players_read on players for select
  using (is_admin() or is_any_coach() or is_coach_of_group(group_id) or is_guardian_of(id) or is_self_player(id));
drop policy if exists groups_read on groups;
create policy groups_read on groups for select
  using (is_admin() or is_any_coach() or is_coach_of_group(id) or is_guardian_in_group(id));
drop policy if exists sessions_read on sessions;
create policy sessions_read on sessions for select
  using (is_admin() or is_any_coach() or is_coach_of_group(group_id));
drop policy if exists attendance_read on attendance;
create policy attendance_read on attendance for select
  using (is_admin() or is_any_coach() or is_coach_of_player(player_id) or is_guardian_of(player_id));
drop policy if exists matches_read on matches;
create policy matches_read on matches for select using (
  is_admin()
  or is_any_coach()
  or can_see_team(club_id, team)
  or exists (select 1 from match_players mp where mp.match_id = matches.id and (is_guardian_of(mp.player_id) or is_coach_of_player(mp.player_id)))
);
drop policy if exists match_players_read on match_players;
create policy match_players_read on match_players for select
  using (is_admin() or is_any_coach() or is_guardian_of(player_id) or is_coach_of_player(player_id) or is_self_player(player_id));
drop policy if exists weekly_schedule_read on weekly_schedule;
create policy weekly_schedule_read on weekly_schedule for select using (
  is_admin() or is_any_coach() or is_coach_of_group(group_id) or is_guardian_in_group(group_id)
);

-- Запись: отметка посещаемости и матчи любой группы (только через функции, как и раньше)
create or replace function open_session(g uuid, d date) returns uuid
language plpgsql security definer set search_path = public as $$
declare slot time; sid uuid;
begin
  if current_user_id() is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  if not (is_admin() or is_any_coach()) then raise exception 'forbidden' using errcode = '42501'; end if;
  if d > tbilisi_day(now()) then raise exception 'date in the future'; end if;
  select starts_at into slot from weekly_schedule
   where group_id = g and weekday = extract(isodow from d)::int and kind = 'Групповая'
   order by starts_at limit 1;
  if slot is null then raise exception 'no training scheduled'; end if;
  insert into sessions (group_id, starts_at, kind, source_key)
    values (g, (d + slot) at time zone 'Asia/Tbilisi', 'training', 'ATT|' || d)
    on conflict (group_id, source_key) do nothing;
  select id into sid from sessions where group_id = g and source_key = 'ATT|' || d;
  return sid;
end $$;
create or replace function mark_attendance(s uuid, marks jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare sess sessions; m jsonb; pid uuid; st text; rl rules; day date; club uuid;
begin
  if current_user_id() is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  select * into sess from sessions where id = s;
  if sess.id is null then raise exception 'session not found'; end if;
  if not (is_admin() or is_any_coach()) then raise exception 'forbidden' using errcode = '42501'; end if;
  if jsonb_typeof(marks) <> 'array' then raise exception 'marks must be an array'; end if;
  day := tbilisi_day(sess.starts_at);
  select club_id into club from groups where id = sess.group_id;
  select * into rl from rules
   where club_id = club and code = 'attendance_present' and active_from <= day and (active_to is null or active_to >= day)
   order by version desc limit 1;
  if rl.id is null then raise exception 'rule attendance_present not found'; end if;

  for m in select * from jsonb_array_elements(marks) loop
    pid := (m->>'player_id')::uuid;
    st := m->>'status';
    if st not in ('present', 'absent', 'excused') then raise exception 'invalid status'; end if;
    if not exists (select 1 from players where id = pid and group_id = sess.group_id) then raise exception 'player not in group'; end if;
    insert into attendance (session_id, player_id, status, marked_by, marked_at)
      values (s, pid, st, current_user_id(), now())
      on conflict (session_id, player_id) do update set status = excluded.status, marked_by = excluded.marked_by, marked_at = excluded.marked_at;
    if st = 'present' then
      if rl.points <> 0 then
        insert into point_events (player_id, rule_id, points, source_type, source_id, occurred_on, explanation)
          values (pid, rl.id, rl.points, 'session', s, day, rl.explanation)
          on conflict (player_id, rule_id, source_type, source_id) do nothing;
      end if;
    else
      delete from point_events where player_id = pid and rule_id = rl.id and source_type = 'session' and source_id = s;
    end if;
  end loop;
end $$;
create or replace function save_match(m uuid, g uuid, d date, opp text, gf int, ga int, roster jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare grp groups; mt matches; el jsonb; pid uuid; v_played boolean; v_goals int; v_best boolean; bests int := 0;
        club uuid; adm boolean := is_admin();
begin
  if current_user_id() is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  if g is not null then
    select * into grp from groups where id = g;
    if grp.id is null then raise exception 'group not found'; end if;
    club := grp.club_id;
  end if;
  if m is not null then
    select * into mt from matches where id = m;
    if mt.id is null then raise exception 'match not found'; end if;
    club := mt.club_id;
  elsif g is null then
    raise exception 'group required';
  end if;
  if not adm and not (g is not null and is_any_coach()) then raise exception 'forbidden' using errcode = '42501'; end if;
  if (gf is null) <> (ga is null) then raise exception 'score incomplete'; end if;
  if gf < 0 or ga < 0 then raise exception 'invalid score'; end if;
  if gf is not null and d > tbilisi_day(now()) then raise exception 'result for future match'; end if;
  if jsonb_typeof(roster) <> 'array' then raise exception 'roster must be an array'; end if;

  if m is null then
    insert into matches (club_id, played_on, team, opponent, goals_for, goals_against)
      values (club, d, grp.name, nullif(trim(opp), ''), gf, ga) returning * into mt;
  else
    if not adm and (mt.club_id <> grp.club_id or mt.team <> grp.name) then raise exception 'match is not of this group' using errcode = '42501'; end if;
    update matches set played_on = d, opponent = nullif(trim(opp), ''), goals_for = gf, goals_against = ga where id = m returning * into mt;
  end if;

  -- лучший игрок один: прежнего снимаем, если в составе назван новый
  if exists (select 1 from jsonb_array_elements(roster) e where coalesce((e->>'best')::boolean, false)) then
    update match_players set best = false where match_id = mt.id and best;
  end if;

  for el in select * from jsonb_array_elements(roster) loop
    pid := (el->>'player_id')::uuid;
    v_played := coalesce((el->>'played')::boolean, false);
    v_goals := coalesce((el->>'goals')::int, 0);
    v_best := coalesce((el->>'best')::boolean, false);
    if v_goals < 0 then raise exception 'invalid goals'; end if;
    if v_goals > 0 and not v_played then raise exception 'goals without playing'; end if;
    if v_best and not v_played then raise exception 'best player must have played'; end if;
    if v_best then bests := bests + 1; end if;
    if bests > 1 then raise exception 'only one best player'; end if;
    if adm then
      if not exists (select 1 from players where id = pid and club_id = club) then raise exception 'player not in club'; end if;
    elsif not (exists (select 1 from players where id = pid and group_id = g) or exists (select 1 from match_fees where match_id = mt.id and player_id = pid)) then
      raise exception 'player not in group';
    end if;
    insert into match_players (match_id, player_id, played, goals, best) values (mt.id, pid, v_played, v_goals, v_best)
      on conflict (match_id, player_id) do update set played = excluded.played, goals = excluded.goals, best = excluded.best;
  end loop;

  if gf is not null and (select coalesce(sum(goals), 0) from match_players where match_id = mt.id and played) > gf then
    raise exception 'goals exceed team score';
  end if;
  perform apply_match_points(mt.id);
  return mt.id;
end $$;

-- Журнал тренировок для тренеров: только просмотр, без часов (hours) и денег
create or replace function trainer_attendance(p_from date, p_to date)
returns table (held_on date, coach text, group_label text, kind text, starts_at time, ends_at time, location text, held boolean)
language plpgsql stable security definer set search_path = public as $$
begin
  if current_user_id() is null or not (is_admin() or is_any_coach()) then raise exception 'forbidden' using errcode = '42501'; end if;
  if p_from is null or p_to is null or p_from > p_to then raise exception 'bad period' using errcode = '22023'; end if;
  if p_to - p_from > 400 then raise exception 'period too large' using errcode = '22023'; end if;
  return query
  select l.held_on, l.coach, l.group_label, l.kind, l.starts_at, l.ends_at, l.location, l.held
  from training_log l where l.held_on between p_from and p_to
  order by l.held_on desc, l.starts_at nulls last, l.coach;
end $$;
revoke execute on function trainer_attendance(date, date) from public, anon;
grant execute on function trainer_attendance(date, date) to authenticated;

-- ===== 0043_match_staff.sql =====
-- Штат матча (тренер и оператор) и статистика тренеров: перенос листа «Игры» (столбцы F–H) и вкладок «Игры» и «Статистика»
-- страницы «Посещаемость тренеров» старого приложения. Запись — только администратор; читают администратор и тренеры.
-- Часы тренировок тренерам не показываются (как в 0042). Оплаты тренерам не считаются.
create table match_staff (
  match_id uuid not null references matches(id) on delete cascade,
  coach text not null,
  role text not null check (role in ('Тренер', 'Оператор')),
  reg boolean not null default true,   -- регламент выполнен
  primary key (match_id, coach, role)
);
alter table match_staff enable row level security;
create policy match_staff_admin on match_staff for all using (is_admin()) with check (is_admin());
grant select, insert, update, delete on match_staff to authenticated, service_role;

-- Заменить штат матча целиком. staff: [{coach, role, reg}]
create or replace function match_staff_set(m uuid, staff jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare el jsonb; c text; r text;
begin
  if not is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  if not exists (select 1 from matches where id = m) then raise exception 'not found' using errcode = 'P0002'; end if;
  if staff is null or jsonb_typeof(staff) <> 'array' then raise exception 'bad staff' using errcode = '22023'; end if;
  delete from match_staff where match_id = m;
  for el in select * from jsonb_array_elements(staff) loop
    c := nullif(trim(el->>'coach'), '');
    r := el->>'role';
    if c is null then raise exception 'fields required' using errcode = '22023'; end if;
    if r not in ('Тренер', 'Оператор') then raise exception 'bad role' using errcode = '22023'; end if;
    insert into match_staff (match_id, coach, role, reg) values (m, c, r, coalesce((el->>'reg')::boolean, true))
      on conflict (match_id, coach, role) do update set reg = excluded.reg;
  end loop;
end $$;

-- Игры периода со штатом
create or replace function match_staff_list(p_from date, p_to date)
returns table (match_id uuid, played_on date, team text, opponent text, goals_for int, goals_against int, staff jsonb)
language plpgsql stable security definer set search_path = public as $$
begin
  if current_user_id() is null or not (is_admin() or is_any_coach()) then raise exception 'forbidden' using errcode = '42501'; end if;
  if p_from is null or p_to is null or p_from > p_to then raise exception 'bad period' using errcode = '22023'; end if;
  if p_to - p_from > 400 then raise exception 'period too large' using errcode = '22023'; end if;
  return query
  select mt.id, mt.played_on, mt.team, mt.opponent, mt.goals_for, mt.goals_against,
    coalesce((select jsonb_agg(jsonb_build_object('coach', s.coach, 'role', s.role, 'reg', s.reg) order by s.role desc, s.coach)
              from match_staff s where s.match_id = mt.id), '[]'::jsonb)
  from matches mt
  where mt.played_on between p_from and p_to and mt.goals_for is not null
  order by mt.played_on, mt.team;
end $$;

-- Статистика по тренерам: проведённые тренировки (часы только администратору), игры как тренер и как оператор, участия, % регламента
create or replace function trainer_stats(p_from date, p_to date)
returns table (coach text, trainings int, hours numeric, as_coach int, as_operator int, parts int, reg_pct int)
language plpgsql stable security definer set search_path = public as $$
declare adm boolean;
begin
  if current_user_id() is null or not (is_admin() or is_any_coach()) then raise exception 'forbidden' using errcode = '42501'; end if;
  if p_from is null or p_to is null or p_from > p_to then raise exception 'bad period' using errcode = '22023'; end if;
  if p_to - p_from > 400 then raise exception 'period too large' using errcode = '22023'; end if;
  adm := is_admin();
  return query
  with t as (
    select l.coach as n, count(*)::int as c, sum(coalesce(l.hours, 0)) as h
    from training_log l where l.held and l.held_on between p_from and p_to group by l.coach
  ), g as (
    select s.coach as n,
      count(*) filter (where s.role = 'Тренер')::int as ac,
      count(*) filter (where s.role = 'Оператор')::int as ao,
      count(*)::int as p,
      count(*) filter (where s.reg)::int as r
    from match_staff s join matches mt on mt.id = s.match_id
    where mt.played_on between p_from and p_to group by s.coach
  )
  select coalesce(t.n, g.n), coalesce(t.c, 0), case when adm then round(coalesce(t.h, 0), 1) end,
    coalesce(g.ac, 0), coalesce(g.ao, 0), coalesce(g.p, 0),
    case when coalesce(g.p, 0) > 0 then round(g.r * 100.0 / g.p)::int end
  from t full join g on t.n = g.n
  order by 1;
end $$;

revoke execute on function match_staff_set(uuid, jsonb), match_staff_list(date, date), trainer_stats(date, date) from public, anon;
grant execute on function match_staff_set(uuid, jsonb), match_staff_list(date, date), trainer_stats(date, date) to authenticated;

-- ===== 0044_lead_submit_app.sql =====
-- Заявка «Записаться на пробную» из приложения (гость, родитель без привязки): та же заявка trials, что из бота (0039),
-- но от вошедшего пользователя. Лимит, проверки и уведомление администратору — как в lead_submit; источник 'app'.
-- Согласие на обработку данных подтверждается галочкой в форме (consent обязателен), дата фиксируется в trials.consent_at.
create or replace function lead_submit_app(parent text, child text, byear int, phone text, wish text, consent boolean) returns uuid
language plpgsql security definer set search_path = public as $$
declare uid uuid := current_user_id(); tg bigint; uname text; r uuid;
begin
  if uid is null then raise exception 'not authenticated' using errcode = '28000'; end if;
  if not coalesce(consent, false) then raise exception 'consent required' using errcode = '22023'; end if;
  select telegram_id into tg from users where id = uid;
  r := lead_submit(tg, parent, null, child, byear, phone);
  update trials set source = 'app', note = left(nullif(trim(wish), ''), 300) where id = r and source = 'bot' and note is null;
  return r;
end $$;
revoke execute on function lead_submit_app(text, text, int, text, text, boolean) from public, anon;
grant execute on function lead_submit_app(text, text, int, text, text, boolean) to authenticated;

-- ===== 0045_booking_parents.sql =====
-- Запись родителей на индивидуальные, вратарские и дополнительные тренировки (этап 2 переноса из старого приложения).
-- Родитель видит ближайшие занятия, места и кто записан (имена), записывает и отменяет запись своего ребёнка.
-- Оплату вносит только администратор (ind_set_paid / extra_set_paid), родитель её видит по своим детям.
-- Отмена: пока в любое время; ограничение «за N часов» включается настройкой club_settings 'booking.cancelHours' (по умолчанию 0).
-- Виды занятия: individual, goalkeeper (individual_sessions, 0034), extra (extra_sessions, 0035).

create or replace function booking_is_parent() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from player_guardians g where g.user_id = current_user_id() and g.consent_revoked_at is null)
$$;

-- Ближайшие занятия (на 60 дней вперёд). booked — имена всех записанных; mine — дети текущего родителя с оплатой.
create or replace function booking_board()
returns table (kind text, session_id uuid, starts_at timestamp, title text, place text, capacity int, amount numeric, booked jsonb, mine jsonb)
language plpgsql stable security definer set search_path = public as $$
declare now_local timestamp := now() at time zone 'Asia/Tbilisi';
begin
  if current_user_id() is null or not (is_admin() or booking_is_parent()) then raise exception 'forbidden' using errcode = '42501'; end if;
  return query
  select case when s.goalkeepers then 'goalkeeper' else 'individual' end, s.id, s.starts_at,
    coalesce(s.topic, case when s.goalkeepers then 'Вратарская тренировка' else 'Индивидуальная тренировка' end), null::text,
    ind_cap(s.club_id, s.goalkeepers), ind_price(s.club_id, s.starts_at::date),
    coalesce((select jsonb_agg(pl.full_name order by pl.full_name) from individual_bookings b join players pl on pl.id = b.player_id where b.session_id = s.id), '[]'::jsonb),
    coalesce((select jsonb_agg(jsonb_build_object('player_id', b.player_id, 'name', pl.full_name, 'paid', b.paid, 'amount', b.amount) order by pl.full_name)
              from individual_bookings b join players pl on pl.id = b.player_id where b.session_id = s.id and is_guardian_of(b.player_id)), '[]'::jsonb)
  from individual_sessions s where s.starts_at >= now_local and s.starts_at < now_local + interval '60 days'
  union all
  select 'extra', e.id, e.starts_on::timestamp, 'Дополнительная тренировка', e.place, null::int, e.amount,
    coalesce((select jsonb_agg(pl.full_name order by pl.full_name) from extra_bookings b join players pl on pl.id = b.player_id where b.session_id = e.id), '[]'::jsonb),
    coalesce((select jsonb_agg(jsonb_build_object('player_id', b.player_id, 'name', pl.full_name, 'paid', b.paid, 'amount', coalesce(b.paid_amount, e.amount)) order by pl.full_name)
              from extra_bookings b join players pl on pl.id = b.player_id where b.session_id = e.id and is_guardian_of(b.player_id)), '[]'::jsonb)
  from extra_sessions e where e.starts_on >= now_local::date and e.starts_on < now_local::date + 60
  order by 3, 1;
end $$;

-- Записать своего ребёнка
create or replace function booking_signup(k text, s uuid, p uuid) returns void
language plpgsql security definer set search_path = public as $$
declare ses individual_sessions; ex extra_sessions; now_local timestamp := now() at time zone 'Asia/Tbilisi'; nm text;
begin
  if current_user_id() is null or not is_guardian_of(p) then raise exception 'forbidden' using errcode = '42501'; end if;
  select full_name into nm from players where id = p;
  if k in ('individual', 'goalkeeper') then
    select * into ses from individual_sessions where id = s and goalkeepers = (k = 'goalkeeper');
    if not found then raise exception 'session not found' using errcode = 'P0002'; end if;
    if ses.starts_at < now_local then raise exception 'session in the past' using errcode = '22023'; end if;
    perform ind_book(s, p);
  elsif k = 'extra' then
    select * into ex from extra_sessions where id = s;
    if not found then raise exception 'session not found' using errcode = 'P0002'; end if;
    if ex.starts_on < now_local::date then raise exception 'session in the past' using errcode = '22023'; end if;
    if exists (select 1 from extra_bookings where session_id = s and player_id = p) then raise exception 'already booked' using errcode = '23505'; end if;
    insert into extra_bookings (session_id, player_id) values (s, p);
  else
    raise exception 'bad kind' using errcode = '22023';
  end if;
  perform enqueue_to_admins('booking', 'Запись на занятие: ' || nm || '. Откройте приложение: Ещё → Индивидуальные / Дополнительные.');
end $$;

-- Отменить запись своего ребёнка (оплаченную отменяет только администратор)
create or replace function booking_cancel(k text, s uuid, p uuid) returns void
language plpgsql security definer set search_path = public as $$
declare st timestamp; was_paid boolean; hrs numeric; now_local timestamp := now() at time zone 'Asia/Tbilisi'; c uuid;
begin
  if current_user_id() is null or not is_guardian_of(p) then raise exception 'forbidden' using errcode = '42501'; end if;
  if k in ('individual', 'goalkeeper') then
    select ses.starts_at, ses.club_id, b.paid into st, c, was_paid from individual_sessions ses join individual_bookings b on b.session_id = ses.id and b.player_id = p
      where ses.id = s and ses.goalkeepers = (k = 'goalkeeper');
  elsif k = 'extra' then
    select e.starts_on::timestamp, e.club_id, b.paid into st, c, was_paid from extra_sessions e join extra_bookings b on b.session_id = e.id and b.player_id = p where e.id = s;
  else
    raise exception 'bad kind' using errcode = '22023';
  end if;
  if st is null then raise exception 'booking not found' using errcode = 'P0002'; end if;
  if was_paid then raise exception 'booking is paid' using errcode = '22023'; end if;
  hrs := coalesce(nullif(regexp_replace(coalesce((select value from club_settings where club_id = c and key = 'booking.cancelHours'), ''), '[^0-9.]', '', 'g'), '')::numeric, 0);
  if hrs > 0 and st - now_local < make_interval(secs => (hrs * 3600)::double precision) then raise exception 'too late' using errcode = '22023'; end if;
  if k = 'extra' then delete from extra_bookings where session_id = s and player_id = p;
  else delete from individual_bookings where session_id = s and player_id = p; end if;
end $$;

revoke execute on function booking_is_parent(), booking_board(), booking_signup(text, uuid, uuid), booking_cancel(text, uuid, uuid) from public, anon;
grant execute on function booking_is_parent(), booking_board(), booking_signup(text, uuid, uuid), booking_cancel(text, uuid, uuid) to authenticated;

-- ===== 0046_club_photos.sql =====
-- Фото клуба, которые администратор может заменить в приложении («Ещё → Фото клуба»).
-- Исходные фото лежат в приложении (web/public/img); строка здесь заменяет фото с тем же ключом.
-- Фото хранится готовой data-URL (JPEG, сжатый в приложении до ~1200 px), без отдельного хранилища файлов.
-- Читают все вошедшие (фото из «О клубе» видит и гость), пишет только администратор через функции.
create table club_photos (
  key text primary key check (key ~ '^[a-z0-9-]{2,40}$'),
  data text not null check (data like 'data:image/jpeg;base64,%' and length(data) <= 900000),
  updated_at timestamptz not null default now(),
  updated_by uuid references users(id) on delete set null
);
alter table club_photos enable row level security;
create policy club_photos_read on club_photos for select using (current_user_id() is not null);
grant select on club_photos to authenticated, service_role;

create or replace function club_photo_set(k text, d text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  if k is null or k !~ '^[a-z0-9-]{2,40}$' then raise exception 'bad key' using errcode = '22023'; end if;
  if d is null or d not like 'data:image/jpeg;base64,%' then raise exception 'bad image' using errcode = '22023'; end if;
  if length(d) > 900000 then raise exception 'image too large' using errcode = '22023'; end if;
  insert into club_photos (key, data, updated_by) values (k, d, current_user_id())
    on conflict (key) do update set data = excluded.data, updated_at = now(), updated_by = excluded.updated_by;
end $$;

-- Вернуть исходное фото (удалить замену)
create or replace function club_photo_clear(k text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  delete from club_photos where key = k;
end $$;

revoke all on function club_photo_set(text, text), club_photo_clear(text) from public, anon;
grant execute on function club_photo_set(text, text), club_photo_clear(text) to authenticated, service_role;

commit;
