-- Автосоздание индивидуальных: тема недели сдвинута на 2 недели, чтобы на 14-15.11.2026 была «Приём мяча и удары по воротам»
-- (было «соперник сбоку»). Круг тем: номер недели от 2024-01-01 плюс 2. Условия: docs/acceptance/ind-autocreate-topic-offset-2026-11-11.md
-- Тело функции берётся из базы и меняется одной подстановкой (так миграция не затирает правки соседних PR, урок 2026-11-11).
do $mig$
declare
  def text := pg_get_functiondef(to_regprocedure('ind_autocreate(date)'));
  old_s constant text := $$((d - date '2024-01-01') / 7) % array_length(r.topics, 1)$$;
  new_s constant text := $$((d - date '2024-01-01') / 7 + 2) % array_length(r.topics, 1)$$;
begin
  if def is null then raise exception 'ind_autocreate(date) not found'; end if;
  if position(old_s in def) = 0 then raise exception 'ind_autocreate: topic formula not found (already changed?)'; end if;
  execute replace(def, old_s, new_s);
end $mig$;
-- права после create or replace сохраняются; повторяем прежние на всякий случай
revoke execute on function ind_autocreate(date) from public, anon, authenticated;
grant execute on function ind_autocreate(date) to service_role;
