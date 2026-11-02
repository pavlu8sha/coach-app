-- 0101 (#337): гости на сборах. Гость — участник сбора, который не игрок клуба: имя, контакт, тариф, оплата.
-- Гость хранится в camp_participants с player_id = null и guest_name; его платежи — в camp_payments (player_id = null),
-- поэтому оплата гостя входит в итоги сбора и в кассовый отчёт без отдельных таблиц. Игроки клуба и их данные не меняются.
-- Доступ прежний: гостей видит и записывает администратор, оплату вносит администратор и локальный администратор сбора.
-- Родитель гостя не видит (политика чтения по is_guardian_of(player_id) для null ложна). Контакт гостя — персональные данные.

alter table camp_participants alter column player_id drop not null;
alter table camp_payments alter column player_id drop not null;
alter table camp_participants add column if not exists guest_name text;
alter table camp_participants add column if not exists guest_contact text;

-- Либо игрок клуба (без гостевых полей), либо гость с именем
alter table camp_participants drop constraint if exists camp_participants_guest_check;
alter table camp_participants add constraint camp_participants_guest_check
  check ((player_id is not null and guest_name is null and guest_contact is null) or (player_id is null and nullif(btrim(guest_name), '') is not null));

-- Один гость с одним именем на сбор (без учёта регистра)
create unique index if not exists camp_guest_name_unique on camp_participants (camp_id, lower(btrim(guest_name))) where player_id is null;

-- Записать гостя на сбор (если ранее отказался с тем же именем — вернуть статус «записан»). Только администратор.
create or replace function camp_register_guest(cid uuid, nm text, contact text, tid uuid, amt numeric, tshirt text, cmt text) returns uuid
language plpgsql security definer set search_path = public as $$
declare tp numeric; r uuid; st text;
begin
  perform camp_assert_admin();
  if not exists (select 1 from camps where id = cid) then raise exception 'camp not found' using errcode = 'P0002'; end if;
  if nullif(btrim(nm), '') is null or length(btrim(nm)) > 80 or length(coalesce(contact, '')) > 80 then raise exception 'name required' using errcode = '22023'; end if;
  select price into tp from camp_tariffs where id = tid and camp_id = cid and active;
  if tp is null then raise exception 'tariff not found' using errcode = 'P0002'; end if;
  if amt is not null and amt < 0 then raise exception 'bad amount' using errcode = '22023'; end if;
  select id, status into r, st from camp_participants where camp_id = cid and player_id is null and lower(btrim(guest_name)) = lower(btrim(nm));
  if r is not null and st = 'registered' then raise exception 'already registered' using errcode = '23505'; end if;
  if r is null then
    insert into camp_participants (camp_id, player_id, guest_name, guest_contact, tariff_id, amount, tshirt_size, comment, status, registered_on)
    values (cid, null, btrim(nm), nullif(btrim(contact), ''), tid, coalesce(amt, tp), nullif(btrim(tshirt), ''), nullif(btrim(cmt), ''), 'registered', current_date) returning id into r;
  else
    update camp_participants set guest_contact = nullif(btrim(contact), ''), tariff_id = tid, amount = coalesce(amt, tp),
      tshirt_size = nullif(btrim(tshirt), ''), comment = nullif(btrim(cmt), ''), status = 'registered' where id = r;
  end if;
  return r;
end $$;

-- Имя и контакт гостя. Только администратор; для игрока клуба не применяется.
create or replace function camp_update_guest(pid uuid, nm text, contact text) returns void
language plpgsql security definer set search_path = public as $$
declare cp camp_participants;
begin
  perform camp_assert_admin();
  select * into cp from camp_participants where id = pid;
  if not found then raise exception 'participant not found' using errcode = 'P0002'; end if;
  if cp.player_id is not null then raise exception 'not a guest' using errcode = '22023'; end if;
  if nullif(btrim(nm), '') is null or length(btrim(nm)) > 80 or length(coalesce(contact, '')) > 80 then raise exception 'name required' using errcode = '22023'; end if;
  if exists (select 1 from camp_participants where camp_id = cp.camp_id and player_id is null and id <> pid and lower(btrim(guest_name)) = lower(btrim(nm))) then
    raise exception 'already registered' using errcode = '23505';
  end if;
  update camp_participants set guest_name = btrim(nm), guest_contact = nullif(btrim(contact), '') where id = pid;
end $$;

revoke execute on function camp_register_guest(uuid, text, text, uuid, numeric, text, text), camp_update_guest(uuid, text, text) from public, anon;
grant execute on function camp_register_guest(uuid, text, text, uuid, numeric, text, text), camp_update_guest(uuid, text, text) to authenticated;
