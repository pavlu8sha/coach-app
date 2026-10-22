-- 0002: доступ по ролям (RLS). Черновик 2026-10-22, см. docs/TECH_DESIGN.md и docs/RATING_SPEC.md.
-- users.id совпадает с auth.uid() (Edge Function создаёт сессию по telegram_id).

create or replace function current_user_id() returns uuid
language sql stable as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    nullif(current_setting('request.jwt.claims', true)::jsonb ->> 'sub', '')
  )::uuid
$$;

create or replace function is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from users where id = current_user_id() and is_admin)
$$;

create or replace function is_guardian_of(p uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from player_guardians g
    where g.player_id = p and g.user_id = current_user_id() and g.consent_revoked_at is null
  )
$$;

create or replace function is_coach_of_player(p uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from players pl join coach_groups cg on cg.group_id = pl.group_id
    where pl.id = p and cg.user_id = current_user_id()
  )
$$;

create or replace function is_coach_of_group(g uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from coach_groups where group_id = g and user_id = current_user_id())
$$;

-- Включаем RLS везде: без политики доступа нет.
alter table clubs enable row level security;
alter table users enable row level security;
alter table seasons enable row level security;
alter table groups enable row level security;
alter table coach_groups enable row level security;
alter table players enable row level security;
alter table player_guardians enable row level security;
alter table sessions enable row level security;
alter table attendance enable row level security;
alter table matches enable row level security;
alter table match_players enable row level security;
alter table rules enable row level security;
alter table point_events enable row level security;
alter table skills enable row level security;
alter table player_skills enable row level security;
alter table records enable row level security;
alter table audit_log enable row level security;

-- Пользователь видит только себя; администратор — всех.
create policy users_self on users for select using (id = current_user_id() or is_admin());

-- Игроки: администратор — все; тренер — игроки своих групп; родитель — своих детей.
create policy players_read on players for select
  using (is_admin() or is_coach_of_group(group_id) or is_guardian_of(id));
create policy players_admin_write on players for all
  using (is_admin()) with check (is_admin());

-- Связи «родитель — ребёнок»: родитель видит свои связи, администратор управляет.
create policy guardians_read on player_guardians for select
  using (is_admin() or user_id = current_user_id());
create policy guardians_admin_write on player_guardians for all
  using (is_admin()) with check (is_admin());

-- Группы и тренеры: видят участники группы, пишет администратор.
create policy groups_read on groups for select
  using (is_admin() or is_coach_of_group(id));
create policy groups_admin_write on groups for all
  using (is_admin()) with check (is_admin());
create policy coach_groups_read on coach_groups for select
  using (is_admin() or user_id = current_user_id());
create policy coach_groups_admin_write on coach_groups for all
  using (is_admin()) with check (is_admin());

-- Посещаемость: тренер группы пишет и читает; родитель читает своего ребёнка.
create policy attendance_read on attendance for select
  using (is_admin() or is_coach_of_player(player_id) or is_guardian_of(player_id));
create policy attendance_coach_write on attendance for all
  using (is_admin() or is_coach_of_player(player_id))
  with check (is_admin() or is_coach_of_player(player_id));

-- Журнал баллов: только запись в журнал, без изменения и удаления (см. docs/TECH_DESIGN.md).
create policy points_read on point_events for select
  using (is_admin() or is_coach_of_player(player_id) or is_guardian_of(player_id));
create policy points_insert on point_events for insert
  with check (is_admin() or is_coach_of_player(player_id));
-- update/delete не объявлены: запрещено для всех ролей, кроме владельца БД.

-- Рекорды и навыки — те же правила, что у игрока.
create policy records_read on records for select
  using (is_admin() or is_coach_of_player(player_id) or is_guardian_of(player_id));
create policy records_write on records for insert
  with check (is_admin() or is_coach_of_player(player_id));
create policy player_skills_read on player_skills for select
  using (is_admin() or is_coach_of_player(player_id) or is_guardian_of(player_id));
create policy player_skills_write on player_skills for insert
  with check (is_admin() or is_coach_of_player(player_id));

-- Матчи и правила: видят участники клуба (любой вошедший пользователь клуба через связи), пишет администратор.
create policy matches_read on matches for select using (is_admin() or auth.uid() is not null);
create policy matches_admin_write on matches for all using (is_admin()) with check (is_admin());
create policy match_players_read on match_players for select
  using (is_admin() or is_guardian_of(player_id) or is_coach_of_player(player_id));
create policy match_players_admin_write on match_players for all
  using (is_admin()) with check (is_admin());
create policy rules_read on rules for select using (auth.uid() is not null);
create policy rules_admin_write on rules for all using (is_admin()) with check (is_admin());
create policy skills_read on skills for select using (auth.uid() is not null);
create policy skills_admin_write on skills for all using (is_admin()) with check (is_admin());
create policy sessions_read on sessions for select
  using (is_admin() or is_coach_of_group(group_id));
create policy sessions_coach_write on sessions for all
  using (is_admin() or is_coach_of_group(group_id)) with check (is_admin() or is_coach_of_group(group_id));

-- Аудит: читает только администратор, пишет система (через функции с security definer).
create policy audit_admin_read on audit_log for select using (is_admin());

-- Клубы: видят участники (любой вошедший пользователь), пишет администратор.
create policy clubs_read on clubs for select using (auth.uid() is not null);
create policy clubs_admin_write on clubs for all using (is_admin()) with check (is_admin());
create policy seasons_read on seasons for select using (auth.uid() is not null);
create policy seasons_admin_write on seasons for all using (is_admin()) with check (is_admin());

-- Групповой рейтинг для всех родителей: только суммы по группе, без имён и личных записей.
create or replace function group_rating(p_group uuid, p_season uuid default null)
returns table (group_id uuid, total_points bigint, players_count bigint)
language sql stable security definer set search_path = public as $$
  select g.id,
         coalesce(sum(e.points), 0)::bigint,
         count(distinct pl.id)::bigint
  from groups g
  join players pl on pl.group_id = g.id and pl.status = 'active'
  left join point_events e on e.player_id = pl.id
  where g.id = p_group
    and (auth.uid() is not null)
  group by g.id
$$;
