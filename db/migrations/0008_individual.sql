-- 0008: индивидуальные тренировки — занятия и записи с оплатой. Черновик 2026-10-22.
-- Гости (разовые, не в клубе) — строки в players с external_id GUEST-… и без группы (group_id пустой).

create table individual_sessions (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references clubs(id),
  external_id text not null,              -- IND-ГГГГ-ММ-ДД-ЧЧЧЧ (из файла IND_ID)
  starts_at timestamp not null,           -- дата и время начала (местное время клуба)
  topic text,                             -- тема занятия из листа
  unique (club_id, external_id)
);

create table individual_bookings (
  session_id uuid not null references individual_sessions(id) on delete cascade,
  player_id uuid not null references players(id) on delete cascade,
  amount numeric(10,2) not null default 50,
  paid boolean not null default false,
  primary key (session_id, player_id)
);

alter table individual_sessions enable row level security;
alter table individual_bookings enable row level security;
create policy individual_sessions_admin on individual_sessions for all using (is_admin()) with check (is_admin());
create policy individual_bookings_admin on individual_bookings for all using (is_admin()) with check (is_admin());
grant select, insert, update, delete on individual_sessions, individual_bookings to authenticated, service_role;
