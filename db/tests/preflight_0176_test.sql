-- pgTAP (#238, follow-up к PR #616): preflight миграции 0176 явно зависит от 0173 и 0175.
-- Берёт настоящий db/ops/preflight.sql (запуск из корня репозитория, как в scripts/run-db-tests.sh) и проверяет колонку note
-- во всех сочетаниях предусловий. Состояния создаются переименованием/правкой объектов внутри транзакции и откатываются.
-- Только синтетика, production не затрагивается.
\set pf `cat db/ops/preflight.sql`
begin;
create extension if not exists pgtap;
select plan(31);

create temp view pf as :pf;

-- sub: выполняет ddl и запрос q во вложенной подтранзакции и откатывает её (результат возвращается текстом).
-- Откат через savepoint в самом тесте нельзя: он стёр бы записи pgTAP о пройденных проверках.
create function sub(ddl text, q text) returns text language plpgsql as $$
declare r text;
begin
  begin
    execute ddl; execute q into r;
    raise exception '%', coalesce(r, '<null>') using errcode = 'ZZ001';
  exception when sqlstate 'ZZ001' then return sqlerrm;
  end;
end $$;
-- «0176 не применена»: снимаем все четыре её признака (иначе это частичное состояние, см. п. 11-13)
create function unapply_0176() returns void language plpgsql as $$
begin
  alter table notifications drop column player_ids;
  alter table notifications drop column consent_check_attempts;
  alter function claim_notifications(integer) rename to claim_notifications_x;
  alter function camp_broadcast_player_ids(uuid, uuid) rename to camp_broadcast_player_ids_x;
end $$;
create function pf_note() returns text language sql as $$ select note from pf where migration = '0176_consent_claim_check' $$;
create function pf_applied(m text) returns boolean language sql as $$ select applied from pf where migration = m $$;
create function sn(ddl text) returns text language sql as $$ select sub(ddl, 'select note from pf where migration = ''0176_consent_claim_check''') $$;
create function sa(ddl text, m text) returns text language sql as $$ select sub(ddl, 'select applied::text from pf where migration = ''' || m || '''') $$;

-- ===== базовое состояние: полная база =====
select is((select count(*)::int from pf where migration = '0176_consent_claim_check'), 1, '0. строка 0176 одна');
select is((select count(*)::int from pf where applied is null), 0, '0. applied не бывает NULL ни в одной строке');
select is(pf_note(), 'applied', '1. оба предусловия и 0176 есть: applied');
select is((select count(*)::int from pf where note is not null), 1, '1б. note заполнена только у строки 0176');

-- DDL-сценарии (каждый во вложенной подтранзакции, откатывается сам)
-- no173: снять parent_access_ok; no175: снять camp_broadcast_audience; un176: снять все 4 признака 0176
create function ddl(variadic w text[]) returns text language sql as $$
  select string_agg(case x
    when 'un176' then 'select unapply_0176()'
    when 'no173' then 'alter function parent_access_ok(uuid, uuid) rename to parent_access_ok_x'
    when 'no175' then 'alter function camp_broadcast_audience(uuid, text, text) rename to camp_broadcast_audience_x'
    else x end, '; ') from unnest(w) x
$$;

-- ===== 0176 не применена, предусловия на месте =====
select is(sa(ddl('un176'), '0176_consent_claim_check'), 'false', '2. 0176 отсутствует: applied = false');
select alike(sn(ddl('un176')), 'ready:%', '2. 0173 и 0175 есть, 0176 нет: ready');

-- ===== нет 0173, 0176 не применена =====
select is(sa(ddl('un176', 'no173'), '0173_consent_access'), 'false', '3. признак 0173 = false после снятия parent_access_ok');
select alike(sn(ddl('un176', 'no173')), 'blocked:%0173%', '3. нет 0173: blocked, называет 0173');
select unalike(sn(ddl('un176', 'no173')), 'ready%', '3. нет 0173: не ready');
select unalike(sn(ddl('un176', 'no173')), '%0175%', '3. нет 0173, но 0175 есть: 0175 в диагностике не упомянута');

-- ===== нет 0175, 0176 не применена =====
select is(sa(ddl('un176', 'no175'), '0175_consent_camp_broadcast_audience'), 'false', '4. признак 0175 = false после снятия camp_broadcast_audience');
select alike(sn(ddl('un176', 'no175')), 'blocked:%0175%', '4. нет 0175: blocked, называет 0175');
select unalike(sn(ddl('un176', 'no175')), 'ready%', '4. нет 0175: не ready');
select unalike(sn(ddl('un176', 'no175')), '%0173%', '4. нет 0175, но 0173 есть: 0173 в диагностике не упомянута');

-- ===== нет обоих, 0176 не применена =====
select alike(sn(ddl('un176', 'no173', 'no175')), 'blocked:%0173%0175%', '5. нет обоих: blocked, 0173 затем 0175');

-- ===== 0176 уже применена, но предусловия сняты: несогласованное состояние, не applied и не ready =====
select is(sa(ddl('no173'), '0176_consent_claim_check'), 'true', '6. 0176 присутствует (признак true)');
select alike(sn(ddl('no173')), 'inconsistent:%0173%', '6. 0176 есть, нет 0173: inconsistent');
select unalike(sn(ddl('no173')), 'applied%', '6. 0176 есть, нет 0173: не applied');
select alike(sn(ddl('no175')), 'inconsistent:%0175%', '7. 0176 есть, нет 0175: inconsistent');
select unalike(sn(ddl('no175')), 'applied%', '7. 0176 есть, нет 0175: не applied');
select alike(sn(ddl('no173', 'no175')), 'inconsistent:%0173 и 0175%', '8. 0176 есть, нет обоих: inconsistent, оба названы');

-- ===== частичные (неоднозначные) состояния предусловий и 0176 =====
-- 0175 в старом виде (0172): функция есть, но без parent_access_ok. Это не «применена».
create function old175() returns text language sql as $$
  select 'do $x$ begin execute ' || quote_literal(replace(pg_get_functiondef('camp_broadcast_audience(uuid,text,text)'::regprocedure), 'parent_access_ok', 'true_access_ok')) || '; end $x$'
$$;
select is(sa(old175(), '0175_consent_camp_broadcast_audience'), 'false', '9. 0175 в старом виде (без parent_access_ok): признак false');
select alike(sn(old175()), 'inconsistent:%0175%', '9. старое тело camp_broadcast_audience при 0176: inconsistent, не applied');

-- 0173 частично: триггер режима снят
select is(sa('drop trigger consent_mode_guard on club_settings', '0173_consent_access'), 'false', '10. 0173 без consent_mode_guard: признак false');
select alike(sn('drop trigger consent_mode_guard on club_settings'), 'inconsistent:%0173%', '10. 0173 частично: inconsistent');

-- 0176 частично: нет одного из четырёх признаков (при предусловиях на месте)
select is(sa('alter table notifications drop column consent_check_attempts', '0176_consent_claim_check'), 'false', '11. 0176 без consent_check_attempts: признак false');
select alike(sn('alter table notifications drop column consent_check_attempts'), 'ambiguous:%', '11. 0176 частично: ambiguous, не ready и не applied');
select alike(sn('alter function camp_broadcast_player_ids(uuid, uuid) rename to camp_broadcast_player_ids_x'), 'ambiguous:%', '12. 0176 без camp_broadcast_player_ids: ambiguous');
-- 0176 частично и предусловий нет: частичность важнее, не blocked/ready
select alike(sn('alter function camp_broadcast_player_ids(uuid, uuid) rename to camp_broadcast_player_ids_x; ' || ddl('no173')), 'ambiguous:%', '13. 0176 частично и нет 0173: ambiguous');

-- ===== после всех откатов: снова applied, остальные строки не пострадали =====
select is(pf_note(), 'applied', '14. после откатов снова applied');
select is((select count(*)::int from pf where applied is not true and migration not in ('0047_ind_no_autobook', '0052_ind_change_type')), 0, '15. все остальные строки preflight true (известные исключения 0047 и 0052)');

select * from finish();
rollback;
