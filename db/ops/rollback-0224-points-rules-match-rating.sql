-- Откат 0224: раздел match версии правил от 2026-12-01 возвращается к старой формуле (участие, голы, лучший +2, максимум 5).
-- Выполнять до 1 декабря и вместе с откатом 0223 (иначе матчи по модели оценки останутся без баллов). Один do-блок без пустых строк.
begin;
do $$
declare c uuid; v points_rule_versions; trg char;
  old_m jsonb := '{"played":1,"draw":1,"win":2,"goal":1,"best":2,"cap":5,"technical":0}'::jsonb;
begin
  for c in select id from clubs order by id loop
    select * into v from points_rule_versions where club_id = c and effective_from = date '2026-12-01' for update;
    if v.id is null then raise exception 'rollback 0224: у клуба % нет версии от 2026-12-01', c; end if;
    if v.params #>> '{match,model}' is distinct from 'rating' then raise exception 'rollback 0224: версия клуба % не на модели оценки, ничего не изменено', c; end if;
  end loop;
  for c in select id from clubs order by id loop
    select * into v from points_rule_versions where club_id = c and effective_from = date '2026-12-01';
    alter table points_rule_versions disable trigger points_rule_versions_no_change;
    update points_rule_versions set params = jsonb_set(v.params, '{match}', old_m) where id = v.id;
    alter table points_rule_versions enable trigger points_rule_versions_no_change;
    insert into audit_log (actor_id, action, entity, entity_id, before, after)
      values (null, 'points_rules_match_rating_rollback', 'points_rule_versions', v.id, jsonb_build_object('match', v.params -> 'match'), jsonb_build_object('match', old_m));
  end loop;
  select t.tgenabled into trg from pg_trigger t where t.tgrelid = 'public.points_rule_versions'::regclass and t.tgname = 'points_rule_versions_no_change';
  if trg is distinct from 'O' then raise exception 'rollback 0224: защита не восстановлена'; end if;
end $$;
commit;
