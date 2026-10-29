-- pgTAP: родитель видит турниры только своего ребёнка, в том числе без матчей (0063); отозванное согласие и чужие дети не видны.
begin;
create extension if not exists pgtap;
select plan(6);

insert into clubs (id, name) values ('00000000-0000-0000-0000-00000000c001', 'Клуб');
insert into users (id, telegram_id, display_name, is_admin) values
  ('00000000-0000-0000-0000-0000000000b1', 9301, 'Родитель', false),
  ('00000000-0000-0000-0000-0000000000b2', 9302, 'Чужой', false);
insert into players (id, club_id, full_name, status) values
  ('00000000-0000-0000-0000-00000000d001', '00000000-0000-0000-0000-00000000c001', 'Аня', 'active'),
  ('00000000-0000-0000-0000-00000000d002', '00000000-0000-0000-0000-00000000c001', 'Боря', 'active');
insert into player_guardians (player_id, user_id, consent_version, consent_given_at) values
  ('00000000-0000-0000-0000-00000000d001', '00000000-0000-0000-0000-0000000000b1', 'v', now());
insert into tournaments (id, club_id, external_id, team, kind, name, fee, starts_on) values
  ('00000000-0000-0000-0000-0000000007a1', '00000000-0000-0000-0000-00000000c001', 'NEWTON-1', 'U12', 'cup', 'Newton cup', 50, '2026-10-10'),
  ('00000000-0000-0000-0000-0000000007a2', '00000000-0000-0000-0000-00000000c001', 'E-2', 'U9', 'festival', 'Festival', 30, '2026-10-12'),
  ('00000000-0000-0000-0000-0000000007a3', '00000000-0000-0000-0000-00000000c001', 'E-3', 'U9', 'festival', 'Чужой турнир', 30, '2026-10-12');
insert into matches (id, club_id, external_id, team, kind, played_on, tournament_id) values
  ('00000000-0000-0000-0000-0000000008a1', '00000000-0000-0000-0000-00000000c001', 'M-1', 'U9', 'game', '2026-10-12', '00000000-0000-0000-0000-0000000007a2');
insert into tournament_fees (tournament_id, player_id, amount, paid) values
  ('00000000-0000-0000-0000-0000000007a1', '00000000-0000-0000-0000-00000000d001', 50, false),
  ('00000000-0000-0000-0000-0000000007a2', '00000000-0000-0000-0000-00000000d001', 30, true),
  ('00000000-0000-0000-0000-0000000007a3', '00000000-0000-0000-0000-00000000d002', 30, true);

create or replace function as_user(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
end $$;

select as_user('00000000-0000-0000-0000-0000000000b1');
select is((select count(*)::int from my_tournaments()), 2, 'родитель видит только турниры своего ребёнка');
select is((select games from my_tournaments() where name = 'Newton cup'), 0, 'турнир без матчей показан с нулём игр');
select is((select games from my_tournaments() where name = 'Festival'), 1, 'у турнира с матчем число игр считается');
select is((select count(*)::int from my_tournaments() where name = 'Чужой турнир'), 0, 'турнир чужого ребёнка не виден');

select as_user('00000000-0000-0000-0000-0000000000b2');
select is((select count(*)::int from my_tournaments()), 0, 'родитель без связей ничего не видит');

reset role;
update player_guardians set consent_revoked_at = now() where user_id = '00000000-0000-0000-0000-0000000000b1';
select as_user('00000000-0000-0000-0000-0000000000b1');
select is((select count(*)::int from my_tournaments()), 0, 'после отзыва согласия турниры не видны');

select * from finish();
rollback;
