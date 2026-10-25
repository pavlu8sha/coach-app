-- pgTAP: фото клуба, которые заменяет администратор (0046).
begin;
create extension if not exists pgtap;
select plan(9);

insert into clubs (id, name) values ('00000000-0000-0000-0000-00000000c001', 'Клуб');
insert into users (id, telegram_id, display_name, is_admin) values
  ('00000000-0000-0000-0000-0000000000a1', 9101, 'Админ', true),
  ('00000000-0000-0000-0000-0000000000b1', 9102, 'Гость', false);

create or replace function as_user(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
end $$;

select as_user('00000000-0000-0000-0000-0000000000b1');
select throws_ok($$select club_photo_set('camp-hero', 'data:image/jpeg;base64,AAAA')$$, '42501', 'forbidden', 'не администратор фото не меняет');
select throws_ok($$select club_photo_clear('camp-hero')$$, '42501', 'forbidden', 'и не возвращает исходное');
select throws_ok($$insert into club_photos (key, data) values ('x1', 'data:image/jpeg;base64,AAAA')$$, '42501', null, 'прямая запись запрещена');

reset role;
select as_user('00000000-0000-0000-0000-0000000000a1');
select lives_ok($$select club_photo_set('camp-hero', 'data:image/jpeg;base64,AAAA')$$, 'администратор меняет фото');
select throws_ok($$select club_photo_set('Bad Key', 'data:image/jpeg;base64,AAAA')$$, '22023', 'bad key', 'ключ проверяется');
select throws_ok($$select club_photo_set('camp-hero', 'javascript:alert(1)')$$, '22023', 'bad image', 'принимается только JPEG data-URL');

reset role;
select as_user('00000000-0000-0000-0000-0000000000b1');
select is((select data from club_photos where key = 'camp-hero'), 'data:image/jpeg;base64,AAAA', 'вошедший пользователь фото читает');

reset role;
select as_user('00000000-0000-0000-0000-0000000000a1');
select lives_ok($$select club_photo_clear('camp-hero')$$, 'администратор возвращает исходное');
reset role;
select is((select count(*)::int from club_photos), 0, 'замена удалена');

select * from finish();
rollback;
