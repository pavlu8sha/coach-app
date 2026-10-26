-- Миграции 0062–0062 одной транзакцией. Сгенерировано scripts/make-apply-bundle.sh 0062.
-- Перед запуском выполните db/ops/preflight.sql: все номера от 0062 должны быть applied = false. После: db/ops/postcheck.sql.
begin;

-- ===== 0062_tl_edit_session.sql =====
-- Изменить конкретную проведённую тренировку (время и место): дата, группа и прежнее время находят строки всех тренеров этой тренировки,
-- часы пересчитываются, ключи строк обновляются. Тренеров меняют tl_replace_coach, tl_add и tl_set_held.
create or replace function tl_edit_session(d date, label text, old_st time, new_st time, new_en time, new_loc text) returns int
language plpgsql security definer set search_path = public as $$
declare r record; base text; n int; done int := 0;
begin
  perform tl_assert_admin();
  if d is null or nullif(trim(label), '') is null or new_st is null then raise exception 'fields required' using errcode = '22023'; end if;
  if new_en is not null and new_en <= new_st then raise exception 'bad time' using errcode = '22023'; end if;
  for r in select * from training_log where held_on = d and group_label = trim(label) and starts_at is not distinct from old_st order by coach loop
    base := tl_key(r.held_on, r.coach, r.group_label, new_st);
    select count(*) + 1 into n from training_log where club_id = r.club_id and external_id like base || '|%' and id <> r.id;
    update training_log set starts_at = new_st, ends_at = new_en, location = nullif(trim(new_loc), ''), hours = tl_hours(new_st, new_en), external_id = base || '|' || n where id = r.id;
    done := done + 1;
  end loop;
  if done = 0 then raise exception 'not found' using errcode = 'P0002'; end if;
  return done;
end $$;
revoke execute on function tl_edit_session(date, text, time, time, time, text) from public, anon;
grant execute on function tl_edit_session(date, text, time, time, time, text) to authenticated;

commit;
