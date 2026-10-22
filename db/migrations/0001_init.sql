-- 0001: базовая схема. Политики доступа (RLS) — в 0002, с тестами pgTAP.
-- Черновик 2026-10-22, см. docs/TECH_DESIGN.md.

create extension if not exists pgcrypto;

create table clubs (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now()
);

create table users (
  id uuid primary key default gen_random_uuid(),
  telegram_id bigint unique not null,
  display_name text,
  is_admin boolean not null default false,
  created_at timestamptz not null default now()
);

create table seasons (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references clubs(id),
  name text not null,
  starts_on date not null,
  ends_on date not null,
  check (ends_on >= starts_on)
);

create table groups (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references clubs(id),
  name text not null,
  location text,
  unique (club_id, name)
);

create table coach_groups (
  user_id uuid not null references users(id) on delete cascade,
  group_id uuid not null references groups(id) on delete cascade,
  primary key (user_id, group_id)
);

create table players (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references clubs(id),
  group_id uuid references groups(id),
  full_name text not null,
  birth_date date,
  status text not null default 'active' check (status in ('active', 'inactive')),
  external_id text,                      -- «ID игрока» из таблицы, для миграции
  created_at timestamptz not null default now(),
  unique (club_id, external_id)
);

create table player_guardians (
  player_id uuid not null references players(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  relation text not null default 'parent',
  consent_version text not null,
  consent_given_at timestamptz not null,
  consent_revoked_at timestamptz,
  primary key (player_id, user_id)
);

create table sessions (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references groups(id),
  starts_at timestamptz not null,
  kind text not null default 'training'
);

create table attendance (
  session_id uuid not null references sessions(id) on delete cascade,
  player_id uuid not null references players(id) on delete cascade,
  status text not null check (status in ('present', 'absent', 'excused')),
  marked_by uuid references users(id),
  marked_at timestamptz not null default now(),
  primary key (session_id, player_id)
);

create table matches (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references clubs(id),
  season_id uuid references seasons(id),
  played_on date not null,
  team text not null,
  opponent text,
  goals_for int,
  goals_against int
);

create table match_players (
  match_id uuid not null references matches(id) on delete cascade,
  player_id uuid not null references players(id) on delete cascade,
  played boolean not null default false,
  goals int not null default 0,
  primary key (match_id, player_id)
);

create table rules (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references clubs(id),
  code text not null,                    -- например attendance_present, match_played
  version int not null default 1,
  points int not null,
  explanation text not null,             -- текст для родителя
  active_from date not null,
  active_to date,
  unique (club_id, code, version)
);

create table point_events (
  id uuid primary key default gen_random_uuid(),
  player_id uuid not null references players(id) on delete cascade,
  rule_id uuid not null references rules(id),
  points int not null,
  source_type text not null,             -- session / match / skill / record
  source_id uuid,
  occurred_on date not null,
  explanation text not null,             -- копия текста правила на момент начисления
  created_at timestamptz not null default now()
);

create table skills (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references clubs(id),
  name text not null,
  unique (club_id, name)
);

create table player_skills (
  player_id uuid not null references players(id) on delete cascade,
  skill_id uuid not null references skills(id),
  level int not null check (level between 1 and 3),
  awarded_on date not null,
  awarded_by uuid references users(id),
  primary key (player_id, skill_id, level)
);

create table records (
  id uuid primary key default gen_random_uuid(),
  player_id uuid not null references players(id) on delete cascade,
  kind text not null,                    -- например sprint_30m
  value numeric not null,
  unit text not null,
  recorded_on date not null,
  recorded_by uuid references users(id)
);

create table audit_log (
  id bigint generated always as identity primary key,
  actor_id uuid references users(id),
  action text not null,
  entity text not null,
  entity_id uuid,
  before jsonb,
  after jsonb,
  at timestamptz not null default now()
);
