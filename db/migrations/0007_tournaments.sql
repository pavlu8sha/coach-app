-- 0007: турниры и взносы на турнир; тип и привязка матчей. Черновик 2026-10-22.
-- Взнос чемпионата и фестиваля — на турнир (один раз), товарищеской игры — на матч (match_fees).

create table tournaments (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references clubs(id),
  external_id text,                       -- «ID» события из таблицы МАТЧИ (E-xxx) или NEWTON-…
  team text not null,                     -- U9, U10…, для Newton cup — U12
  kind text not null check (kind in ('championship', 'festival', 'cup')),
  name text,                              -- Championship 1, Festival, Newton cup 2014-2015
  fee numeric(10,2) not null,
  starts_on date,
  unique (club_id, external_id)
);

create table tournament_fees (
  tournament_id uuid not null references tournaments(id) on delete cascade,
  player_id uuid not null references players(id) on delete cascade,
  amount numeric(10,2) not null,
  paid boolean not null default false,
  primary key (tournament_id, player_id)
);

alter table matches add column kind text check (kind in ('friendly', 'game'));
alter table matches add column tournament_id uuid references tournaments(id);
alter table matches add column external_id text;
alter table matches add constraint matches_external_unique unique (club_id, external_id);

-- доступ: только админ клуба (как у остальных денежных таблиц); сервисный ключ импорта — через grants
alter table tournaments enable row level security;
alter table tournament_fees enable row level security;
create policy tournaments_admin on tournaments for all using (is_admin()) with check (is_admin());
create policy tournament_fees_admin on tournament_fees for all using (is_admin()) with check (is_admin());
grant select, insert, update, delete on tournaments, tournament_fees to authenticated, service_role;
