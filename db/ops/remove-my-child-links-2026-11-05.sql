-- Удаляет ВСЕ родительские связи одного аккаунта с детьми и то, что от них зависит. Бэкапа в Supabase нет:
-- 1) сначала запусти readonly-my-child-links-2026-11-05.sql и сверь списки;
-- 2) впиши Telegram id в строке ниже (одно место) и выполни скрипт целиком в SQL Editor.
-- Не трогает: users, coach_groups, права админа, платежи, посещаемость, баллы, notifications, audit_log, child_links.
-- Если аккаунт не найден (или найден не один) или после удаления связи остались, скрипт падает и ничего не применяет.

begin;

create temp table _me on commit drop as select id from users where telegram_id = 0 /* ← Telegram id личного аккаунта */;

do $$
declare n int; c int;
begin
  select count(*) into n from _me;
  if n <> 1 then raise exception 'аккаунт не найден: впиши Telegram id (найдено %)', n; end if;
end $$;

delete from child_codes where created_by in (select id from _me);
delete from link_notify_log where user_id in (select id from _me);
delete from link_requests where user_id in (select id from _me);
delete from data_requests where user_id in (select id from _me);
delete from rate_limits where key like 'link%' and key like '%' || (select id::text from _me);
delete from player_guardians where user_id in (select id from _me);

do $$
declare c int;
begin
  select (select count(*) from player_guardians where user_id in (select id from _me))
       + (select count(*) from link_requests where user_id in (select id from _me))
       + (select count(*) from child_codes where created_by in (select id from _me)) into c;
  if c <> 0 then raise exception 'остались связи: %', c; end if;
end $$;

-- Проверка: должно быть 0 везде, а группы тренера на месте
select (select count(*) from player_guardians where user_id in (select id from _me)) as осталось_опекунств,
       (select count(*) from link_requests where user_id in (select id from _me)) as осталось_запросов,
       (select count(*) from coach_groups where user_id in (select id from _me)) as групп_тренера;

commit;
