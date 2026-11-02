-- 0099 (#239): реквизиты и правила оплаты редактируются администратором без релиза.
-- Раньше текст лежал в коде (web/src/lib/clubInfo.ts). Теперь он хранится в отдельной таблице payment_info:
-- читать её могут вошедшие пользователи (родители, тренеры), club_settings при этом не открывается.
-- Писать напрямую нельзя: администратор сохраняет через payment_info_save, которая проверяет форму данных.
-- Реквизиты: ровно четыре утверждённых поля (меняются только значения, названия фиксированы). Расчёт взносов и платежи не затрагиваются.

create table if not exists payment_info (
  club_id uuid primary key references clubs(id),
  details jsonb not null,
  rules jsonb not null,
  updated_at timestamptz not null default now(),
  updated_by uuid references users(id)
);

alter table payment_info enable row level security;
drop policy if exists payment_info_read on payment_info;
create policy payment_info_read on payment_info for select to authenticated using (true);
revoke all on payment_info from anon, authenticated;
grant select on payment_info to authenticated;
grant all on payment_info to service_role;

-- Начальные значения дословно совпадают с утверждёнными владельцем (issue #239) и с web/src/lib/clubInfo.ts.
insert into payment_info (club_id, details, rules)
select c.id,
$details$[
 {
  "label": "Beneficiary’s Bank",
  "value": "JSC TBC Bank"
 },
 {
  "label": "Bank Code",
  "value": "TBCBGE22"
 },
 {
  "label": "Beneficiary’s IBAN",
  "value": "GE11TB7050036080100015"
 },
 {
  "label": "Name of Beneficiary",
  "value": "F.C. Kickstart LLC"
 }
]$details$::jsonb,
$rules$[
 {
  "title": "1. Абонементы",
  "items": [
   "Доступны абонементы только на один календарный месяц.",
   "Оплата вносится с 22-го по 28-е число за следующий месяц."
  ]
 },
 {
  "title": "2. Пропущенные тренировки не компенсируются",
  "items": [
   "Если ребёнок пропускает тренировки по личным причинам (отпуск, отдых, занятость и т. п.), оплата не возвращается и не переносится.",
   "Обоснование клуба: аренда, работа тренеров и инвентарь оплачиваются в полном объёме независимо от посещаемости.",
   "В случае болезни или уважительной причины родитель может обратиться к главному тренеру @coach_siordia для индивидуального рассмотрения ситуации. Автоматическая компенсация не предусмотрена: решение рассматривается индивидуально."
  ]
 },
 {
  "title": "3. Регулярные пропуски без уведомления",
  "items": [
   "Если ребёнок посещает менее 60% тренировок за месяц и родители не сообщают тренеру об уважительных причинах, тренерский штаб оставляет за собой право приостановить участие ребёнка в команде."
  ]
 },
 {
  "title": "4. Сохранение места при длительном отсутствии",
  "items": [
   "Если ребёнок не будет посещать тренировки один месяц или дольше, место можно сохранить, оплатив 50% стоимости месячного абонемента.",
   "Администрацию необходимо уведомить минимум за две недели до начала отсутствия.",
   "Пример владельца: при отсутствии с 1 августа уведомить администрацию до 15 июля и оплатить за август 50% абонемента."
  ]
 }
]$rules$::jsonb
from clubs c
order by c.id
limit 1
on conflict (club_id) do nothing;

-- Сохранение: только администратор. Четыре реквизита с неизменными названиями и непустыми значениями; разделы правил с заголовком и пунктами.
create or replace function payment_info_save(d jsonb, r jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare
  labels text[] := array['Beneficiary’s Bank', 'Bank Code', 'Beneficiary’s IBAN', 'Name of Beneficiary'];
  x jsonb;
  y jsonb;
  i int;
  cid uuid;
begin
  if not is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  if jsonb_typeof(d) is distinct from 'array' or coalesce(jsonb_array_length(d), 0) <> 4 then raise exception 'bad details' using errcode = '22023'; end if;
  for i in 0..3 loop
    x := d -> i;
    if jsonb_typeof(x) is distinct from 'object' or x ->> 'label' is distinct from labels[i + 1]
       or jsonb_typeof(x -> 'value') is distinct from 'string' or btrim(x ->> 'value') = '' or length(x ->> 'value') > 200 then
      raise exception 'bad details' using errcode = '22023';
    end if;
  end loop;
  if jsonb_typeof(r) is distinct from 'array' or coalesce(jsonb_array_length(r), 0) not between 1 and 12 then raise exception 'bad rules' using errcode = '22023'; end if;
  for x in select * from jsonb_array_elements(r) loop
    if jsonb_typeof(x) is distinct from 'object' or jsonb_typeof(x -> 'title') is distinct from 'string' or btrim(x ->> 'title') = '' or length(x ->> 'title') > 200
       or jsonb_typeof(x -> 'items') is distinct from 'array' or coalesce(jsonb_array_length(x -> 'items'), 0) not between 1 and 20 then
      raise exception 'bad rules' using errcode = '22023';
    end if;
    for y in select * from jsonb_array_elements(x -> 'items') loop
      if jsonb_typeof(y) is distinct from 'string' or btrim(y #>> '{}') = '' or length(y #>> '{}') > 1000 then raise exception 'bad rules' using errcode = '22023'; end if;
    end loop;
  end loop;
  select id into cid from clubs order by id limit 1;
  if cid is null then raise exception 'club not found' using errcode = 'P0002'; end if;
  insert into payment_info (club_id, details, rules, updated_at, updated_by)
  values (cid, d, r, now(), current_user_id())
  on conflict (club_id) do update set details = excluded.details, rules = excluded.rules, updated_at = now(), updated_by = excluded.updated_by;
end $$;

revoke execute on function payment_info_save(jsonb, jsonb) from public, anon;
grant execute on function payment_info_save(jsonb, jsonb) to authenticated;
