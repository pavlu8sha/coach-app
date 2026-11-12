-- pgTAP (#238, follow-up к PR #616, условие У18): статический страж адресных уведомлений по определениям функций в pg_proc.
-- Адресная запись в очередь обязана нести player_ids (иначе claim_notifications не проверит согласие, миграция 0176).
-- Проверяются настоящие определения в тестовой БД, а не текст миграций. Схема: public. Сигнатуры точные (to_regprocedure).
-- Регрессия: дефектные версии известных функций создаются внутри транзакции и откатываются; production не затрагивается.
-- Ограничение: динамический SQL (execute) страж не видит; отдельная проверка требует, чтобы такого обращения к notifications не было.
begin;
create extension if not exists pgtap;
select plan(52);

-- ===== разбор исходника =====
-- g_clean: убирает комментарии (-- и /* */) и содержимое строк '...', чтобы текст в них не давал ложных срабатываний.
create function g_clean(src text) returns text language sql immutable as $$
  select coalesce(string_agg(case when m[1] is not null then ' ' when m[2] is not null then '''''' else m[3] end, '' order by ord), '')
    from regexp_matches(src, '(--[^\n]*|/\*(?:[^*]|\*(?!/))*\*/)|(''(?:[^'']|'''')*'')|([^-/'']+|[-/])', 'g') with ordinality as t(m, ord)
$$;

-- g_inserts: сколько прямых INSERT INTO notifications в тексте и сколько из них без player_ids в списке столбцов
-- (INSERT без списка столбцов считается нарушением: проверить нельзя).
create function g_inserts(src text, out total int, out bad int) language plpgsql immutable as $$
declare m text[]; cl text := g_clean(src);
begin
  total := 0; bad := 0;
  for m in select regexp_matches(cl, 'insert\s+into\s+(?:public\s*\.\s*)?"?notifications"?(?![A-Za-z0-9_])(?:\s+as\s+\w+)?\s*(\([^)]*\))?', 'gi') loop
    total := total + 1;
    if m[1] is null or m[1] !~* '\mplayer_ids\M' then bad := bad + 1; end if;
  end loop;
end $$;

-- g_calls: количество аргументов у каждого вызова fname(...) (запятые верхнего уровня; вложенные скобки, [] и строки учтены)
create function g_calls(src text, fname text) returns int[] language plpgsql immutable as $$
declare cl text := g_clean(src); pos int; i int; n int := length(cl); depth int; args int; c text; res int[] := '{}'; has boolean;
begin
  pos := 1;
  loop
    select (regexp_instr(substr(cl, pos), '\m' || fname || '\s*\(', 1, 1, 1, 'i')) into i;
    exit when i is null or i = 0;
    i := pos + i - 1;  -- позиция сразу после открывающей скобки
    depth := 1; args := 1; has := false;
    while i <= n and depth > 0 loop
      c := substr(cl, i, 1);
      if c in ('(', '[') then depth := depth + 1; has := true;
      elsif c in (')', ']') then depth := depth - 1;
      elsif c = ',' and depth = 1 then args := args + 1;
      elsif c !~ '\s' then has := true; end if;
      i := i + 1;
    end loop;
    res := res || (case when has then args else 0 end);
    pos := i;
  end loop;
  return res;
end $$;

-- ===== классификация (У8/У18) =====
-- Прямой INSERT в notifications с player_ids обязателен (адресные):
create temp table g_direct (sig regprocedure primary key) on commit drop;
insert into g_direct values
  ('enqueue_notification(uuid,text,text,uuid[])'),     -- общий путь для адресных вызовов (enqueue_to_guardians, booking_family_notice, direction)
  ('rsvp_notify_parent(uuid,uuid,text,uuid[],text)'),  -- rsvp_*
  ('waitlist_notify(text,uuid,boolean)'),              -- waitlist_offer, waitlist_moved
  ('camp_broadcast_send(uuid,text,text,integer,text)'); -- reminder адресный, info общий: столбец player_ids в INSERT обязателен
-- Прямой INSERT без player_ids допустим (общий путь: администраторы, тренеры, link_decided, data_request_done, гости, camp_document):
create temp table g_direct_exempt (sig regprocedure primary key) on commit drop;
insert into g_direct_exempt values ('enqueue_notification(uuid,text,text)');
-- Адресные через посредника: каждый вызов enqueue_notification обязан иметь 4 аргумента, enqueue_direction_notification 5:
create temp table g_indirect (sig regprocedure primary key) on commit drop;
insert into g_indirect values
  ('enqueue_to_guardians(uuid,text,text)'),            -- payment, bonus
  ('booking_family_notice(uuid,text,text,uuid,uuid[],text,text)'), -- booking_*, первая волна
  ('enqueue_direction_notification(uuid,text,text,text,uuid[])');
-- Функции, вызывающие общие варианты (3 арг. enqueue_notification / 4 арг. enqueue_direction_notification) сознательно:
create temp table g_general_callers (sig regprocedure primary key) on commit drop;
insert into g_general_callers values
  ('enqueue_to_admins(text,text)'), ('camp_enqueue_admins(text,text,uuid)'), ('camp_notify_application()'),
  ('camp_document_finish(uuid,boolean)'), ('notify_coach_group()'), ('notify_link_request()'), ('notify_data_request()'),
  ('enqueue_direction_notification(uuid,text,text,text)');

-- ===== нарушители по текущим определениям =====
-- прямой INSERT: функции public, у которых есть INSERT в notifications, но их нет ни в g_direct, ни в g_direct_exempt
create function g_unclassified_inserters() returns text language sql stable as $$
  select coalesce(string_agg(p.oid::regprocedure::text, ', ' order by p.oid::regprocedure::text), '')
    from pg_proc p
   where p.pronamespace = 'public'::regnamespace and p.prokind = 'f' and p.prosrc ~* 'insert\s+into\s+(public\s*\.\s*)?"?notifications' and (g_inserts(p.prosrc)).total > 0
     and p.oid not in (select sig::oid from g_direct) and p.oid not in (select sig::oid from g_direct_exempt)
$$;
-- функции из g_direct с INSERT без player_ids (или совсем без INSERT: тогда страж потерял функцию из виду)
create function g_direct_violations() returns text language sql stable as $$
  select coalesce(string_agg(d.sig::text, ', ' order by d.sig::text), '')
    from g_direct d join pg_proc p on p.oid = d.sig::oid
   where (g_inserts(p.prosrc)).bad > 0 or (g_inserts(p.prosrc)).total = 0
$$;
-- функции из g_indirect с вызовом общей (короткой) формы
create function g_indirect_violations() returns text language sql stable as $$
  select coalesce(string_agg(x.sig::text, ', ' order by x.sig::text), '')
    from (select i.sig, p.prosrc from g_indirect i join pg_proc p on p.oid = i.sig::oid) x
   where 3 = any (g_calls(x.prosrc, 'enqueue_notification'))
      or 4 = any (g_calls(x.prosrc, 'enqueue_direction_notification'))
      or 0 = any (g_calls(x.prosrc, 'enqueue_notification'))
$$;
-- функции public с общим вызовом (3 арг. / 4 арг. direction), не внесённые в g_general_callers и не в g_indirect
create function g_unclassified_general_callers() returns text language sql stable as $$
  select coalesce(string_agg(p.oid::regprocedure::text, ', ' order by p.oid::regprocedure::text), '')
    from pg_proc p
   where p.pronamespace = 'public'::regnamespace and p.prokind = 'f'
     and p.prosrc ~* 'enqueue_(direction_)?notification' and (3 = any (g_calls(p.prosrc, 'enqueue_notification')) or 4 = any (g_calls(p.prosrc, 'enqueue_direction_notification')))
     and p.oid not in (select sig::oid from g_general_callers) and p.oid not in (select sig::oid from g_indirect)
$$;

-- ===== 1. классификация согласована с базой =====
select is((select count(*)::int from pg_proc p join g_direct d on p.oid = d.sig::oid where p.pronamespace = 'public'::regnamespace), 4, 'К2. прямых адресных функций 4, все в схеме public');
select is((select count(*)::int from g_indirect i join pg_proc p on p.oid = i.sig::oid), 3, 'К3. косвенных адресных функций 3');
select is((select count(*)::int from g_general_callers i join pg_proc p on p.oid = i.sig::oid), 8, 'К4. функций с сознательным общим вызовом 8');
select is((select count(*)::int from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in ('enqueue_notification', 'enqueue_direction_notification')), 4, 'К5. перегрузок enqueue_notification и enqueue_direction_notification две и две: новая перегрузка требует пересмотра стража');
select is((select count(*)::int from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in ('rsvp_notify_parent', 'waitlist_notify', 'camp_broadcast_send', 'enqueue_to_guardians', 'booking_family_notice')), 5, 'К6. у остальных адресных функций нет перегрузок (сигнатура однозначна)');
select is((select count(*)::int from pg_proc p where p.pronamespace = 'public'::regnamespace and (p.prosrc ~* 'execute[^;]*notifications')), 0, 'К7. динамического SQL с notifications нет (страж его не видит)');
select is((select count(*)::int from pg_trigger t where not t.tgisinternal and t.tgrelid = 'notifications'::regclass and t.tgtype & 4 = 4), 0, 'К8. на notifications нет INSERT-триггеров, подменяющих player_ids');

-- ===== 2. настоящие определения проходят =====
select is(g_unclassified_inserters(), '', 'Г1. нет неклассифицированных функций с прямым INSERT в notifications');
select is(g_direct_violations(), '', 'Г2. все прямые адресные функции вставляют player_ids');
select is(g_indirect_violations(), '', 'Г3. косвенные адресные функции вызывают только адресные формы');
select is(g_unclassified_general_callers(), '', 'Г4. нет неклассифицированных функций с общим вызовом enqueue_notification');

-- по функциям: адресные пути из У8/У18
select is((g_inserts(p.prosrc)).total, 1, 'Ф1. enqueue_notification(…uuid[]): один INSERT') from pg_proc p where p.oid = 'enqueue_notification(uuid,text,text,uuid[])'::regprocedure;
select is((g_inserts(p.prosrc)).bad, 0, 'Ф1б. enqueue_notification(…uuid[]): player_ids в списке столбцов') from pg_proc p where p.oid = 'enqueue_notification(uuid,text,text,uuid[])'::regprocedure;
select is((g_inserts(p.prosrc)).bad, 0, 'Ф2. rsvp_notify_parent: player_ids в списке столбцов') from pg_proc p where p.oid = 'rsvp_notify_parent(uuid,uuid,text,uuid[],text)'::regprocedure;
select is((g_inserts(p.prosrc)).bad, 0, 'Ф3. waitlist_notify: player_ids в списке столбцов') from pg_proc p where p.oid = 'waitlist_notify(text,uuid,boolean)'::regprocedure;
select is((g_inserts(p.prosrc)).bad, 0, 'Ф4. camp_broadcast_send: player_ids в списке столбцов') from pg_proc p where p.oid = 'camp_broadcast_send(uuid,text,text,integer,text)'::regprocedure;
select is(g_calls(p.prosrc, 'enqueue_notification'), array[4], 'Ф5. enqueue_to_guardians: единственный вызов enqueue_notification с 4 аргументами') from pg_proc p where p.oid = 'enqueue_to_guardians(uuid,text,text)'::regprocedure;
select is((select array_agg(c order by c) from unnest(g_calls((select prosrc from pg_proc where oid = 'booking_family_notice(uuid,text,text,uuid,uuid[],text,text)'::regprocedure), 'enqueue_notification')) c), array[4], 'Ф6. booking_family_notice: enqueue_notification с 4 аргументами');
select is((select array_agg(c order by c) from unnest(g_calls((select prosrc from pg_proc where oid = 'booking_family_notice(uuid,text,text,uuid,uuid[],text,text)'::regprocedure), 'enqueue_direction_notification')) c), array[5], 'Ф7. booking_family_notice: enqueue_direction_notification с 5 аргументами');
select is(g_calls(p.prosrc, 'enqueue_notification'), array[4], 'Ф8. enqueue_direction_notification(…uuid[]): вызов enqueue_notification с 4 аргументами') from pg_proc p where p.oid = 'enqueue_direction_notification(uuid,text,text,text,uuid[])'::regprocedure;
select is(g_calls(p.prosrc, 'enqueue_notification'), array[3], 'Ф9. enqueue_direction_notification(4 арг.): общий вариант, вызов с 3 аргументами') from pg_proc p where p.oid = 'enqueue_direction_notification(uuid,text,text,text)'::regprocedure;
select is((g_inserts(p.prosrc)).total, 1, 'Ф10. camp_broadcast_send: ровно один INSERT в notifications') from pg_proc p where p.oid = 'camp_broadcast_send(uuid,text,text,integer,text)'::regprocedure;
-- адресные триггеры идут через enqueue_to_guardians, а не напрямую
select is(g_calls(p.prosrc, 'enqueue_to_guardians'), array[3], 'Ф11. notify_payment вызывает enqueue_to_guardians') from pg_proc p where p.oid = 'notify_payment()'::regprocedure;
select is(g_calls(p.prosrc, 'enqueue_to_guardians'), array[3], 'Ф12. notify_bonus вызывает enqueue_to_guardians') from pg_proc p where p.oid = 'notify_bonus()'::regprocedure;
select is(g_calls(p.prosrc, 'enqueue_to_guardians'), array[3], 'Ф13. notify_points_ledger вызывает enqueue_to_guardians') from pg_proc p where p.oid = 'notify_points_ledger()'::regprocedure;
select is((g_inserts(p.prosrc)).total, 0, 'Ф14. enqueue_to_guardians не вставляет в notifications напрямую') from pg_proc p where p.oid = 'enqueue_to_guardians(uuid,text,text)'::regprocedure;
select is((g_inserts(p.prosrc)).total, 0, 'Ф15. booking_family_notice не вставляет в notifications напрямую') from pg_proc p where p.oid = 'booking_family_notice(uuid,text,text,uuid,uuid[],text,text)'::regprocedure;
select is((g_inserts(p.prosrc)).bad, 1, 'Ф16. общая enqueue_notification(…3 арг.): INSERT без player_ids (допустимое исключение, учтено как есть)') from pg_proc p where p.oid = 'enqueue_notification(uuid,text,text)'::regprocedure;

-- ===== 3. сам разбор исходника (синтетические тексты) =====
select is((g_inserts('begin insert into notifications (user_id, kind, text, player_ids) values (1,2,3,4); end')).bad, 0, 'Р1. INSERT со списком, где есть player_ids: ок');
select is((g_inserts('begin insert into notifications (user_id, kind, text) values (1,2,3); end')).bad, 1, 'Р2. INSERT без player_ids: нарушение');
select is((g_inserts('begin insert into public.notifications(user_id,kind,text,buttons) select 1,2,3,4; end')).bad, 1, 'Р3. схема public и без пробела перед скобкой: нарушение найдено');
select is((g_inserts('begin INSERT INTO notifications AS n (user_id, player_ids) values (1,2); end')).bad, 0, 'Р4. регистр и псевдоним: player_ids найден');
select is((g_inserts('begin insert into notifications select * from x; end')).bad, 1, 'Р5. INSERT без списка столбцов: нарушение (проверить нельзя)');
select is((g_inserts(E'begin -- insert into notifications (user_id) values (1)\n /* insert into notifications (user_id) */ perform 1; end')).total, 0, 'Р6. INSERT в комментариях не считается');
select is((g_inserts('begin raise notice ''insert into notifications (user_id) values (1)''; end')).total, 0, 'Р7. INSERT в строковом литерале не считается');
select is((g_inserts('begin insert into notifications_log (user_id) values (1); end')).total, 0, 'Р8. другая таблица с похожим именем не считается');
select is((g_inserts('begin insert into notifications (user_id, player_ids_old) values (1,2); end')).bad, 1, 'Р9. столбец player_ids_old не принимается за player_ids');
select is(g_calls('begin perform enqueue_notification(u, k, t); perform enqueue_notification(u, k, t, array[a, b]); end', 'enqueue_notification'), array[3, 4], 'Р10. подсчёт аргументов: вложенные скобки и массивы');
select is(g_calls('begin perform enqueue_notification(r.user_id, nk, head || r.names || tail, coalesce(r.pids, array[]::uuid[])); end', 'enqueue_notification'), array[4], 'Р11. запятые внутри вызовов не считаются');
select is(g_calls('begin perform x(''enqueue_notification(a,b)''); -- enqueue_notification(a)' || E'\n' || ' end', 'enqueue_notification'), '{}'::int[], 'Р12. вызовы в строках и комментариях не считаются');
select is(g_calls('begin perform my_enqueue_notification(a, b); end', 'enqueue_notification'), '{}'::int[], 'Р13. имя с префиксом не считается вызовом');

-- ===== 4. регрессия: дефектные версии известных функций должны ронять страж, исправные проходить =====
-- g_break(sig, from, to): подменяет текст в определении и пересоздаёт функцию.
-- g_sub(ddl, q): выполняет ddl и запрос q во вложенной подтранзакции и откатывает её (откат через savepoint в самом тесте стёр бы записи pgTAP).
create function g_break(sig regprocedure, f text, t text) returns void language plpgsql as $$
declare d text := pg_get_functiondef(sig);
begin
  if position(f in d) = 0 then raise exception 'нет фрагмента % в %', f, sig; end if;
  execute replace(d, f, t);
end $$;
create function g_sub(ddl text, q text) returns text language plpgsql as $$
declare r text;
begin
  begin
    execute ddl; execute q into r;
    raise exception '%', coalesce(r, '<null>') using errcode = 'ZZ001';
  exception when sqlstate 'ZZ001' then return sqlerrm;
  end;
end $$;
select alike(g_sub($d$select g_break('enqueue_notification(uuid,text,text,uuid[])', 'insert into notifications (user_id, kind, text, player_ids) values (u, k, t, pls)', 'insert into notifications (user_id, kind, text) values (u, k, t)')$d$, 'select g_direct_violations()'), '%enqueue_notification(uuid,text,text,uuid[])%', 'Д1. дефект: enqueue_notification(…uuid[]) без player_ids: страж падает');
select alike(g_sub($d$select g_break('rsvp_notify_parent(uuid,uuid,text,uuid[],text)', '(user_id, kind, text, buttons, player_ids)', '(user_id, kind, text, buttons)')$d$, 'select g_direct_violations()'), '%rsvp_notify_parent%', 'Д2. дефект: rsvp_notify_parent без player_ids: страж падает');
select alike(g_sub($d$select g_break('waitlist_notify(text,uuid,boolean)', '(user_id, kind, text, buttons, player_ids)', '(user_id, kind, text, buttons)')$d$, 'select g_direct_violations()'), '%waitlist_notify%', 'Д3. дефект: waitlist_notify без player_ids: страж падает');
select alike(g_sub($d$select g_break('camp_broadcast_send(uuid,text,text,integer,text)', '(user_id, kind, text, player_ids)', '(user_id, kind, text)')$d$, 'select g_direct_violations()'), '%camp_broadcast_send%', 'Д4. дефект: camp_broadcast_send без player_ids: страж падает');
select alike(g_sub($d$select g_break('enqueue_to_guardians(uuid,text,text)', 'enqueue_notification(g, k, t, array[p])', 'enqueue_notification(g, k, t)')$d$, 'select g_indirect_violations()'), '%enqueue_to_guardians%', 'Д5. дефект: enqueue_to_guardians вызывает короткую форму: страж падает');
select alike(g_sub($d$select g_break('booking_family_notice(uuid,text,text,uuid,uuid[],text,text)', 'enqueue_notification(r.user_id, nk, head || r.names || tail, r.pids)', 'enqueue_notification(r.user_id, nk, head || r.names || tail)')$d$, 'select g_indirect_violations()'), '%booking_family_notice%', 'Д6. дефект: booking_family_notice вызывает короткую форму: страж падает');
select alike(g_sub($d$select g_break('enqueue_direction_notification(uuid,text,text,text,uuid[])', 'enqueue_notification(u, k, t, pls)', 'enqueue_notification(u, k, t)')$d$, 'select g_indirect_violations()'), '%enqueue_direction_notification(uuid,text,text,text,uuid[])%', 'Д7. дефект: enqueue_direction_notification(…uuid[]) теряет pls: страж падает');
-- новая неклассифицированная функция с прямым INSERT, и новая с общим вызовом
select alike(g_sub($d$create function new_addressed_notice(u uuid, p uuid) returns void language plpgsql as $f$ begin insert into notifications (user_id, kind, text) values (u, 'new_kind', 'x'); end $f$$d$, 'select g_unclassified_inserters()'), '%new_addressed_notice%', 'Д8. новая функция с прямым INSERT вне классификации: страж падает');
select alike(g_sub($d$create function new_caller(u uuid) returns void language plpgsql as $f$ begin perform enqueue_notification(u, 'new_kind', 'x'); end $f$$d$, 'select g_unclassified_general_callers()'), '%new_caller%', 'Д9. новая функция с общим вызовом вне классификации: страж падает');
-- после всех дефектов настоящие определения не изменены, страж зелёный
select is(g_unclassified_inserters() || g_direct_violations() || g_indirect_violations() || g_unclassified_general_callers(), '', 'Д10. дефектные версии откатились: страж на настоящих определениях проходит');
-- дефект, исправленный обратно: проходит
select is(g_sub($d$select g_break('rsvp_notify_parent(uuid,uuid,text,uuid[],text)', '(user_id, kind, text, buttons, player_ids)', '(user_id, kind, text, buttons)'); select g_break('rsvp_notify_parent(uuid,uuid,text,uuid[],text)', '(user_id, kind, text, buttons)', '(user_id, kind, text, buttons, player_ids)')$d$, 'select g_direct_violations()'), '', 'Д11. дефект исправлен обратно (player_ids возвращён): страж проходит');

select * from finish();
rollback;
