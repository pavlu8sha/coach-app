-- 0005: поля игрока из реестра (даты участия и доп. программы). Черновик 2026-10-22.
alter table players add column starts_on date;
alter table players add column ends_on date;
alter table players add column extras text[] not null default '{}';
