-- 0009: расписание (лист РАСПИСАНИЕ) и журнал тренировок (лист «Тренировки»). Черновик 2026-10-22.

-- Расписание: одна строка на группу и день недели (как в листе РАСПИСАНИЕ, «Группы в отметках»)
alter table weekly_schedule add column coaches text;          -- «Тренеры», как в листе
alter table weekly_schedule add column kind text not null default 'Групповая'
  check (kind in ('Групповая', 'Индивидуальная', 'Вратарская'));
alter table weekly_schedule add column source_key text;       -- ключ строки листа для повторного запуска
alter table weekly_schedule add constraint weekly_schedule_source_unique unique (group_id, source_key);

-- Журнал тренировок: что реально проведено (лист «Тренировки»)
create table training_log (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references clubs(id),
  external_id text not null,            -- дата|тренер|группа|начало — ключ строки листа
  held_on date not null,
  weekday text,
  coach text not null,
  location text,
  group_label text not null,            -- как в листе: «U13-B/C», «Weekends»
  kind text not null check (kind in ('Групповая', 'Индивидуальная', 'Вратарская')),
  starts_at time,
  ends_at time,
  hours numeric(4,2),
  held boolean not null default true,
  unique (club_id, external_id)
);

alter table training_log enable row level security;
create policy training_log_admin on training_log for all using (is_admin()) with check (is_admin());
grant select, insert, update, delete on training_log to authenticated, service_role;
