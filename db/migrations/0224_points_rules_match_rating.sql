-- 0224: версия правил баллов от 2026-12-01 переводится на модель оценки тренера (условия: docs/MATCH_RATING_POINTS_ACCEPTANCE.md, Б11).
-- Обрабатываются ВСЕ клубы: сначала проверка каждого (у каждого есть версия, раздел match старый или уже новый), потом изменение; при любом отклонении ошибка без изменений. Меняется только раздел match; дата, остальные разделы и комментарий версии остаются. Версии неизменны (триггер points_rule_versions_no_change):
-- триггер выключается только внутри этой транзакции и включается обратно, состояние проверяется. Если раздел match не совпадает с ожидаемым
-- старым, миграция завершается ошибкой и ничего не меняет. Повторный запуск после успешного применения ничего не делает.
-- Применять после 0223 и до 1 декабря. Откат: db/ops/rollback-0224-points-rules-match-rating.sql. Сначала db/ops/preflight.sql.
begin;
do $$
declare c uuid; v points_rule_versions; trg char; done_n int := 0; skip_n int := 0;
  old_m jsonb := '{"played":1,"draw":1,"win":2,"goal":1,"best":2,"cap":5,"technical":0}'::jsonb;
  new_m jsonb := '{"model":"rating","rating_min":1,"rating_max":5,"best":1,"cap":6,"technical":0,"played":0,"draw":0,"win":0,"goal":0}'::jsonb;
  np jsonb;
begin
  if not exists (select 1 from clubs) then raise notice '0224: клубов нет, версия правил не меняется'; return; end if;
  for c in select id from clubs order by id loop
    select * into v from points_rule_versions where club_id = c and effective_from = date '2026-12-01' for update;
    if v.id is null then raise exception '0224: у клуба % нет версии правил от 2026-12-01, ничего не изменено', c; end if;
    if v.params -> 'match' is distinct from new_m and v.params -> 'match' is distinct from old_m then
      raise exception '0224: раздел match версии от 2026-12-01 клуба % не совпадает с ожидаемым (%), ничего не изменено', c, v.params -> 'match';
    end if;
  end loop;
  for c in select id from clubs order by id loop
    select * into v from points_rule_versions where club_id = c and effective_from = date '2026-12-01';
    if v.params -> 'match' = new_m then skip_n := skip_n + 1; continue; end if;
    np := jsonb_set(v.params, '{match}', new_m);
    perform points_rules_validate(np);
    alter table points_rule_versions disable trigger points_rule_versions_no_change;
    update points_rule_versions set params = np where id = v.id;
    alter table points_rule_versions enable trigger points_rule_versions_no_change;
    insert into audit_log (actor_id, action, entity, entity_id, before, after)
      values (null, 'points_rules_match_rating', 'points_rule_versions', v.id,
              jsonb_build_object('club_id', c, 'effective_from', v.effective_from, 'match', old_m),
              jsonb_build_object('club_id', c, 'effective_from', v.effective_from, 'match', new_m));
    done_n := done_n + 1;
  end loop;
  select t.tgenabled into trg from pg_trigger t where t.tgrelid = 'public.points_rule_versions'::regclass and t.tgname = 'points_rule_versions_no_change';
  if trg is distinct from 'O' then raise exception '0224: защита неизменности версий правил не восстановлена'; end if;
  raise notice '0224: изменено версий %, уже на модели оценки %', done_n, skip_n;
end $$;
commit;
