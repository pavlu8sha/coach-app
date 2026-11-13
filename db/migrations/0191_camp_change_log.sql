-- 0191 (Issue #470, аудит 11.11 C-06): журнал изменений тарифов и сборов, закрытие прямой записи в camps.
-- Условия приёмки: docs/CAMP_SELF_SIGNUP_ACCEPTANCE.md (77-81). Функции camp_tariff_save и camp_save не меняются (цены сборов правит
-- отдельная работа, миграция 0182): журнал пишут триггеры на таблицах, поэтому порядок применения с 0182 не важен.
-- Данные сборов и платежей не меняет, ничего не отправляет. Откат: db/ops/rollback-0191-camp-change-log.sql.
begin;

create table if not exists camp_change_log (
  id bigint generated always as identity primary key,
  camp_id uuid not null,
  entity text not null check (entity in ('camp', 'tariff')),
  entity_id uuid not null,
  op text not null check (op in ('insert', 'update', 'delete')),
  old_values jsonb,
  new_values jsonb,
  changed_by uuid,
  changed_at timestamptz not null default now()
);
create index if not exists camp_change_log_camp on camp_change_log (camp_id, changed_at);
alter table camp_change_log enable row level security;
drop policy if exists camp_change_log_read on camp_change_log;
create policy camp_change_log_read on camp_change_log for select using (is_admin());
revoke all on camp_change_log from public, anon, authenticated, service_role;
grant select on camp_change_log to authenticated;

drop trigger if exists camp_change_log_immutable on camp_change_log;
create trigger camp_change_log_immutable before update or delete on camp_change_log for each row execute function camp_history_guard();
drop trigger if exists camp_change_log_no_truncate on camp_change_log;
create trigger camp_change_log_no_truncate before truncate on camp_change_log for each statement execute function camp_history_guard();

-- Запись журнала: для update только изменённые поля (прежние и новые значения), без записи, если разницы нет
create or replace function camp_change_log_write() returns trigger
language plpgsql security definer set search_path = public as $$
declare ent text := tg_argv[0]; o jsonb; n jsonb; ov jsonb; nv jsonb; cid uuid;
begin
  if tg_op = 'INSERT' then
    n := to_jsonb(new); cid := (case when ent = 'camp' then n ->> 'id' else n ->> 'camp_id' end)::uuid;
    insert into camp_change_log (camp_id, entity, entity_id, op, new_values, changed_by) values (cid, ent, new.id, 'insert', n, current_user_id());
    return new;
  elsif tg_op = 'DELETE' then
    o := to_jsonb(old); cid := (case when ent = 'camp' then o ->> 'id' else o ->> 'camp_id' end)::uuid;
    insert into camp_change_log (camp_id, entity, entity_id, op, old_values, changed_by) values (cid, ent, old.id, 'delete', o, current_user_id());
    return old;
  end if;
  o := to_jsonb(old); n := to_jsonb(new);
  select coalesce(jsonb_object_agg(k, o -> k), '{}'::jsonb), coalesce(jsonb_object_agg(k, n -> k), '{}'::jsonb)
    into ov, nv from jsonb_object_keys(n) k where (o -> k) is distinct from (n -> k);
  if nv <> '{}'::jsonb then
    cid := (case when ent = 'camp' then n ->> 'id' else n ->> 'camp_id' end)::uuid;
    insert into camp_change_log (camp_id, entity, entity_id, op, old_values, new_values, changed_by) values (cid, ent, new.id, 'update', ov, nv, current_user_id());
  end if;
  return new;
end $$;
revoke execute on function camp_change_log_write() from public, anon, authenticated, service_role;

drop trigger if exists camp_tariffs_change_log on camp_tariffs;
create trigger camp_tariffs_change_log after insert or update or delete on camp_tariffs
  for each row execute function camp_change_log_write('tariff');
drop trigger if exists camps_change_log on camps;
create trigger camps_change_log after insert or update or delete on camps
  for each row execute function camp_change_log_write('camp');

-- Прямая запись в camps закрыта: сборы меняют только функции (security definer)
drop policy if exists camps_admin on camps;
revoke insert, update, delete, truncate on camps from public, anon, authenticated;

commit;
